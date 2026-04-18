"""Classics file reader + per-book section extractors.

Port of archive/server-mvp/retrieval.js:1-240 (file I/O + per-source helpers).
@lru_cache per file; files resolved relative to classics/ under BAZI_REPO_ROOT.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from app.prompts.loader import _repo_root

# NOTE: retrieval.js:13-24
QIONGTONG_FILE: dict[str, str] = {
    "甲": "qiongtong-baojian/02_lun-jia-mu.md",
    "乙": "qiongtong-baojian/03_lun-yi-mu.md",
    "丙": "qiongtong-baojian/04_lun-bing-huo.md",
    "丁": "qiongtong-baojian/05_lun-ding-huo.md",
    "戊": "qiongtong-baojian/06_lun-wu-tu.md",
    "己": "qiongtong-baojian/07_lun-ji-tu.md",
    "庚": "qiongtong-baojian/08_lun-geng-jin.md",
    "辛": "qiongtong-baojian/09_lun-xin-jin.md",
    "壬": "qiongtong-baojian/10_lun-ren-shui.md",
    "癸": "qiongtong-baojian/11_lun-gui-shui.md",
}

# NOTE: retrieval.js:26-29
GAN_WUXING: dict[str, str] = {
    "甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土",
    "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水",
}

# NOTE: retrieval.js:31-44
ZHI_TO_MONTH: dict[str, dict[str, str]] = {
    "寅": {"num": "正月", "season": "三春"},
    "卯": {"num": "二月", "season": "三春"},
    "辰": {"num": "三月", "season": "三春"},
    "巳": {"num": "四月", "season": "三夏"},
    "午": {"num": "五月", "season": "三夏"},
    "未": {"num": "六月", "season": "三夏"},
    "申": {"num": "七月", "season": "三秋"},
    "酉": {"num": "八月", "season": "三秋"},
    "戌": {"num": "九月", "season": "三秋"},
    "亥": {"num": "十月", "season": "三冬"},
    "子": {"num": "十一月", "season": "三冬"},
    "丑": {"num": "十二月", "season": "三冬"},
}


@lru_cache(maxsize=None)
def read_classic(rel_path: str) -> str:
    """Return classics/<rel_path> content, or '' if missing."""
    p = _repo_root() / "classics" / rel_path
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def extract_qiongtong_section(content: str, day_gan: str, month_zhi: str) -> str | None:
    """Port of retrieval.js:46-78.

    Extract the <day_gan> × <month_zhi> section from 穷通宝鉴 file content.
    Returns the extracted text string, or None if conf missing.
    """
    # NOTE: retrieval.js:47-50
    conf = ZHI_TO_MONTH.get(month_zhi)
    if not conf:
        return None
    result = _extract_qiongtong_section_detail(content, day_gan, month_zhi)
    if result is None:
        return None
    return result["text"]


def _extract_qiongtong_section_detail(content: str, day_gan: str, month_zhi: str) -> dict | None:
    """Internal helper returning {text, scope, heading}.

    Port of retrieval.js:46-82 with full metadata preserved for the service layer.
    """
    conf = ZHI_TO_MONTH.get(month_zhi)
    if not conf:
        return None
    num = conf["num"]
    season = conf["season"]
    wx = GAN_WUXING.get(day_gan, "")

    lines = content.split("\n")

    # NOTE: retrieval.js:53-57 — find ### <season><dayGan><wx> heading
    season_head_re = re.compile(r"^###\s*" + re.escape(season + day_gan + wx))
    start_idx = -1
    for i, line in enumerate(lines):
        if season_head_re.match(line):
            start_idx = i
            break

    # NOTE: retrieval.js:58-60 — fallback if season heading not found
    if start_idx == -1:
        return {"text": content[:2000], "scope": "fallback", "heading": "(未找到季节章节)"}

    # NOTE: retrieval.js:62-67 — collect season block until next heading
    out = []
    for i in range(start_idx, len(lines)):
        if i > start_idx and re.match(r"^#{1,3}\s", lines[i]):
            break
        out.append(lines[i])
    season_block = "\n".join(out).strip()
    season_heading = lines[start_idx].strip()

    # NOTE: retrieval.js:70-76 — find month-specific paragraph within season block
    num_char = num.replace("月", "")
    paras = re.split(r"\n\s*\n", season_block)

    def para_matches(p: str) -> bool:
        body = re.sub(r"^#+\s.*\n?", "", p)
        pattern = r"(^|[^一二三四五六七八九十])" + re.escape(num_char) + r"[一二三四五六七八九十]{0,2}月" + re.escape(day_gan + wx) + r"[，,]"
        return bool(re.search(pattern, body)) or (num + day_gan + wx) in body

    hit = [p for p in paras if para_matches(p)]

    # NOTE: retrieval.js:78-82
    if hit:
        text = season_heading + "\n\n" + "\n\n".join(hit)
        return {"text": text, "scope": "month", "heading": season_heading + " / " + num + day_gan + wx}
    return {"text": season_block, "scope": "season", "heading": season_heading}


def strip_frontmatter(text: str) -> str:
    """Port of retrieval.js:197-204 — remove YAML frontmatter if present.

    Scans up to the first 10 lines for a '---' divider and slices from there.
    """
    lines = text.split("\n")
    cut = 0
    for i in range(min(len(lines), 10)):
        if re.match(r"^---\s*$", lines[i]):
            cut = i + 1
            break
    return "\n".join(lines[cut:]).strip()


def extract_by_heading(content: str, keyword: str) -> str | None:
    """Port of retrieval.js:211-231 — extract section by heading substring.

    Matches any H2-H4 heading that contains *keyword*.
    Returns the heading + body until next heading of equal-or-higher level.
    Returns None if not found.
    """
    lines = content.split("\n")
    heading_re = re.compile(r"^(#{2,4})\s+")
    start = -1
    level = 0
    for i, line in enumerate(lines):
        m = heading_re.match(line)
        if m and keyword in line:
            start = i
            level = len(m.group(1))
            break
    if start == -1:
        return None
    out = [lines[start]]
    for i in range(start + 1, len(lines)):
        m = heading_re.match(lines[i])
        if m and len(m.group(1)) <= level:
            break
        out.append(lines[i])
    return "\n".join(out).strip()
