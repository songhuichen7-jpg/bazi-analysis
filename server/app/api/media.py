"""/api/media/cover — fetch + cache album cover for songs.

Workflow:
  1. Hash (title, artist) → cache key
  2. If cache hit, return metadata immediately
  3. Else: query iTunes Search API (free, no key, has Chinese music),
     download artworkUrl100 (~30 KB PNG), extract dominant + secondary
     palette colors with colorthief, save to local cache directory,
     return metadata.

Cache lives in ``server/var/media-cache/`` — gitignored, regenerable.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

import httpx
from colorthief import ColorThief
from fastapi import APIRouter, HTTPException, Query
from PIL import Image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["media"])

_CACHE_DIR = Path(__file__).resolve().parents[2] / "var" / "media-cache"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)

_INDEX_FILE = _CACHE_DIR / "index.json"
_INDEX_LOCK = asyncio.Lock()


def _load_index() -> dict[str, dict[str, Any]]:
    if not _INDEX_FILE.exists():
        return {}
    try:
        with _INDEX_FILE.open(encoding="utf-8") as fh:
            return json.load(fh) or {}
    except Exception:  # noqa: BLE001 — corrupt cache → start fresh
        logger.warning("media cache index corrupt, resetting")
        return {}


def _save_index(idx: dict[str, dict[str, Any]]) -> None:
    tmp = _INDEX_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(idx, fh, ensure_ascii=False)
    tmp.replace(_INDEX_FILE)


def _key(kind: str, title: str, artist: str | None) -> str:
    h = hashlib.md5(f"{kind}|{title}|{artist or ''}".encode("utf-8"))
    return h.hexdigest()


def _hex(rgb: tuple[int, int, int] | None) -> str:
    if not rgb:
        return ""
    r, g, b = rgb
    return f"#{r:02x}{g:02x}{b:02x}"


async def _itunes_search(title: str, artist: str | None) -> str | None:
    """Return the best-match artworkUrl100 from iTunes Search API."""
    term = f"{title} {artist}" if artist else title
    params = {
        "term": term,
        "entity": "song",
        "limit": "3",
        "country": "CN",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as cli:
            r = await cli.get("https://itunes.apple.com/search", params=params)
            if r.status_code != 200:
                return None
            data = r.json()
            results = data.get("results") or []
            if not results:
                return None
            return results[0].get("artworkUrl100")
    except Exception as exc:  # noqa: BLE001
        logger.warning("iTunes search failed for %r: %r", term, exc)
        return None


async def _download(url: str) -> bytes | None:
    """Bigger size from artworkUrl100 — replace 100x100 with 300x300 for crisper covers."""
    big = url.replace("100x100bb.jpg", "300x300bb.jpg").replace(
        "100x100bb.png", "300x300bb.png",
    )
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as cli:
            r = await cli.get(big)
            if r.status_code == 200 and r.content:
                return r.content
            r = await cli.get(url)
            if r.status_code == 200 and r.content:
                return r.content
    except Exception as exc:  # noqa: BLE001
        logger.warning("cover download failed for %s: %r", url, exc)
    return None


def _normalise_image(raw: bytes, dest: Path) -> None:
    """Write a JPEG with sane dimensions, regardless of source encoding."""
    img = Image.open(BytesIO(raw)).convert("RGB")
    if max(img.size) > 600:
        img.thumbnail((600, 600), Image.LANCZOS)
    img.save(dest, "JPEG", quality=88, optimize=True)


def _palette_for(path: Path) -> tuple[str, str]:
    """Pick dominant + secondary hex colors from the saved image.
    Falls back to a neutral cool gradient on any extraction failure."""
    try:
        ct = ColorThief(str(path))
        dominant = ct.get_color(quality=2)
        palette = ct.get_palette(color_count=3, quality=2)
        secondary = next(
            (c for c in palette if c != dominant),
            dominant,
        )
        return _hex(dominant), _hex(secondary)
    except Exception as exc:  # noqa: BLE001
        logger.warning("colorthief failed on %s: %r", path, exc)
        return "#3a4d6f", "#7b9ec5"


@router.get("/cover")
async def get_cover(
    type: Literal["song"] = Query(..., description="media kind"),
    title: str = Query(..., min_length=1, max_length=120),
    artist: str | None = Query(None, max_length=120),
) -> dict[str, Any]:
    """Return ``{ url, dominantHex, secondaryHex }`` for a song cover.

    Currently only song covers are supported (iTunes API). Movies and books
    rely on the icon-only frontend fallback.
    """
    if type != "song":
        raise HTTPException(status_code=400, detail="only song covers supported")

    title = title.strip()
    artist_clean = (artist or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")

    key = _key(type, title, artist_clean)

    # Read-side cache hit (no lock — index is read-only here).
    index = _load_index()
    entry = index.get(key)
    if entry and (Path(_CACHE_DIR / entry["filename"]).exists()):
        return {
            "url": f"/static/media-cache/{entry['filename']}",
            "dominantHex": entry.get("dominantHex"),
            "secondaryHex": entry.get("secondaryHex"),
        }

    # Miss — fetch + extract under a lock to avoid duplicate writes for the
    # same (title, artist) pair if two requests race in.
    async with _INDEX_LOCK:
        index = _load_index()
        entry = index.get(key)
        if entry and (Path(_CACHE_DIR / entry["filename"]).exists()):
            return {
                "url": f"/static/media-cache/{entry['filename']}",
                "dominantHex": entry.get("dominantHex"),
                "secondaryHex": entry.get("secondaryHex"),
            }

        artwork = await _itunes_search(title, artist_clean)
        if not artwork:
            raise HTTPException(status_code=404, detail="cover not found")
        raw = await _download(artwork)
        if not raw:
            raise HTTPException(status_code=502, detail="cover download failed")

        filename = f"{key}.jpg"
        dest = _CACHE_DIR / filename
        try:
            _normalise_image(raw, dest)
        except Exception as exc:  # noqa: BLE001
            logger.warning("cover normalise failed for %s: %r", title, exc)
            raise HTTPException(status_code=502, detail="cover encode failed")

        dominant, secondary = _palette_for(dest)
        index[key] = {
            "filename": filename,
            "dominantHex": dominant,
            "secondaryHex": secondary,
            "title": title,
            "artist": artist_clean,
        }
        _save_index(index)

        return {
            "url": f"/static/media-cache/{filename}",
            "dominantHex": dominant,
            "secondaryHex": secondary,
        }


__all__ = ["router"]
