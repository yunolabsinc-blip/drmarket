import { useEffect, useState } from 'react'
import { getHeadlines } from '../lib/api'
import { go } from '../lib/router'
import { timeAgo } from './NewsList'

// 하단 탭 위에 고정되는 주요 뉴스 띠: 5초마다 다음 기사, 3분마다 새로 조회. 누르면 뉴스 화면으로.
export default function NewsTicker({ hidden }) {
  const [items, setItems] = useState([])
  const [idx, setIdx] = useState(0)

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
    if (items.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000)
    return () => clearInterval(t)
  }, [items])

  if (hidden || !items.length) return null
  const n = items[idx % items.length]
  return (
    <button className="ticker" onClick={() => go('/market/news')} aria-label="주요 뉴스, 누르면 뉴스 화면으로 이동">
      <span className="ticker-badge"><i />뉴스</span>
      <span className="ticker-text" key={idx}>
        <b>{n.title}</b>
        <small>{n.source}{n.source && n.time ? ' · ' : ''}{timeAgo(n.time)}</small>
      </span>
      <span className="ticker-count">{(idx % items.length) + 1}/{items.length}</span>
    </button>
  )
}
