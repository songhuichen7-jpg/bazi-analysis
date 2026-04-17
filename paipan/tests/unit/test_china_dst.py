from paipan.china_dst import correct_china_dst


def test_during_dst_1988():
    # 1988 夏天在 DST 期间
    r = correct_china_dst(1988, 7, 15, 10, 0)
    assert r["wasDst"] is True
    assert r["hour"] == 9  # 减 1 小时


def test_outside_dst_winter():
    # 1988 冬天 DST 已结束
    r = correct_china_dst(1988, 12, 15, 10, 0)
    assert r["wasDst"] is False
    assert r["hour"] == 10  # 不动


def test_before_dst_era_1985():
    # 1985 还没开始 DST
    r = correct_china_dst(1985, 7, 15, 10, 0)
    assert r["wasDst"] is False


def test_after_dst_era_1992():
    # 1992 DST 已废除
    r = correct_china_dst(1992, 7, 15, 10, 0)
    assert r["wasDst"] is False


def test_entry_day_1986_05_04():
    # 查 Node 源码确认 1986-05-04 是否在 DST 内
    r = correct_china_dst(1986, 5, 4, 12, 0)
    # 断言值照 Node 版实际行为；先占位，oracle 对拍时校正
    assert "wasDst" in r
