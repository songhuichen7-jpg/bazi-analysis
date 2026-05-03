"""In-memory sliding-window rate limiter for /api/ endpoints.

为什么自写不用 slowapi：
  - 内测期 1 worker 单进程，不需要 redis
  - slowapi 多一份依赖 + 接入要改不少装饰器，杠杆不大
  - 这里 ~70 行就够：滑动窗口 + 按 user_id / IP 分桶 + 头部回写

策略：
  - GET /api/health, /api/config, /api/cities, /api/auth/me 不限流
    （健康检查 + 公共只读 + 登录态心跳，这些是高频低成本，挡住会扰民）
  - 其余 /api/ 路由共享一个全局窗口，60 req/min/key
  - key 优先级：session cookie 解出来的 user_id > X-Forwarded-For > 直连 client.host
  - 超额返 429 + Retry-After 头，body 跟既有 ServiceError 一致

只在 settings.rate_limit_enabled 开启时挂；test 默认关闭以免污染。
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


# 不限流的路径（前缀匹配）— 健康检查、公共只读、auth me 心跳
_EXEMPT_PREFIXES = (
    "/api/health",
    "/api/config",
    "/api/cities",
    "/api/auth/me",        # 登录态滑窗刷新，前端会高频调（rolling session）
    "/static/",            # 静态资源
)


def _is_exempt(path: str) -> bool:
    return any(path.startswith(p) for p in _EXEMPT_PREFIXES)


class _SlidingWindow:
    """每个 key 一个 deque，存最近 window_seconds 内的请求时间戳（秒）。

    pop 老数据 O(k) 但每次最多弹到 limit 这么多，所以摊销 O(1) per request。
    单 lock 保护多请求竞争 — 内存级操作，开销极小。
    """

    __slots__ = ("limit", "window_seconds", "_buckets", "_lock")

    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = max(1, int(limit))
        self.window_seconds = float(window_seconds)
        self._buckets: dict[str, Deque[float]] = {}
        self._lock = asyncio.Lock()

    async def hit(self, key: str) -> tuple[bool, float]:
        """Returns (allowed, retry_after_seconds).

        retry_after_seconds: 当 allowed=False 时等多久再试；allowed=True 时为 0。
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds
        async with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = deque()
                self._buckets[key] = bucket
            # 弹出超出窗口的老时间戳
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                # 最老那条还要多久才能滑出窗口
                retry_after = self.window_seconds - (now - bucket[0])
                return False, max(retry_after, 1.0)
            bucket.append(now)
            return True, 0.0


class RateLimitMiddleware(BaseHTTPMiddleware):
    """挂在 main.py 的 ASGI 栈最外层。

    顺序敏感：必须在能解出 user_id 的下游（auth）之前能拿到 cookie，
    我们这里直接读 session cookie hash 作为 key，不依赖 auth dep
    （middleware 跑在 dep 之前）。未登录则用 IP。
    """

    def __init__(self, app: ASGIApp, *, limit_per_minute: int) -> None:
        super().__init__(app)
        self._window = _SlidingWindow(limit_per_minute, window_seconds=60.0)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or _is_exempt(path):
            return await call_next(request)
        key = self._key_for(request)
        allowed, retry_after = await self._window.hit(key)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": {
                        "code": "RATE_LIMITED",
                        "message": "请求太频繁，喘口气再试。",
                        "details": {"retry_after_seconds": int(retry_after)},
                    },
                },
                headers={"Retry-After": str(int(retry_after))},
            )
        return await call_next(request)

    @staticmethod
    def _key_for(request: Request) -> str:
        # session cookie 是 sha256 token 的前 N 字符（具体见 auth.py），不
        # 解析就拿原文当 key 即可——同一会话同一 key，足够分桶。
        cookie = request.cookies.get("session")
        if cookie:
            return f"sess:{cookie[:32]}"
        # 未登录 fallback 到 IP — 反代场景看 X-Forwarded-For 第一个 hop
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return f"ip:{xff.split(',')[0].strip()}"
        client = request.client
        return f"ip:{client.host if client else 'unknown'}"
