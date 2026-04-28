"""Book-like index table for local BaZi classics."""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from app.prompts.loader import _repo_root
from app.retrieval.loader import read_classic, strip_frontmatter


BOOK_LABELS: dict[str, str] = {
    "ditian-sui": "滴天髓",
    "qiongtong-baojian": "穷通宝鉴",
    "sanming-tonghui": "三命通会",
    "yuanhai-ziping": "渊海子平",
    "ziping-zhenquan": "子平真诠",
}


@dataclass(frozen=True)
class ClassicIndexEntry:
    id: str
    file: str
    source: str
    title: str
    roles: tuple[str, ...]
    headings: tuple[str, ...]
    preview: str


def _clean_heading(text: str) -> str:
    value = re.sub(r"^#{1,6}\s*", "", str(text or "")).strip()
    value = re.sub(r"^[一二三四五六七八九十百\d]+[、.．]\s*", "", value).strip()
    return value


def _title_from_content(content: str, fallback: str) -> str:
    for line in content.splitlines():
        if line.startswith("#"):
            return _clean_heading(line) or fallback
    return fallback


def _headings_from_content(content: str, title: str, limit: int = 12) -> tuple[str, ...]:
    out: list[str] = []
    for line in content.splitlines():
        if not line.startswith("#"):
            continue
        heading = _clean_heading(line)
        if not heading or heading == title or heading in out:
            continue
        out.append(heading)
        if len(out) >= limit:
            break
    return tuple(out)


def _is_meta_line(line: str) -> bool:
    text = line.strip()
    return (
        not text
        or text.startswith("#")
        or text.startswith("|")
        or text.startswith("**")
        or text.startswith("---")
        or text.startswith(">")
        or bool(re.match(r"^(来源|作者|原著|编者|评注)[:：]", text))
    )


def _preview_from_content(content: str, max_chars: int = 120) -> str:
    pieces: list[str] = []
    for raw in strip_frontmatter(content).splitlines():
        line = re.sub(r"^>\s*", "", raw).strip()
        if _is_meta_line(line):
            continue
        pieces.append(line)
        if sum(len(piece) for piece in pieces) >= max_chars:
            break
    preview = " ".join(pieces)
    preview = re.sub(r"\s+", " ", preview).strip()
    return preview[:max_chars]


