import { useState } from 'react'
import { useMarket } from '../lib/store'
import ThemeGrid, { SortToggle, ThemeHeadline, loadThemeView, saveThemeView } from '../components/ThemeGrid'
import ThemeMap from '../components/ThemeMap'
import { useThemeNews } from '../lib/themeNews'
import { fmtWonShort } from '../lib/format'
import { Disclaimer, Empty, RatePill, StatusLine, StockRow, SubBar } from '../components/ui'

export default function Themes() {
  const [sort, setSort] = useState(loadThemeView)
  const changeSort = (v) => { setSort(v); saveThemeView(v) }
  return (
    <main className="page">
      <h1 className="page-title">실시간 테마</h1>
      <p className="page-desc">{sort === 'map'
        ? '원이 클수록 거래대금이 많고, 색이 진할수록 많이 움직인 테마입니다.'
        : sort === 'value'
          ? '테마 소속 종목의 당일 거래대금 합계 순입니다. 돈이 몰리는 테마가 위에 옵니다.'
          : '테마 소속 종목의 평균 등락률 순입니다.'}</p>
      <StatusLine />
      <SortToggle value={sort} onChange={changeSort} />
      {sort === 'map' ? <ThemeMap /> : <ThemeGrid sort={sort} />}
      <Disclaimer />
    </main>
  )
}

export function ThemeDetail({ id }) {
  const { themes } = useMarket()
  const themeNews = useThemeNews()
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
          <h1 className="stock-title">{theme.name}</h1>
          <ThemeHeadline item={themeNews[theme.id]} large />
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
