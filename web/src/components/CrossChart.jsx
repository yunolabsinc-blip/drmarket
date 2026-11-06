import { memo, useState } from 'react'
import { useMarket } from '../lib/store'
import { go } from '../lib/router'
import { fmtRate, tone } from '../lib/format'
import { useRanking } from '../pages/Rank'
import { Empty, Skeleton } from './ui'

// 십자차트: 종목마다 세로선(고가~저가)과 굵은 가로 몸통(시가~현재가)을 전일 종가 0% 기준의 같은 눈금에 나란히 그린다
const TABS = [
  { id: 'top', label: '거래대금 상위' },
  { id: 'watch', label: '관심종목' },
]

const STEPS = [0.5, 1, 2, 5, 10, 15, 20, 30]

// 전일 종가 대비 %로 바꾼 오늘의 시가·고가·저가·현재가 (장 시작 전처럼 값이 없으면 현재가로 대신)
function toCross(s) {
  const base = s.prev_close || s.price / (1 + s.change_rate / 100)
  const pct = (v) => ((v - base) / base) * 100
  const open = s.open > 0 ? s.open : s.price
  return {
    code: s.code, name: s.name || s.code, rate: s.change_rate,
    open: pct(open), now: pct(s.price),
    high: pct(Math.max(s.high || 0, open, s.price)),
    low: pct(Math.min(s.low > 0 ? s.low : s.price, open, s.price)),
  }
}

const CrossCol = memo(function CrossCol({ code, name, rate, open, now, high, low, top, bottom, ticks }) {
  const y = (p) => ((top - p) / (top - bottom)) * 100
  return (
    <button className={`cross-col ${tone(rate)}`} data-stock={code} onClick={() => go(`/stock/${code}`)}
      aria-label={`${name} ${fmtRate(rate)}`}>
      <span className="cross-plot">
        {ticks.map((t) => <i key={t} className={`cross-grid ${t === 0 ? 'zero' : ''}`} style={{ top: `${y(t)}%` }} />)}
        <i className="cross-wick" style={{ top: `${y(high)}%`, bottom: `${100 - y(low)}%` }} />
        <i className="cross-candle" style={{ top: `${y(Math.max(open, now))}%`, bottom: `${100 - y(Math.min(open, now))}%` }} />
      </span>
      <span className="cross-name">{name}</span>
      <span className="cross-rate">{fmtRate(rate)}</span>
    </button>
  )
})

function Bars({ stocks }) {
  const rows = stocks.filter((s) => s.change_rate != null && s.price > 0).sort((a, b) => b.change_rate - a.change_rate).map(toCross)
  // 모든 종목을 같은 눈금으로 비교 (0%는 항상 포함, 눈금은 위아래로 5칸 안쪽)
  const hi = Math.max(0, ...rows.map((r) => r.high))
  const lo = Math.min(0, ...rows.map((r) => r.low))
  const step = STEPS.find((s) => (hi - lo) / s <= 6) || 50
  const top = (Math.floor(hi / step) + 1) * step
  const bottom = (Math.ceil(lo / step) - 1) * step
  const ticks = []
  for (let t = bottom; t <= top + 1e-9; t += step) ticks.push(Math.round(t * 10) / 10)
  const up = rows.filter((r) => r.rate > 0).length
  const down = rows.filter((r) => r.rate < 0).length
  return (
    <div className="card cross">
      <div className="cross-head">
        <b className="down">하락 {down}</b>
        <span>보합 {rows.length - up - down}</span>
        <b className="up">상승 {up}</b>
      </div>
      <div className="cross-body-wrap">
        <div className="cross-axis" aria-hidden="true">
          {ticks.map((t) => <span key={t} style={{ top: `${((top - t) / (top - bottom)) * 100}%` }}>{t > 0 ? '+' : ''}{t}%</span>)}
        </div>
        <div className="cross-scroll" data-noswipe>
          {rows.map((r) => <CrossCol key={r.code} {...r} top={top} bottom={bottom} ticks={ticks} />)}
        </div>
      </div>
    </div>
  )
}

function TopBars() {
  const { rows, loading } = useRanking('amount')
  const { prices } = useMarket()
  if (loading && !rows.length) return <Skeleton rows={10} />
  if (!rows.length) return <div className="card muted-box">순위 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
  return <Bars stocks={rows.slice(0, 30).map((r) => ({ ...r, ...prices[r.code], name: r.name }))} />
}

function WatchBars() {
  const { favorites, prices, stockMap } = useMarket()
  if (!favorites.length) return <Empty title="관심종목이 없습니다" desc="종목 화면에서 ☆를 누르면 여기에서 등락을 비교할 수 있어요." />
  const stocks = favorites.map((code) => ({ ...prices[code], code, name: stockMap[code]?.name || prices[code]?.name }))
  if (!stocks.some((s) => s.change_rate != null)) return <Skeleton rows={Math.min(favorites.length, 10)} />
  return <Bars stocks={stocks} />
}

export default function CrossChart() {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('drm.crossTab') || 'top' } catch { return 'top' } })
  const select = (id) => { setTab(id); try { localStorage.setItem('drm.crossTab', id) } catch {} }
  return (
    <>
      <div className="sort-toggle" role="tablist">
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => select(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'watch' ? <WatchBars /> : <TopBars />}
      <p className="page-desc" style={{ marginTop: 8 }}>세로선은 오늘의 고가~저가, 굵은 가로 몸통은 시가~현재가입니다. 0%는 전일 종가이고 빨강은 전일보다 상승, 파랑은 하락입니다. 상승률이 높은 종목부터 왼쪽에 놓이며, 옆으로 넘겨 볼 수 있습니다.</p>
    </>
  )
}
