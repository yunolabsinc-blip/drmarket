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
        ("매일경제", "https://www.mk.co.kr/rss/50200011/"),
        ("아시아경제", "https://www.asiae.co.kr/rss/stock.htm"),
    ],
    "biz": [      # 금융·경제 전반 (특징주·해외·종목 검색 보충용)
        ("조선비즈", "https://biz.chosun.com/arc/outboundfeeds/rss/category/stock/?outputType=xml"),
        ("뉴시스", "https://www.newsis.com/RSS/economy.xml"),
    ],
    "economy": [
        ("연합뉴스", "https://www.yna.co.kr/rss/economy.xml"),
    ],
}
GLOBAL_RE = re.compile(r"뉴욕|나스닥|월가|연준|다우|S&P|美\s?증시|미국\s?증시|엔비디아|테슬라|애플|FOMC|달러")
FEATURE_RE = re.compile(r"특징주")
# 국내 특징주만 남기기 위한 제외어 (해외 증시 특징주 코너·외국 기업 기사)
FOREIGN_RE = re.compile(r"중국|홍콩|美|미국|일본|대만|인도|印|유럽|해외|뉴욕|나스닥|월가|개장전특징주|오늘장특징주")


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
        dt = parsedate_to_datetime(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=KST)   # 시간대 없는 피드는 한국 시간으로
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
            try:
                return ET.fromstring(resp.content)
            except ET.ParseError:
                # 잘못된 문자가 섞인 피드는 느슨하게 정리해서 다시 시도
                text = resp.content.decode(resp.encoding or "utf-8", errors="ignore")
                text = re.sub(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", "&amp;", text)
                text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
                return ET.fromstring(text.encode("utf-8"))
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
        domestic = lambda it: FEATURE_RE.search(it["title"]) and not FOREIGN_RE.search(it["title"])
        items = [it for lst in both for it in lst if domestic(it)]
        # 피드에 국내 특징주가 적으면(장외 시간) 구글 뉴스로 보충, 그래도 적으면 3일로 넓힘
        for when in ("1d", "3d"):
            if len(items) >= 8:
                break
            items += [it for it in await _google_rss("특징주", when) if domestic(it)]
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
    """홈 화면·뉴스 띠용: 증시 뉴스와 국내 특징주를 번갈아 섞는다 (특징주가 있으면 먼저)"""
    market, feature = await asyncio.gather(market_news("market", 20), market_news("feature", 20))
    for it in feature:
        it["kind"] = "feature"
    for it in market:
        it.setdefault("kind", "market")
    seen, out = set(), []
    fi, mi = 0, 0
    while len(out) < count and (fi < len(feature) or mi < len(market)):
        # 특징주 → 증시 순으로 번갈아, 중복 제목 제외
        for lst, idx_name in ((feature, "fi"), (market, "mi")):
            i = fi if idx_name == "fi" else mi
            while i < len(lst) and re.sub(r"\W+", "", lst[i]["title"])[:40] in seen:
                i += 1
            if i < len(lst):
                seen.add(re.sub(r"\W+", "", lst[i]["title"])[:40])
                out.append(lst[i])
                i += 1
            if idx_name == "fi":
                fi = i
            else:
                mi = i
            if len(out) >= count:
                break
    return out


# ──────────────────────────────────────────────
# 테마별 오늘의 주요 기사 (테마 타일의 한 줄 요약)
# ──────────────────────────────────────────────
# 테마 id → (검색어, 대표 종목명). 검색어 첫 번째가 대표. web/src/data/themes.json 의 id 와 맞춘다.
THEME_KEYWORDS = {
    "semiconductor": (["반도체", "파운드리", "D램", "낸드", "메모리"], ["삼성전자", "SK하이닉스", "하이닉스", "삼전닉스", "한미반도체", "DB하이텍", "리노공업"]),
    "hbm": (["HBM", "AI반도체", "AI 반도체", "고대역폭"], ["SK하이닉스", "하이닉스", "한미반도체", "이수페타시스", "테크윙", "하나마이크론"]),
    "battery": (["2차전지", "이차전지", "배터리", "양극재", "리튬", "ESS"], ["LG에너지솔루션", "LG엔솔", "삼성SDI", "에코프로", "포스코퓨처엠", "엘앤에프"]),
    "shipbuilding": (["조선", "LNG선", "선박"], ["HD한국조선해양", "HD현대중공업", "한화오션", "삼성중공업", "HJ중공업"]),
    "defense": (["방산", "K-방산", "방위산업", "무기 수출"], ["한화에어로스페이스", "한화에어로", "LIG넥스원", "현대로템", "한국항공우주", "KAI", "풍산"]),
    "nuclear": (["원전", "원자력", "SMR"], ["두산에너빌리티", "한전기술", "한전KPS", "한수원", "비에이치아이"]),
    "power": (["전력기기", "변압기", "전선", "전력망", "송전", "전력 인프라"], ["LS ELECTRIC", "LS일렉트릭", "HD현대일렉트릭", "효성중공업", "대한전선", "LS전선", "제룡전기"]),
    "bio": (["바이오", "신약", "CDMO", "임상"], ["삼성바이오로직스", "삼성바이오", "셀트리온", "알테오젠", "유한양행", "HLB", "리가켐", "SK바이오팜"]),
    "obesity": (["비만", "GLP-1", "위고비", "마운자로"], ["한미약품", "펩트론", "디앤디파마텍", "인벤티지랩"]),
    "robot": (["로봇", "휴머노이드"], ["레인보우로보틱스", "두산로보틱스", "로보티즈", "유진로봇", "에스피지"]),
    "space": (["우주", "위성", "발사체", "항공우주"], ["한국항공우주", "쎄트렉아이", "인텔리안테크", "AP위성", "한화에어로스페이스"]),
    "platform": (["플랫폼", "포털", "핀테크"], ["네이버", "NAVER", "카카오", "카카오뱅크", "카카오페이"]),
    "game": (["게임", "신작"], ["크래프톤", "엔씨소프트", "넷마블", "펄어비스", "시프트업", "카카오게임즈"]),
    "entertainment": (["엔터", "K팝", "K-팝", "아이돌", "케이팝"], ["하이브", "JYP", "에스엠", "SM엔터", "YG엔터"]),
    "auto": (["자동차", "완성차", "전기차"], ["현대차", "기아", "현대모비스", "HL만도", "현대위아"]),
    "finance": (["밸류업", "은행주", "금융주", "금융지주", "주주환원"], ["KB금융", "신한지주", "하나금융", "우리금융", "메리츠금융", "삼성생명"]),
    "cosmetics": (["화장품", "K뷰티", "K-뷰티"], ["아모레퍼시픽", "LG생활건강", "코스맥스", "한국콜마", "실리콘투", "에이피알"]),
    "hydrogen": (["수소", "연료전지"], ["두산퓨얼셀", "효성첨단소재", "일진하이솔루스", "범한퓨얼셀"]),
    "steel": (["철강", "제철", "H형강"], ["POSCO홀딩스", "포스코홀딩스", "현대제철", "동국제강", "세아베스틸"]),
    "construction": (["건설", "주택", "분양", "플랜트"], ["현대건설", "삼성물산", "GS건설", "DL이앤씨", "대우건설"]),
    "telecom": (["통신", "5G", "6G"], ["SK텔레콤", "SKT", "KT", "LG유플러스"]),
}


def _recent(it: dict, hours: int = 24) -> bool:
    try:
        return datetime.now(KST) - datetime.fromisoformat(it["time"]) < timedelta(hours=hours)
    except Exception:
        return False


def _score(title: str, words: list[str], names: list[str]) -> int:
    """테마 관련도 점수. 검색어가 없으면 0. 2점 이상만 채택"""
    kw = [w for w in words if w in title]
    nm = [n for n in names if n in title]
    if not kw and not nm:
        return 0
    score = 1
    if nm:
        score += 2                                                       # 대표 종목이 제목에 있음
    if kw and any(re.search(re.escape(w) + r"(주|株|관련주|업종|섹터)", title) for w in kw):
        score += 2                                                       # "방산주", "조선株" 같은 투자 관점 표현
    if kw and any(title.find(w) <= 12 for w in kw):
        score += 1                                                       # 제목 앞부분에 검색어
    if "특징주" in title:
        score += 1
    if kw and nm:
        score += 1
    return score


# 연합뉴스 자동 시세표 등 기사로 보기 어려운 제목
_NOISE_RE = re.compile(r"^\[표\]|시세표|상위종목\(|\[게시판\]|\[인사\]|\[부고\]")


def _pick(items: list[dict], words: list[str], names: list[str]) -> dict | None:
    best = None
    for it in items:
        if not _recent(it) or _NOISE_RE.search(it["title"]):
            continue
        sc = _score(it["title"], words, names) - (1 if FOREIGN_RE.search(it["title"]) else 0)
        if sc < 2:
            continue
        key = (sc, it["time"])
        if best is None or key > best[0]:
            best = (key, it)
    return best[1] if best else None


# 시장종합 화면용: 지수·수급 (id "mkt:...")
MARKET_KEYWORDS = {
    "mkt:kospi": (["코스피", "유가증권시장"], []),
    "mkt:kosdaq": (["코스닥"], []),
    "mkt:us": (["뉴욕증시", "뉴욕 증시", "나스닥", "다우", "S&P", "美증시", "미국 증시"], []),
    "mkt:flow": (["외국인", "기관", "개인"], ["순매수", "순매도", "매물", "수급"]),
}
# 업종명에서 검색어를 만들 때 보충할 단어 (KRX 업종명 그대로는 기사에 잘 안 나오는 것)
SECTOR_EXTRA = {
    "전기·전자": ["반도체", "전자", "디스플레이"], "증권": ["증권주", "증권사"], "금융": ["금융주", "은행주", "금융지주"],
    "보험": ["보험주", "보험사"], "운송장비·부품": ["자동차", "조선", "자동차부품"], "운송·창고": ["해운", "항공", "물류"],
    "기계·장비": ["기계", "로봇", "장비"], "화학": ["화학", "정유", "석유화학"], "제약": ["제약", "바이오", "신약"],
    "의료·정밀기기": ["의료기기", "정밀기기"], "전기·가스": ["한국전력", "한전", "가스공사", "전기요금"],
    "IT 서비스": ["IT서비스", "소프트웨어", "AI"], "오락·문화": ["엔터", "게임", "카지노", "여행"],
    "일반서비스": ["서비스업"], "통신": ["통신사", "이동통신"], "건설": ["건설", "건설사"], "금속": ["철강", "비철금속"],
    "출판·매체복제": ["출판", "미디어"], "기타제조": ["제조"],
}


_AMBIGUOUS_SECTORS = {"증권", "금융", "보험", "통신", "일반서비스", "기타제조", "유통"}


def _keywords(tid: str):
    if tid in THEME_KEYWORDS:
        return THEME_KEYWORDS[tid]
    if tid in MARKET_KEYWORDS:
        return MARKET_KEYWORDS[tid]
    if tid.startswith("sector:"):
        name = tid[7:][:20]
        # 흔히 다른 뜻으로 쓰이는 업종명은 "증권주"처럼 보충 단어로만 찾는다
        base = [] if name in _AMBIGUOUS_SECTORS else [w for w in re.split(r"[·\s]", name) if len(w) >= 2]
        words = base + SECTOR_EXTRA.get(name, [])
        return (list(dict.fromkeys(words)), []) if words else None
    return None


async def theme_news(ids: list[str]) -> dict:
    """{id: 기사 1건 또는 None}. id = 테마 id / "mkt:kospi" 등 / "sector:업종명".
    언론사 피드에서 먼저 찾고, 없으면 구글 뉴스로 보충 (id별 10분 저장)"""
    ids = [i for i in dict.fromkeys(ids) if _keywords(i)][:60]
    pools = await asyncio.gather(_feeds("market"), _feeds("biz"), _feeds("economy"))
    pool = _dedupe([it for lst in pools for it in lst])
    result, missing = {}, []
    for tid in ids:
        hit = _cache.get(f"theme:{tid}")
        if hit and time.monotonic() - hit[0] < 600:
            result[tid] = hit[1][0] if hit[1] else None
            continue
        words, names = _keywords(tid)
        it = _pick(pool, words, names)
        if it:
            result[tid] = it
            _cache[f"theme:{tid}"] = (time.monotonic(), [it])
        else:
            missing.append(tid)

    async def fill(tid: str):
        words, names = _keywords(tid)
        q = f"{words[0]}주 OR {words[0]} 관련주" + (f" OR {names[0]}" if names and not tid.startswith("mkt:") else "")
        if tid.startswith("mkt:"):
            q = " OR ".join(words[:3])
        items = await _google_rss(q, "1d")
        it = _pick(items, words, names)
        result[tid] = it
        _cache[f"theme:{tid}"] = (time.monotonic(), [it] if it else [])

    await asyncio.gather(*[fill(t) for t in missing[:20]])
    return result
