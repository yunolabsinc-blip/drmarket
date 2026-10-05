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
  const { stockMap, stockList } = useMarket()
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
        timer = setTimeout(load, !ok ? 6000 : marketPhase().key === 'open' ? 20000 : 120000)
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
  const rows = stockList.length
    ? raw.filter((r) => stockMap[r.code]).map((r) => ({ ...r, name: stockMap[r.code].name }))
    : raw
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
