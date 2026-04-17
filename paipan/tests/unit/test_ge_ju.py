from paipan.ge_ju import compute_ge_ju_and_guards


def test_returns_ge_ju_string():
    paipan = {
        "year": {"gan": "癸", "zhi": "巳"},
        "month": {"gan": "甲", "zhi": "子"},
        "day":   {"gan": "丁", "zhi": "酉"},
        "hour":  {"gan": "甲", "zhi": "辰"},
    }
    force = {"比肩": 1.0, "劫财": 0.0, "食神": 0.5, "伤官": 0.0,
             "偏财": 0.0, "正财": 1.0, "七杀": 0.0, "正官": 2.0,
             "偏印": 1.5, "正印": 0.5}
    r = compute_ge_ju_and_guards(paipan, day_gan="丁", force=force)
    assert "geJu" in r
    assert "guards" in r
    assert isinstance(r["geJu"], str)
    assert isinstance(r["guards"], list)
