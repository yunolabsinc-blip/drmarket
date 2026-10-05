import { useEffect, useState } from 'react'
import { getHeadlines } from '../lib/api'
import { go } from '../lib/router'
import { RelatedStocks, timeAgo } from './NewsList'
import { CloseIcon } from './ui'

// 하단 탭 위에 고정되는 주요 뉴스 띠: 5초마다 다음 기사, 3분마다 새로 조회.
// 누르면 요약 창이 열리고, 거기서 기사 원문 또는 뉴스 화면으로 이동.
export default function NewsTicker({ hidden }) {
  const [items, setItems] = useState([])
  const [idx, setIdx] = useState(0)
  const [sheet, setSheet] = useState(null)   // 열린 기사

  useEffect(() => {
    let alive = true
    let timer
    const load = () =>
      getHeadlines(10)
        .then((d) => { if (alive && d.news?.length) setItems(d.news) })
        .catch(() => {})
        .finally(() => { if (alive) timer = setTimeout(load, 180000) })
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (items.length < 2 || sheet) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000)
    return () => clearInterval(t)
  }, [items, sheet])

  useEffect(() => {
    if (!sheet) return
    const onKey = (e) => e.key === 'Escape' && setSheet(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  if (hidden || !items.length) return null
  const n = items[idx % items.length]
  return (
    <>
      <button className="ticker" onClick={() => setSheet(n)} aria-label="주요 뉴스, 누르면 요약 보기">
        <span className={`ticker-badge ${n.kind === 'feature' ? 'feature' : ''}`}><i />{n.kind === 'feature' ? '특징주' : '뉴스'}</span>
        <span className="ticker-text" key={idx}>
          <b>{n.title}</b>
          <small>{n.source}{n.source && n.time ? ' · ' : ''}{timeAgo(n.time)}</small>
        </span>
        <span className="ticker-count">{(idx % items.length) + 1}/{items.length}</span>
      </button>
      {sheet && (
        <div className="sheet-layer" onClick={() => setSheet(null)} role="dialog" aria-modal="true" aria-label="뉴스 요약">
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className={`ticker-badge ${sheet.kind === 'feature' ? 'feature' : ''}`}><i />{sheet.kind === 'feature' ? '특징주' : '주요 뉴스'}</span>
              <button className="icon-btn" onClick={() => setSheet(null)} aria-label="닫기"><CloseIcon /></button>
            </div>
            <h3>{sheet.title}</h3>
            <p className="sheet-meta">{sheet.source}{sheet.source && sheet.time ? ' · ' : ''}{timeAgo(sheet.time)}</p>
            <p className="sheet-desc">{sheet.desc || '이 기사는 요약이 제공되지 않습니다. 원문에서 확인해 주세요.'}</p>
            <RelatedStocks text={`${sheet.title} ${sheet.desc || ''}`} onNavigate={() => setSheet(null)} />
            <div className="sheet-actions">
              <a className="btn" href={sheet.link} target="_blank" rel="noopener noreferrer">기사 원문 보기 ↗</a>
              <button className="btn ghost" onClick={() => { setSheet(null); go('/market/news') }}>뉴스 바로가기</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
