import { memo, useState } from 'react'
import { useMarket } from '../lib/store'
import { go } from '../lib/router'
import { fmtRate, tone } from '../lib/format'
import { useRanking } from '../pages/Rank'
import { Empty, Skeleton } from './ui'

// 십자차트: 가운데 0% 선을 기준으로 상승은 오른쪽, 하락은 왼쪽으로 뻗는 종목별 등락 막대
const TABS = [
  { id: 'top', label: '거래대금 상위' },
  { id: 'watch', label: '관심종목' },
]

const CrossRow = memo(function CrossRow({ code, name, rate, max }) {
  return (
    <button className="cross-row" data-stock={code} onClick={() => go(`/stock/${code}`)}>
      <span className="cross-name">{name}</span>
      <span className="flow-track">
        <i className={`flow-bar ${tone(rate)}`} style={{ width: `${(Math.abs(rate) / max) * 50}%`, [rate >= 0 ? 'left' : 'right']: '50%' }} />
      </span>
      <b className={`cross-rate ${tone(rate)}`}>{fmtRate(rate)}</b>
    </button>
  )
})

function Bars({ stocks }) {
  const rows = stocks.filter((s) => s.change_rate != null).sort((a, b) => b.change_rate - a.change_rate)
  // 작은 등락이 부풀어 보이지 않게 막대 끝은 최소 ±1%
  const max = Math.max(1, ...rows.map((s) => Math.abs(s.change_rate)))
  const up = rows.filter((s) => s.change_rate > 0).length
  const down = rows.filter((s) => s.change_rate < 0).length
  return (
    <div className="card cross">
      <div className="cross-head">
        <b className="down">하락 {down}</b>
        <span>보합 {rows.length - up - down}</span>
        <b className="up">상승 {up}</b>
      </div>
      {rows.map((s) => <CrossRow key={s.code} code={s.code} name={s.name || s.code} rate={s.change_rate} max={max} />)}
    </div>
  )
}

function TopBars() {
  const { rows, loading } = useRanking('amount')
  if (loading && !rows.length) return <Skeleton rows={10} />
  if (!rows.length) return <div className="card muted-box">순위 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
  return <Bars stocks={rows.slice(0, 30)} />
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
      <p className="page-desc" style={{ marginTop: 8 }}>전일 종가 대비 상승률이 높은 종목부터 보여 줍니다. 종목을 누르면 상세 화면으로 이동합니다.</p>
    </>
  )
}
