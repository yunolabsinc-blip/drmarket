import { useState } from 'react'
import { useMarket } from '../lib/store'
import ThemeGrid, { SortToggle } from '../components/ThemeGrid'
import { fmtWonShort } from '../lib/format'
import { Disclaimer, Empty, RatePill, StatusLine, StockRow, SubBar } from '../components/ui'

export default function Themes() {
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('drm.themeSort') || 'value' } catch { return 'value' } })
  const changeSort = (v) => { setSort(v); try { localStorage.setItem('drm.themeSort', v) } catch {} }
  return (
    <main className="page">
      <h1 className="page-title">실시간 테마</h1>
      <p className="page-desc">{sort === 'value'
        ? '테마 소속 종목의 당일 거래대금 합계 순입니다. 돈이 몰리는 테마가 위에 옵니다.'
        : '테마 소속 종목의 평균 등락률 순입니다.'}</p>
      <StatusLine />
      <SortToggle value={sort} onChange={changeSort} />
      <ThemeGrid sort={sort} />
      <Disclaimer />
    </main>
  )
}

export function ThemeDetail({ id }) {
  const { themes } = useMarket()
  const theme = themes.find((t) => t.id === id)
  if (!theme) {
    return (
      <>
        <SubBar title="테마" />
        <main className="page"><Empty title="테마를 찾을 수 없습니다" action={<a className="btn" href="#/themes">테마 목록으로</a>} /></main>
      </>
    )
  }
  return (
    <>
      <SubBar title={theme.name} />
      <main className="page">
        <div className="hero">
          <span className="hero-label">{theme.desc}</span>
          <div className="hero-row">
            <RatePill value={theme.avg} />
            <span className="hero-meta">거래대금 {fmtWonShort(theme.value)} · 상승 {theme.up} · 하락 {theme.down}</span>
          </div>
        </div>
        <div className="card list">
          {theme.stocks.map((s, i) => <StockRow key={s.code} stock={s} rank={i + 1} />)}
        </div>
        <Disclaimer />
      </main>
    </>
  )
}
