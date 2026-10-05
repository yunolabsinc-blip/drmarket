import { useMarket } from '../lib/store'
import { go } from '../lib/router'
import { Disclaimer, Empty, Rate, RatePill, Skeleton, StatusLine, StockRow, SubBar } from '../components/ui'

function Breadth({ up, down, total }) {
  const flat = Math.max(0, total - up - down)
  return (
    <span className="breadth" aria-label={`상승 ${up}, 하락 ${down}`}>
      <i className="b-up" style={{ flex: up }} />
      <i className="b-flat" style={{ flex: flat }} />
      <i className="b-down" style={{ flex: down }} />
    </span>
  )
}

export default function Themes() {
  const { themes } = useMarket()
  const ready = themes.some((t) => t.avg !== null)
  return (
    <main className="page">
      <h1 className="page-title">테마</h1>
      <p className="page-desc">테마 소속 종목의 평균 등락률 순으로 정렬됩니다.</p>
      <StatusLine />
      {!ready ? <Skeleton rows={8} /> : (
        <div className="theme-list">
          {themes.map((t, i) => (
            <button key={t.id} className="card theme-card" onClick={() => go(`/theme/${t.id}`)}>
              <div className="theme-card-head">
                <span className="rank-no">{i + 1}</span>
                <span className="theme-main">
                  <b>{t.name}</b>
                  <span className="theme-sub">{t.desc}</span>
                </span>
                <RatePill value={t.avg} />
              </div>
              <div className="theme-card-foot">
                <span className="chips">
                  {t.stocks.slice(0, 3).map((s) => (
                    <span key={s.code} className="chip">{s.name} <Rate value={s.change_rate} /></span>
                  ))}
                </span>
                <Breadth up={t.up} down={t.down} total={t.stocks.length} />
              </div>
            </button>
          ))}
        </div>
      )}
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
            <span className="hero-meta">상승 {theme.up} · 하락 {theme.down} · 전체 {theme.stocks.length}종목</span>
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
