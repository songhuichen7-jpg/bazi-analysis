"""Stage 1 router: keyword fast-path + LLM intent classifier.

NOTE: archive/server-mvp/prompts.js:367-466 — KEYWORDS, PRIORITY,
classifyByKeywords, buildRouterMessages, parseRouterJSON.
"""
from __future__ import annotations

import json
import re
from typing import Optional

# NOTE: prompts.js:367-373
INTENTS: list[str] = [
    "relationship", "career", "wealth", "timing",
    "personality", "health", "meta", "chitchat", "other",
    "dayun_step", "liunian",
    "appearance", "special_geju",
    "divination",
]

# NOTE: prompts.js:375-387 — keyword sets (order within list does not matter)
KEYWORDS: dict[str, list[str]] = {
    "divination":   ['起卦','占卜','卦象','该不该','能不能','测一下','求一卦','占一下','问卦','吉凶','宜不宜','起一卦','要不要','合适吗','适合吗','适合','值不值','会成吗','可以吗','好不好'],
    "timing":       ['今年','明年','后年','大运','流年','这几年','最近几年','下半年','上半年','几岁','什么时候','何时','哪一年','近几年'],
    "relationship": ['感情','恋爱','爱情','对象','正缘','姻缘','婚姻','结婚','离婚','老公','老婆','配偶','男朋友','女朋友','暗恋','分手','复合','桃花'],
    "appearance":   ['长相','外貌','相貌','颜值','好看','好不好看','丑','帅','漂亮','胖瘦','身材','高矮','皮肤','脸型','五官','长得'],
    "career":       ['事业','工作','职业','跳槽','换工作','转行','创业','辞职','升职','老板','同事','上司','行业','方向','发展'],
    "wealth":       ['财运','钱','收入','投资','理财','副业','赚钱','亏钱','破财','存款','房产','买房'],
    "health":       ['身体','健康','生病','失眠','焦虑','抑郁','情绪','养生','压力大','累'],
    "special_geju": ['特殊格局','飞天禄马','倒冲','井栏叉','朝阳格','六乙鼠贵','六阴朝阳','金神格','魁罡','日刃','从格','化格','专旺','曲直'],
    "meta":         ['七杀','正官','正财','偏财','食神','伤官','正印','偏印','比肩','劫财','格局','用神','日主','十神','什么意思','怎么理解','是什么'],
    "personality":  ['性格','脾气','我这个人','我是不是','我是不是太','自我','待自己'],
    "chitchat":     ['你好','您好','hi','hello','谢谢','多谢','辛苦了','感谢','再见'],
}

# NOTE: prompts.js:391 — divination must come before timing/relationship
PRIORITY: list[str] = [
    "divination", "timing", "relationship", "appearance",
    "career", "wealth", "health", "special_geju",
    "meta", "personality", "chitchat",
]


def classify_by_keywords(user_message: Optional[str]) -> Optional[dict]:
    """Return {intent, reason, source} on hit; None on miss.

    NOTE: prompts.js:393-412.
    """
    if not user_message:
        return None
    text = str(user_message).lower()
    for intent in PRIORITY:
        if intent == "chitchat":
            continue
        for kw in KEYWORDS[intent]:
            if kw.lower() in text:
                return {"intent": intent, "reason": "kw:" + kw, "source": "keyword"}
    if len(str(user_message).strip()) <= 8:
        for kw in KEYWORDS["chitchat"]:
            if kw.lower() in text:
                return {"intent": "chitchat", "reason": "kw:" + kw, "source": "keyword"}
    return None


# NOTE: prompts.js:414-449 — verbatim Chinese system prompt
_SYSTEM_LINES = [
    '你是一个意图分类器。读用户最近几轮对话和当前消息，输出一个 JSON：',
    '{"intent": "<one of the list>", "reason": "<一句不超 20 字的判断依据>"}',
    '',
    '可选 intent（严格从中选一个）：',
    '- relationship  关系、感情、正缘、婚姻、配偶、亲密关系、家人',
    '- appearance    外貌、长相、相貌、身材、五官（自身或配偶）',
    '- special_geju  问到具体的特殊格局：飞天禄马、倒冲、六阴朝阳、魁罡、金神、日刃、从格、化格 等',
    '- career        事业、工作、方向、转行、创业、辞职、读书深造',
    '- wealth        财运、投资、副业、赚钱、破财',
    '- timing        大运、流年、今年、明年、某个具体岁数、时机',
    '- personality   自我性格、内在特质、如何看待自己',
    '- health        身体、情绪、睡眠、养生',
    '- meta          对命理概念本身的提问（如"什么是七杀"、"我的格局是什么意思"）',
    '- divination    用户在问一件具体的事"该不该/要不要/能不能/合不合适"——这类是非决策题，适合用起卦辅助，不适合直接用命盘分析回答',
    '- chitchat      打招呼、致谢、闲聊、测试',
    '- other         以上都不贴切的兜底',
    '',
    '规则：',
    '- 有上下文时按上下文判断（如上一轮在聊工作、这轮"那今年呢" → timing）',
    '- 只输出 JSON，第一个字符必须是 "{"，不要前言、不要 ```json 围栏',
    '- reason 用中文，一句话',
]


def build_messages(history: list[dict], user_message: str) -> list[dict]:
    """Build router LLM messages: system + last 4 history + user.

    NOTE: prompts.js:414-449.
    """
    sys = "\n".join(_SYSTEM_LINES)
    hist = [
        {"role": h["role"], "content": str(h.get("content") or "")[:300]}
        for h in (history or [])[-4:]
    ]
    return [{"role": "system", "content": sys}, *hist, {"role": "user", "content": user_message}]


def parse_router_json(raw: Optional[str]) -> dict:
    """Defensive parser. Returns {intent, reason}; falls back to 'other' on any failure.

    NOTE: prompts.js:451-466.
    """
    if not raw:
        return {"intent": "other", "reason": "empty_response"}
    s = str(raw).strip()
    # Try direct JSON first
    try:
        j = json.loads(s)
        if isinstance(j, dict) and j.get("intent") in INTENTS:
            return {"intent": j["intent"], "reason": str(j.get("reason") or "")}
    except (ValueError, TypeError):
        pass
    # Fall back to regex extract first {...} block
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        try:
            j = json.loads(m.group(0))
            if isinstance(j, dict) and j.get("intent") in INTENTS:
                return {"intent": j["intent"], "reason": str(j.get("reason") or "")}
        except (ValueError, TypeError):
            pass
    return {"intent": "other", "reason": "parse_failed"}
