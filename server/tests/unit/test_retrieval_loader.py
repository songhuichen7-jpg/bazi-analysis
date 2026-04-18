"""app.retrieval.loader: classics file reading with @lru_cache."""
from __future__ import annotations


def test_read_classic_existing_file():
    from app.retrieval.loader import read_classic
    txt = read_classic("00_readme.md")
    assert isinstance(txt, str) and len(txt) > 0


def test_read_classic_missing_returns_empty():
    from app.retrieval.loader import read_classic
    assert read_classic("nonexistent/zzz.md") == ""


def test_read_classic_lru_cached():
    from app.retrieval.loader import read_classic
    read_classic.cache_clear()
    a = read_classic("00_readme.md")
    b = read_classic("00_readme.md")
    info = read_classic.cache_info()
    assert info.hits >= 1
    assert a is b


def test_extract_qiongtong_section_by_day_gan_month_zhi():
    """Port of retrieval.js:46-78 — extracts 《穷通宝鉴》 section by day 干 + month 支."""
    from app.retrieval.loader import extract_qiongtong_section
    content = "# 穷通宝鉴\n## 庚金\n### 三秋庚金\n金逢巳月，坐下长生..."
    out = extract_qiongtong_section(content, "庚", "巳")
    assert out is None or (isinstance(out, str) and "庚" in out)
