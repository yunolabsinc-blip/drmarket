"""
한국투자증권 종목 마스터 파일로 검색용 종목 목록(public/stocks.json)을 만든다.
상장·폐지·사명 변경을 반영하려면 주기적으로 다시 실행:  python scripts/build_stocks.py
출력 형식: [[코드, 종목명, 시장(P=코스피, Q=코스닥)], ...]
"""
import io
import json
import os
import urllib.request
import zipfile

SOURCES = [
    ("kospi", 228, "P"),   # 파일 끝 고정 길이 영역(바이트)
    ("kosdaq", 222, "Q"),
]
URL = "https://new.real.download.dws.co.kr/common/master/{}_code.mst.zip"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "stocks.json")


def parse(raw: bytes, tail: int, market: str):
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


def main():
    stocks = []
    for name, tail, market in SOURCES:
        with urllib.request.urlopen(URL.format(name), timeout=60) as resp:
            z = zipfile.ZipFile(io.BytesIO(resp.read()))
        stocks += list(parse(z.read(f"{name}_code.mst"), tail, market))
    stocks.sort(key=lambda s: s[0])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(stocks)} stocks -> {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
