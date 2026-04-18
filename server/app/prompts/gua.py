"""Gua interpretation prompt.

NOTE: archive/server-mvp/prompts.js:759-803 — buildGuaMessages.
"""
from __future__ import annotations

from typing import Any, Optional


_SYSTEM_LINES = [
    '你是一位精通周易的占卦师。你的分析必须严格基于本次起卦得到的卦辞 + 大象辞，'
    '禁止编造其他卦辞或引述未提供的卦。',
    '',
    '【输出格式 — 严格】',
    '只输出四段，每段之间用空行分隔，每段第一行是 "§" 加段名：',
    '',
    '§卦象',
    '一句话点出本卦的核心意象（如"雷雨同作，险中开路"），描述上下卦组合的画面。1-2 句。',
    '',
    '§原文',
    '把卦辞和大象辞用 > 引用符照抄一遍。先卦辞后大象。',
    '',
    '§白话',
    '把卦辞 + 大象用现代汉语翻译，告诉用户这卦在讲什么核心情境。3-4 句。',
    '',
    '§你的问题',
    '把卦的意象 / 古义对照用户的问题，给一个具体的判断（适合 / 不适合 / 慎重 / 顺势 / 等待）'
    '+ 一句行动建议。3-5 句。',
    '',
    '【硬约束】',
    '- 第一个字必须是 "§"，不要任何前言（"以下是占卦结果："等）',
    '- 引用古文必须从下面 <classical> 内逐字摘',
    '- 不要扯爻辞、互卦、变卦——本轮 MVP 只看本卦',
]


def build_messages(
    question: str,
    gua: dict[str, Any],
    birth_context: Optional[dict[str, Any]],
) -> list[dict]:
    """NOTE: prompts.js:759-803."""
    sys = "\n".join(_SYSTEM_LINES)

    gua_info = "\n".join([
        '【本次起卦】',
        '卦象：' + gua["symbol"] + '（' + gua["name"] + ' · 上' + gua["upper"]
            + '下' + gua["lower"] + '）',
        '起卦时刻：' + str(gua.get("drawn_at") or ""),
        '起卦推算：' + str((gua.get("source") or {}).get("formula") or ""),
        '',
        '<classical source="周易·' + gua["name"] + '">',
        '卦辞：' + gua["guaci"],
        '大象：' + gua["daxiang"],
        '</classical>',
    ])

    ctx_block = ""
    if birth_context:
        ctx_block = (
            '【命主背景】日主 ' + str(birth_context.get("rizhu") or "?")
            + '，当前大运 ' + str(birth_context.get("currentDayun") or "?")
            + '，当前流年 ' + str(birth_context.get("currentYear") or "?") + '。'
        )

    system_content = sys + "\n\n" + gua_info + (("\n\n" + ctx_block) if ctx_block else "")
    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": "我的问题：" + question},
    ]
