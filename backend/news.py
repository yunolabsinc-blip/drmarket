"""
뉴스 조회
- NAVER_CLIENT_ID/SECRET 이 설정되면 네이버 뉴스 검색 API (정식 경로)
- 없으면 구글 뉴스 RSS (키 불필요). 제목·매체·시각·링크만 사용하고 본문은 가져오지 않는다.
"""

import asyncio
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

_cache: dict[str, tuple[float, list]] = {}
_CACHE_SEC = 300

# 통합 뉴스 기본 검색어 (주제별)
MARKET_TOPICS = {
    "market": "증시 OR 코스피 OR 코스닥",
    "feature": "특징주",
    "global": "뉴욕증시 OR 나스닥 OR 연준",
    "economy": "금리 OR 환율 OR 경제",
}


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'").strip()


def _iso(dt: datetime | None) -> str:
    return dt.astimezone(KST).isoformat() if dt else ""


async def _google_rss(query: str, when: str = "") -> list[dict]:
    q = f"{query} when:{when}" if when else query
    url = f"https://news.google.com/rss/search?q={quote(q)}&hl=ko&gl=KR&ceid=KR:ko"
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "Mozilla/5.0 (drmarket)"}) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
    except Exception as e:
        logger.warning("[NEWS] RSS 실패 %s: %s", query, e)
        return []
    items = []
    for it in root.findall("./channel/item"):
        title = it.findtext("title") or ""
        src = it.find("source")
        source = src.text.strip() if src is not None and src.text else ""
        # 구글 RSS 제목은 "제목 - 매체명" 형식
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        try:
            dt = parsedate_to_datetime(it.findtext("pubDate") or "")
        except Exception:
            dt = None
        items.append({"title": _strip_html(title), "source": source, "time": _iso(dt), "link": it.findtext("link") or ""})
    return items


async def _naver(query: str, count: int) -> list[dict] | None:
    cid, sec = os.getenv("NAVER_CLIENT_ID", ""), os.getenv("NAVER_CLIENT_SECRET", "")
    if not (cid and sec):
        return None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://openapi.naver.com/v1/search/news.json",
                params={"query": query, "display": min(count, 100), "sort": "date"},
                headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": sec},
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
    except Exception as e:
        logger.warning("[NEWS] 네이버 실패 %s: %s", query, e)
        return None
    out = []
    for it in items:
        try:
            dt = parsedate_to_datetime(it.get("pubDate", ""))
        except Exception:
            dt = None
        link = it.get("link") or it.get("originallink") or ""
        host = re.sub(r"^https?://(www\.)?", "", it.get("originallink", "")).split("/")[0]
        out.append({"title": _strip_html(it.get("title")), "source": host, "time": _iso(dt), "link": link})
    return out


async def search(query: str, count: int = 20, when: str = "") -> list[dict]:
    key = f"{query}|{count}|{when}"
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_SEC:
        return hit[1]
    items = await _naver(query, count)
    if items is None:
        items = await _google_rss(query, when)
    items = items[:count]
    _cache[key] = (time.monotonic(), items)
    return items


async def market_news(topic: str = "market", count: int = 30) -> list[dict]:
    """통합 뉴스: 최근 1일, 주제별"""
    query = MARKET_TOPICS.get(topic, MARKET_TOPICS["market"])
    return await search(query, count, when="1d")


async def stock_news(name: str, count: int = 10) -> list[dict]:
    return await search(f"{name} 주가", count)


async def headlines(count: int = 5) -> list[dict]:
    """홈 화면용: 증시·특징주 섞어서 최신순"""
    a, b = await asyncio.gather(market_news("market", 10), market_news("feature", 10))
    seen, out = set(), []
    for it in sorted(a + b, key=lambda x: x["time"], reverse=True):
        if it["title"] in seen:
            continue
        seen.add(it["title"])
        out.append(it)
    return out[:count]
