"""
뉴스 조회
- 통합 뉴스: 언론사 공개 RSS(연합뉴스·파이낸셜뉴스·조선비즈 증권/경제 섹션). 제목·요약·매체·시각·원문 링크.
- 종목 뉴스: NAVER_CLIENT_ID/SECRET 이 있으면 네이버 뉴스 검색(요약 포함), 없으면 위 피드에서 종목명 검색 + 구글 뉴스 RSS 보충.
본문은 가져오지 않고 피드가 제공하는 요약만 사용한다.
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
UA = {"User-Agent": "Mozilla/5.0 (compatible; drmarket/1.0)"}

_cache: dict[str, tuple[float, list]] = {}

# 언론사 RSS (공개 피드). (매체명, 주소)
FEEDS = {
    "market": [   # 증시 전용 섹션
        ("연합뉴스", "https://www.yna.co.kr/rss/market.xml"),
        ("파이낸셜뉴스", "https://www.fnnews.com/rss/r20/fn_realnews_stock.xml"),
    ],
    "biz": [      # 금융 전반 (특징주·해외·종목 검색 보충용)
        ("조선비즈", "https://biz.chosun.com/arc/outboundfeeds/rss/category/stock/?outputType=xml"),
    ],
    "economy": [
        ("연합뉴스", "https://www.yna.co.kr/rss/economy.xml"),
    ],
}
GLOBAL_RE = re.compile(r"뉴욕|나스닥|월가|연준|다우|S&P|美\s?증시|미국\s?증시|엔비디아|테슬라|애플|FOMC|달러")
FEATURE_RE = re.compile(r"특징주")


def _strip_html(text: str) -> str:
    text = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", text or "", flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def _iso(dt: datetime | None) -> str:
    return dt.astimezone(KST).isoformat() if dt else ""


def _parse_date(s: str) -> datetime | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return parsedate_to_datetime(s)
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(s[:25] if "T" in s else s[:19], fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=KST)
        except Exception:
            continue
    return None


async def _fetch_xml(url: str) -> ET.Element | None:
    try:
        async with httpx.AsyncClient(timeout=8, headers=UA, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return ET.fromstring(resp.content)
    except Exception as e:
        logger.warning("[NEWS] 피드 실패 %s: %s", url, e)
        return None


async def _feed(source: str, url: str) -> list[dict]:
    key = f"feed:{url}"
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < 180:
        return hit[1]
    root = await _fetch_xml(url)
    items = []
    for it in (root.findall("./channel/item") if root is not None else []):
        title = _strip_html(it.findtext("title") or "")
        if not title:
            continue
        items.append({
            "title": title,
            "desc": _strip_html(it.findtext("description") or "")[:300],
            "source": source,
            "time": _iso(_parse_date(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date") or "")),
            "link": (it.findtext("link") or "").strip(),
        })
    if items:
        _cache[key] = (time.monotonic(), items)
    return items


async def _google_rss(query: str, when: str = "") -> list[dict]:
    """구글 뉴스 RSS (요약 없음). 피드로 부족할 때 보충용"""
    q = f"{query} when:{when}" if when else query
    root = await _fetch_xml(f"https://news.google.com/rss/search?q={quote(q)}&hl=ko&gl=KR&ceid=KR:ko")
    items = []
    for it in (root.findall("./channel/item") if root is not None else []):
        title = it.findtext("title") or ""
        src = it.find("source")
        source = src.text.strip() if src is not None and src.text else ""
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        else:
            title = re.sub(r"\s+-\s+[^-]{1,30}$", "", title)
        title = re.sub(r"\s+-\s+\S{2,8}$", "", title)
        items.append({"title": _strip_html(title), "desc": "", "source": source,
                      "time": _iso(_parse_date(it.findtext("pubDate"))), "link": it.findtext("link") or ""})
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
        host = re.sub(r"^https?://(www\.)?", "", it.get("originallink", "")).split("/")[0]
        out.append({"title": _strip_html(it.get("title")), "desc": _strip_html(it.get("description"))[:300], "source": host,
                    "time": _iso(_parse_date(it.get("pubDate", ""))), "link": it.get("link") or it.get("originallink") or ""})
    return out


def _dedupe(items: list[dict]) -> list[dict]:
    seen, out = set(), []
    for it in sorted(items, key=lambda x: x["time"], reverse=True):
        k = re.sub(r"\W+", "", it["title"])[:40]
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


async def _feeds(group: str) -> list[dict]:
    results = await asyncio.gather(*[_feed(src, url) for src, url in FEEDS[group]])
    return [it for lst in results for it in lst]


async def market_news(topic: str = "market", count: int = 30) -> list[dict]:
    """통합 뉴스. market=증시, feature=특징주, global=해외, economy=경제"""
    if topic == "economy":
        items = await _feeds("economy")
    elif topic == "feature":
        both = await asyncio.gather(_feeds("market"), _feeds("biz"))
        items = [it for lst in both for it in lst if FEATURE_RE.search(it["title"])]
        if len(items) < 8:
            items += await _google_rss("특징주", "1d")
    elif topic == "global":
        both = await asyncio.gather(_feeds("market"), _feeds("biz"), _feeds("economy"))
        items = [it for lst in both for it in lst if GLOBAL_RE.search(it["title"])]
        if len(items) < 8:
            items += await _google_rss("뉴욕증시 OR 나스닥 OR 연준", "1d")
    else:
        items = await _feeds("market")
    return _dedupe(items)[:count]


async def stock_news(name: str, count: int = 10) -> list[dict]:
    """종목 뉴스: 네이버(설정 시) → 언론사 피드에서 종목명 검색 + 구글 보충"""
    items = await _naver(f"{name} 주가", count)
    if items is not None:
        return items[:count]
    pools = await asyncio.gather(_feeds("market"), _feeds("biz"), _feeds("economy"), _google_rss(f"{name} 주가"))
    key = name.replace(" ", "")
    from_feeds = [it for lst in pools[:3] for it in lst if key in it["title"].replace(" ", "") or key in it["desc"].replace(" ", "")]
    return _dedupe(from_feeds + pools[3])[:count]


async def headlines(count: int = 5) -> list[dict]:
    """홈 화면·뉴스 띠용: 증시 최신"""
    return (await market_news("market", 20))[:count]
