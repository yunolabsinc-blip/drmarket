import { useEffect, useState } from 'react'
import { useMarket } from '../lib/store'
import { getRanking } from '../lib/api'
import { fmtVolume, fmtWon, marketPhase } from '../lib/format'
import { Disclaimer, Rate, Skeleton, StatusLine, StockRow } from '../components/ui'

const TYPES = [
  { id: 'amount', label: '거래대금' },
  { id: 'volume', label: '거래량' },
  { id: 'up', label: '상승률' },
  { id: 'down', label: '하락률' },
]

export function useRanking(type) {
  const { stockMap, stockList, prices, watch } = useMarket()
  const [raw, setRaw] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let stopped = false
    let timer
    const load = async () => {
      let ok = false
      try {
        const d = await getRanking(type)
        const rows = (d.ranking || []).filter((r) => r.source === 'live')
        ok = rows.length > 0
        if (!stopped && ok) setRaw(rows)
      } catch {}
      if (!stopped) {
        setLoading(false)
        timer = setTimeout(load, !ok ? 6000 : marketPhase().key === 'open' ? 10000 : 120000)
      }
    }
    setRaw([])
    setLoading(true)
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
  // 순위 종목을 5초 시세 조회에 포함시켜, 순서는 KRX 순위대로 두고 가격·등락률·거래대금은 통합 실시간으로
  useEffect(() => { filtered.forEach((r) => watch(r.code)) }, [filtered.map((r) => r.code).join(','), watch])
  const merged = filtered.map((r) => {
    const p = prices[r.code]
    return p ? { ...r, price: p.price, change_rate: p.change_rate, change: p.change, volume: p.volume || r.volume, trading_value: p.trading_value || r.trading_value } : r
  })
  // 실시간 값을 덧입힌 뒤 화면에 보이는 숫자 기준으로 다시 정렬 (순서와 숫자가 어긋나지 않게)
  const metric = { amount: (r) => r.trading_value || 0, volume: (r) => r.volume || 0, up: (r) => r.change_rate ?? -999, down: (r) => -(r.change_rate ?? 999) }[type]
  const rows = metric ? [...merged].sort((a, b) => metric(b) - metric(a)) : merged
  return { rows, loading }
}

export default function Rank() {
  const [type, setType] = useState(() => sessionStorage.getItem('drm.rank') || 'amount')
  const { rows, loading } = useRanking(type)
  const select = (id) => {
    setType(id)
    try { sessionStorage.setItem('drm.rank', id) } catch {}
  }
  return (
    <main className="page">
      <h1 className="page-title">순위</h1>
      <p className="page-desc">KRX 정규장 체결 기준입니다. 넥스트레이드 거래는 포함되지 않습니다.</p>
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
          {rows.map((s, i) => (
            <StockRow key={s.code} stock={s} rank={i + 1}
              right={
                <span className="rank-right">
                  <Rate value={s.change_rate} />
                  <small>{type === 'volume' ? fmtVolume(s.volume) : type === 'amount' ? fmtWon(s.trading_value) : ''}</small>
                </span>
              } />
          ))}
        </div>
      )}
      <Disclaimer />
    </main>
  )
}
