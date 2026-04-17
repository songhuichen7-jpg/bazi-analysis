from paipan.force import compute_force


def test_force_returns_ten_gods_scores():
    paipan = {
        "year": {"gan": "癸", "zhi": "巳"},
        "month": {"gan": "甲", "zhi": "子"},
        "day":   {"gan": "丁", "zhi": "酉"},
        "hour":  {"gan": "甲", "zhi": "辰"},
    }
    r = compute_force(paipan, day_gan="丁")
    for key in ("比肩","劫财","食神","伤官","偏财","正财","七杀","正官","偏印","正印"):
        assert key in r
        assert isinstance(r[key], (int, float))


def test_force_sum_not_zero():
    paipan = {
        "year": {"gan": "癸", "zhi": "巳"},
        "month": {"gan": "甲", "zhi": "子"},
        "day":   {"gan": "丁", "zhi": "酉"},
        "hour":  {"gan": "甲", "zhi": "辰"},
    }
    r = compute_force(paipan, day_gan="丁")
    assert sum(r.values()) > 0
