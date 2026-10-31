import { memo, useEffect, useState } from 'react'
import { useMarket } from '../lib/store'
import { getRanking } from '../lib/api'
import { go } from '../lib/router'
import { fmtPrice, fmtVolume, fmtWon, marketPhase } from '../lib/format'
import { Disclaimer, Rate, Skeleton, StatusLine } from '../components/ui'

const TYPES = [
  { id: 'amount', label: '거래대금' },
  { id: 'volume', label: '거래량' },
  { id: 'up', label: '상승률' },
  { id: 'down', label: '하락률' },
]

export function useRanking(type) {
  const { stockMap, stockList, prices, watch } = useMarket()
  const saved = () => (getRanking.peek(type)?.ranking || []).filter((r) => r.source === 'live')
  const [raw, setRaw] = useState(saved)
  const [count, setCount] = useState(() => getRanking.peek(type)?.count || 0)
  const [loading, setLoading] = useState(() => !saved().length)
  useEffect(() => {
    let stopped = false
    let timer
    const load = async () => {
      let ok = false
      try {
        const d = await getRanking(type)
        const rows = (d.ranking || []).filter((r) => r.source === 'live')
        ok = rows.length > 0
        if (!stopped && ok) { setRaw(rows); setCount(d.count || 0) }
      } catch {}
      if (!stopped) {
        setLoading(false)
        timer = setTimeout(load, !ok ? 6000 : marketPhase().key === 'open' ? 5000 : 120000)
      }
    }
    const last = saved()   // 다른 순위로 바꿀 때도 마지막 결과를 먼저
    setRaw(last)
    setCount(getRanking.peek(type)?.count || 0)
    setLoading(!last.length)
    load()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [type])
  // ETF·ETN 등은 제외하고 주식만 (종목 목록이 로드된 뒤 적용)
  const filtered = stockList.length
    ? raw.filter((r) => stockMap[r.code]).map((r) => ({ ...r, name: stockMap[r.code].name }))
    : raw
  // 위쪽 30종목은 5초 시세 조회에 포함시켜 더 자주 갱신 (전체 순위는 서버가 15초마다 다시 매김)
  const top = filtered.slice(0, 30).map((r) => r.code).join(',')
  useEffect(() => {
    const offs = top.split(',').filter(Boolean).map((c) => watch(c))
    return () => offs.forEach((off) => off())
  }, [top, watch])
  const merged = filtered.map((r) => {
    const p = prices[r.code]
    return p ? { ...r, price: p.price, change_rate: p.change_rate, change: p.change, volume: p.volume || r.volume, trading_value: p.trading_value || r.trading_value } : r
  })
  // 실시간 값을 덧입힌 뒤 화면에 보이는 숫자 기준으로 다시 정렬 (순서와 숫자가 어긋나지 않게)
  const metric = { amount: (r) => r.trading_value || 0, volume: (r) => r.volume || 0, up: (r) => r.change_rate ?? -999, down: (r) => -(r.change_rate ?? 999) }[type]
  const rows = metric ? [...merged].sort((a, b) => metric(b) - metric(a)) : merged
  return { rows, loading, count }
}

// 순위 한 줄: 값이 그대로인 줄은 시세가 갱신돼도 다시 그리지 않음 (100줄 전체를 매번 그리던 것)
const RankRow = memo(function RankRow({ code, name, price, rate, sub, rank, flash, fav }) {
  return (
    <button className="stock-row" data-stock={code} onClick={() => go(`/stock/${code}`)}>
      <span className="rank-no">{rank}</span>
      <span className="stock-name">
        <b>{name || code}</b>
        {fav && <span className="fav-dot" aria-label="관심종목">★</span>}
      </span>
      <span className="stock-nums">
        <b className={`price ${flash ? `flash-${flash}` : ''}`}>{price ? fmtPrice(price) : '—'}</b>
        <span className="rank-right">
          <Rate value={rate} />
          <small>{sub}</small>
        </span>
      </span>
    </button>
  )
})

export default function Rank() {
  const [type, setType] = useState(() => sessionStorage.getItem('drm.rank') || 'amount')
  const { rows, loading, count } = useRanking(type)
  const { flash, favorites } = useMarket()
  // 첫 화면은 위 30줄만 바로 그리고 나머지는 다음 프레임에 (탭을 누르자마자 반응하게)
  const [limit, setLimit] = useState(30)
  useEffect(() => {
    setLimit(30)
    const id = setTimeout(() => setLimit(100), 30)
    return () => clearTimeout(id)
  }, [type])
  // 다른 순위 탭도 누르자마자 보이게 미리 받아 둠
  useEffect(() => {
    const t = setTimeout(() => TYPES.forEach((x) => x.id !== type && getRanking(x.id).catch(() => {})), 600)
    return () => clearTimeout(t)
  }, [])
  const select = (id) => {
    setType(id)
    try { sessionStorage.setItem('drm.rank', id) } catch {}
  }
  return (
    <main className="page">
      <h1 className="page-title">순위</h1>
      <p className="page-desc">
        한국거래소·넥스트레이드 통합 시세로 {count ? `주식 ${count.toLocaleString()}종목` : '주식 전 종목'}(ETF·ETN 제외)을 모두 비교한 상위 100위입니다.
      </p>
      <StatusLine />
      <div className="segmented" role="tablist">
        {TYPES.map((t) => (
          <button key={t.id} role="tab" aria-selected={type === t.id} className={type === t.id ? 'on' : ''}
            onClick={() => select(t.id)}>{t.label}</button>
        ))}
      </div>
      {loading && !rows.length ? <Skeleton rows={10} /> : !rows.length ? (
        <div className="card muted-box">순위 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
      ) : (
        <div className="card list">
          {rows.slice(0, limit).map((s, i) => (
            <RankRow key={s.code} code={s.code} name={s.name} price={s.price} rate={s.change_rate} rank={i + 1}
              sub={type === 'volume' ? fmtVolume(s.volume) : type === 'amount' ? fmtWon(s.trading_value) : ''}
              flash={flash[s.code]} fav={favorites.includes(s.code)} />
          ))}
        </div>
      )}
      <Disclaimer />
    </main>
  )
}