def _should_index(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    if name.startswith("00_") or name in {"00_readme.md", "FILENAME_MAP.md"}:
        return False
    return rel.count("/") == 1 and rel.endswith(".md")


def _append_role(roles: list[str], *items: str) -> None:
    for item in items:
        if item and item not in roles:
            roles.append(item)


def _roles_for_entry(rel: str, title: str, headings: tuple[str, ...]) -> tuple[str, ...]:
    """Annotate chapters with the retrieval roles from docs/bazi-analysis."""
    book = rel.split("/", 1)[0]
    haystack = " ".join([rel, title, *headings])
    roles: list[str] = []

    if book == "qiongtong-baojian":
        _append_role(roles, "调候用神", "日干月令", "寒暖燥湿")
        for gan in "甲乙丙丁戊己庚辛壬癸":
            if gan in title:
                _append_role(roles, gan + "日主")

    elif book == "ziping-zhenquan":
        if any(key in haystack for key in ("用神", "格局", "成败", "救应", "相神", "杂气", "建禄", "月劫")):
            _append_role(roles, "格局成败", "月令取格")
        if "偏官" in haystack:
            _append_role(roles, "官杀处理", "七杀格", "制化")
        if "正官" in haystack:
            _append_role(roles, "官星", "正官格")
        if "印绶" in haystack:
            _append_role(roles, "印绶", "生身", "化杀")
        if "财" in haystack:
            _append_role(roles, "财星", "财格")
        if "食神" in haystack:
            _append_role(roles, "食神", "泄秀", "食神制杀")
        if "伤官" in haystack:
            _append_role(roles, "伤官", "泄秀")
        if "阳刃" in haystack:
            _append_role(roles, "阳刃", "逆用格")
        if any(key in haystack for key in ("行运", "取运")):
            _append_role(roles, "大运流年", "取运")
        if any(key in haystack for key in ("宫分", "妻子")):
            _append_role(roles, "六亲", "关系")
        if any(key in haystack for key in ("配气候", "气候")):
            _append_role(roles, "调候辅助")
        if any(key in haystack for key in ("刑冲", "会合", "合而不合", "变化")):
            _append_role(roles, "合冲变化")

    elif book == "ditian-sui":
        if "衰旺" in haystack:
            _append_role(roles, "整体气势", "身弱身强", "从格")
        if "官杀" in haystack:
            _append_role(roles, "官杀处理", "制杀", "财星坏印")
        if "通关" in haystack:
            _append_role(roles, "通关", "制化")
        if "理气" in haystack:
            _append_role(roles, "整体气势", "气机流转", "制化")
        if "月令" in haystack:
            _append_role(roles, "月令", "旺衰")
        if "寒暖" in haystack:
            _append_role(roles, "调候寒暖", "寒暖燥湿")
        if "燥湿" in haystack:
            _append_role(roles, "调候燥湿", "寒暖燥湿")
        if "性情" in haystack:
            _append_role(roles, "性格类象")
        if any(key in haystack for key in ("夫妻", "子女", "父母", "兄弟", "女命")):
            _append_role(roles, "六亲", "关系")
        if any(key in haystack for key in ("形象", "方局", "八格", "从象", "化象")):
            _append_role(roles, "整体气势", "特殊格局")

    elif book == "sanming-tonghui":
        if "juan-03" in rel:
            _append_role(roles, "神煞", "纳音")
        elif "juan-04" in rel:
            _append_role(roles, "十干坐支")
        elif "juan-06" in rel:
            _append_role(roles, "特殊格局")
        elif "juan-07" in rel:
            _append_role(roles, "性情相貌", "外貌")
        elif "juan-08" in rel or "juan-09" in rel:
            _append_role(roles, "日时断", "辅助判断")
        else:
            _append_role(roles, "辅助旁证")

    elif book == "yuanhai-ziping":
        if any(key in haystack for key in ("干支体象", "五行基础")):
            _append_role(roles, "排盘验证", "干支定义")
        if any(key in haystack for key in ("正官", "偏官", "七杀", "食神", "伤官", "财", "印绶", "十神")):
            _append_role(roles, "十神辅助")
        if any(key in haystack for key in ("魁罡", "金神", "阳刃", "神煞")):
            _append_role(roles, "特殊格局", "神煞")
        if "从杀" in haystack or "弃命" in haystack:
            _append_role(roles, "从格辅助")

    return tuple(roles or ("辅助旁证",))


@lru_cache(maxsize=1)
def classics_index_entries() -> tuple[ClassicIndexEntry, ...]:
    root = _repo_root() / "classics"
    rows: list[ClassicIndexEntry] = []
    for path in sorted(root.glob("*/*.md")):
        rel = path.relative_to(root).as_posix()
        if not _should_index(rel):
            continue
        content = read_classic(rel)
        if not content:
            continue
        fallback = path.stem.replace("-", " ").replace("_", " ")
        title = _title_from_content(content, fallback)
        headings = _headings_from_content(content, title)
        book = BOOK_LABELS.get(rel.split("/", 1)[0], "古籍")
        rows.append(
            ClassicIndexEntry(
                id=f"C{len(rows) + 1:03d}",
                file=rel,
                source=f"{book}·{title}",
                title=title,
                roles=_roles_for_entry(rel, title, headings),
                headings=headings,
                preview=_preview_from_content(content),
            )
        )
    return tuple(rows)


def entry_for_file(file: str) -> ClassicIndexEntry | None:
    for entry in classics_index_entries():
        if entry.file == file:
            return entry
    return None


def entry_by_id(entry_id: str) -> ClassicIndexEntry | None:
    needle = str(entry_id or "").strip().upper()
    for entry in classics_index_entries():
        if entry.id == needle:
            return entry
    return None


def build_classics_index_table() -> str:
    lines = []
    for entry in classics_index_entries():
        roles = " / ".join(entry.roles)
        roles = f" | 领域:{roles}" if roles else ""
        headings = " / ".join(entry.headings)
        if headings:
            headings = f" | 目录:{headings}"
        preview = f" | 摘:{entry.preview}" if entry.preview else ""
        lines.append(f"[{entry.id}] {entry.source}{roles}{headings}{preview}")
    return "\n".join(lines)
