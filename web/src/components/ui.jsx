import { useEffect } from 'react'
import { useMarket } from '../lib/store'
import { fmtPrice, fmtRate, fmtTime, marketPhase, tone } from '../lib/format'
import { back, go } from '../lib/router'
import Logo from './Logo'

export function TopBar({ onSearch }) {
  return (
    <header className="topbar">
      <a href="#/" className="topbar-logo" aria-label="닥터마켓 홈"><Logo size={26} /></a>
      <button className="icon-btn" onClick={onSearch} aria-label="종목 검색">
        <SearchIcon />
      </button>
    </header>
  )
}

export function SubBar({ title, right }) {
  // ESC로 상세 화면 닫기 (입력 중일 때는 제외)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        document.activeElement.blur()
        return
      }
      back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <header className="topbar sub">
      <button className="icon-btn" onClick={back} aria-label="뒤로"><BackIcon /></button>
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  )
}

export function StatusLine() {
  const { status, updatedAt, refresh } = useMarket()
  const phase = marketPhase()
  const label = {
    live: updatedAt ? `${fmtTime(updatedAt)} 기준` : '불러오는 중',
    connecting: '연결 중',
    error: '시세 서버 연결이 원활하지 않습니다',
    demo: '시세 서버 점검 중',
  }[status]
  return (
    <div className="status-line">
      <span className={`phase phase-${phase.key}`}>{phase.label}</span>
      <span className={`status status-${status}`}>{label}</span>
      <button className="text-btn" onClick={refresh}>새로고침</button>
    </div>
  )
}

const TABS = [
  { id: 'home', path: '/', label: '홈', icon: HomeIcon },
  { id: 'themes', path: '/themes', label: '테마', icon: GridIcon },
  { id: 'rank', path: '/rank', label: '순위', icon: ChartIcon },
  { id: 'watch', path: '/watch', label: '관심', icon: StarIcon },
]

export function TabBar({ page }) {
  const active = page === 'theme' ? 'themes' : page
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      {TABS.map((t) => (
        <a key={t.id} href={`#${t.path}`} className={`tab ${active === t.id ? 'active' : ''}`}>
          <t.icon />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  )
}

export function Rate({ value, className = '' }) {
  return <span className={`rate ${tone(value)} ${className}`}>{fmtRate(value)}</span>
}

export function RatePill({ value }) {
  return <span className={`rate-pill ${tone(value)}`}>{fmtRate(value)}</span>
}

export function StockRow({ stock, rank, right, onClick }) {
  const { flash, favorites } = useMarket()
  const f = flash[stock.code]
  return (
    <button className="stock-row" onClick={onClick || (() => go(`/stock/${stock.code}`))}>
      {rank !== undefined && <span className="rank-no">{rank}</span>}
      <span className="stock-name">
        <b>{stock.name || stock.code}</b>
        {favorites.includes(stock.code) && <span className="fav-dot" aria-label="관심종목">★</span>}
      </span>
      <span className="stock-nums">
        <b className={`price ${f ? `flash-${f}` : ''}`}>{stock.price ? fmtPrice(stock.price) : '—'}</b>
        {right ?? <Rate value={stock.change_rate} />}
      </span>
    </button>
  )
}

export function Section({ title, more, children }) {
  return (
    <section className="section">
      {(title || more) && (
        <div className="section-head">
          <h2>{title}</h2>
          {more && <a href={more.href} className="more">{more.label} <ChevronIcon /></a>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" />)}
    </div>
  )
}

export function Empty({ title, desc, action }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {desc && <p>{desc}</p>}
      {action}
    </div>
  )
}

export function Disclaimer() {
  return (
    <footer className="disclaimer">
      <p>
        닥터마켓의 시세·테마 정보는 투자 판단을 돕기 위한 참고 자료이며 특정 종목의 매수·매도를 권유하지 않습니다.
        시세는 지연되거나 오류가 있을 수 있고, 투자에 대한 판단과 결과의 책임은 이용자 본인에게 있습니다.
      </p>
      <p>시세 출처: 한국투자증권 Open API · 테마 분류: 닥터마켓 자체 분류</p>
      <p className="copyright">© {new Date().getFullYear()} 유노랩스</p>
    </footer>
  )
}

// ── 아이콘 (stroke 기반, currentColor) ──
const I = ({ children, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
export function SearchIcon() { return <I><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I> }
export function BackIcon() { return <I><path d="m15 18-6-6 6-6" /></I> }
export function ChevronIcon() { return <I size={16}><path d="m9 18 6-6-6-6" /></I> }
export function CloseIcon() { return <I><path d="M18 6 6 18M6 6l12 12" /></I> }
export function HomeIcon() { return <I><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></I> }
export function GridIcon() { return <I><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></I> }
export function ChartIcon() { return <I><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I> }
export function StarIcon({ filled }) {
  return <I><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={filled ? 'currentColor' : 'none'} /></I>
}
