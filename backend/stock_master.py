"""
검색·순위용 주식 목록 (한국투자증권 종목 마스터, 코스피·코스닥 주권만 — ETF·ETN 등 제외)

신규 상장·상장폐지·사명 변경이 바로 반영되도록 서버가 직접 받아 3시간마다 새로 만든다.
결과는 공유 저장소(Upstash)에 두어 인스턴스마다 다시 받지 않는다.
형식: [[코드, 종목명, 시장(P=코스피, Q=코스닥)], ...]  (web/scripts/build_stocks.py 와 같음)
"""

import asyncio
import io
import json
import logging
import time
import zipfile

import httpx

import kis_client as kis

logger = logging.getLogger(__name__)
URL = "https://new.real.download.dws.co.kr/common/master/{}_code.mst.zip"
SOURCES = [("kospi", 228, "P"), ("kosdaq", 222, "Q")]   # 줄 끝 고정 길이 영역(바이트)
RKEY = "drmarket:stocks:v1"
TTL = 3 * 3600

_mem: dict = {"at": 0.0, "list": []}
_lock = asyncio.Lock()


def _parse(raw: bytes, tail: int, market: str):
    for line in raw.split(b"\n"):
        line = line.rstrip(b"\r")
        if not line.strip():
            continue
        head, rest = line[:-tail], line[-tail:]
        code = head[0:9].decode("cp949", "ignore").strip()
        name = head[21:].decode("cp949", "ignore").strip()
        group = rest[1:3].decode("cp949", "ignore")   # ST=주권, EF=ETF, EN=ETN ...
        if group == "ST" and len(code) == 6 and code.isdigit():
            yield [code, name, market]


async def _download() -> list[list]:
    out: list[list] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for name, tail, market in SOURCES:
            r = await client.get(URL.format(name))
            r.raise_for_status()
            z = zipfile.ZipFile(io.BytesIO(r.content))
            out += list(_parse(z.read(f"{name}_code.mst"), tail, market))
    out.sort(key=lambda s: s[0])
    return out


async def get_stocks() -> list[list]:
    if _mem["list"] and time.time() - _mem["at"] < TTL:
        return _mem["list"]
    async with _lock:
        if _mem["list"] and time.time() - _mem["at"] < TTL:
            return _mem["list"]
        raw = await kis._redis("GET", RKEY)
        if raw:
            try:
                d = json.loads(raw)
                if time.time() - d["at"] < TTL:
                    _mem.update(at=d["at"], list=d["list"])
                    return _mem["list"]
            except Exception:
                pass
        try:
            fresh = await _download()
        except Exception as e:
            logger.warning("[STOCKS] 종목 마스터 실패: %s", e)
            fresh = []
        if len(fresh) > 1000:
            now = time.time()
            _mem.update(at=now, list=fresh)
            await kis._redis("SET", RKEY, json.dumps({"at": now, "list": fresh}, ensure_ascii=False, separators=(",", ":")), "EX", str(7 * 86400))
        elif raw and not _mem["list"]:
            # 내려받기 실패 시 오래된 목록이라도 사용
            try:
                d = json.loads(raw)
                _mem.update(at=time.time() - TTL + 600, list=d["list"])   # 10분 뒤 다시 시도
            except Exception:
                pass
    return _mem["list"]
