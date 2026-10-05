import { useMarket } from '../lib/store'
import { fmtPrice, fmtRate, fmtWonShort, tone } from '../lib/format'
import { go } from '../lib/router'
import { track } from '../lib/analytics'

export const SORTS = [
  { id: 'value', label: '거래대금 집중' },
  { id: 'rate', label: '상승률' },
]

// 정렬: 거래대금 집중 = 테마 소속 종목 당일 거래대금 합, 상승률 = 평균 등락률
export function useSortedThemes(sort) {
  const { themes, indices } = useMarket()
  const list = [...themes].sort((a, b) =>
    sort === 'rate' ? (b.avg ?? -999) - (a.avg ?? -999) : (b.value || 0) - (a.value || 0),
  )
  // 비중 = 코스피+코스닥 전체 당일 거래대금 대비 (테마 간 중복 종목이 있어도 왜곡되지 않음)
  const total = indices.reduce((s, i) => s + (i.trading_value || 0), 0)
  return { list, total, ready: themes.some((t) => t.avg !== null) }
}

export function SortToggle({ value, onChange }) {
  return (
    <div className="sort-toggle" role="tablist">
      {SORTS.map((s) => (
        <button key={s.id} role="tab" aria-selected={value === s.id} className={value === s.id ? 'on' : ''}
          onClick={() => onChange(s.id)}>{s.label}</button>
      ))}
    </div>
  )
}

function ThemeTile({ theme, rank, sort, total }) {
  const { flash } = useMarket()
  // 거래대금 모드에서는 돈이 몰린 종목부터, 상승률 모드에서는 많이 오른 종목부터
  const stocks = [...theme.stocks]
    .filter((s) => s.price)
    .sort((a, b) => (sort === 'rate' ? b.change_rate - a.change_rate : (b.trading_value || 0) - (a.trading_value || 0)))
    .slice(0, 4)
  const maxValue = Math.max(1, ...stocks.map((s) => s.trading_value || 0))
  const share = total ? (theme.value / total) * 100 : 0

  return (
    <article className="tile" onClick={() => { track('theme_open'); go(`/theme/${theme.id}`) }}>
      <header className="tile-head">
        <span className="tile-rank">{rank}</span>
        <b className="tile-name">{theme.name}</b>
        <span className={`tile-rate ${tone(theme.avg)}`}>{fmtRate(theme.avg)}</span>
      </header>
      <div className="tile-value">
        <span>거래대금 <b>{fmtWonShort(theme.value)}</b></span>
        {total > 0 && <span className="tile-share" title="코스피·코스닥 전체 거래대금 대비">시장 {share.toFixed(1)}%</span>}
      </div>
      <ul className="tile-stocks">
        {stocks.map((s) => (
          <li key={s.code}>
            <button className="tile-stock" onClick={(e) => { e.stopPropagation(); go(`/stock/${s.code}`) }}>
              <span className="ts-top">
                <span className="ts-name">{s.name}</span>
                <span className={`ts-rate ${tone(s.change_rate)}`}>{fmtRate(s.change_rate)}</span>
              </span>
              <span className="ts-bottom">
                <span className={`ts-price ${tone(s.change_rate)} ${flash[s.code] ? `flash-${flash[s.code]}` : ''}`}>{fmtPrice(s.price)}</span>
                <span className="ts-value">{fmtWonShort(s.trading_value)}</span>
              </span>
              <span className="ts-bar"><i className={tone(s.change_rate)} style={{ width: `${((s.trading_value || 0) / maxValue) * 100}%` }} /></span>
            </button>
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function ThemeGrid({ sort, limit }) {
  const { list, total, ready } = useSortedThemes(sort)
  if (!ready) {
    return <div className="tile-grid">{Array.from({ length: limit || 6 }).map((_, i) => <div key={i} className="tile skeleton tile-skel" />)}</div>
  }
  return (
    <div className="tile-grid">
      {list.slice(0, limit || list.length).map((t, i) => (
        <ThemeTile key={t.id} theme={t} rank={i + 1} sort={sort} total={total} />
      ))}
    </div>
  )
}
