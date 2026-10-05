import { useEffect, useMemo, useRef, useState } from 'react'
import { useMarket } from '../lib/store'
import { go } from '../lib/router'
import { CloseIcon, Rate, SearchIcon } from './ui'

const norm = (s) => s.toLowerCase().replace(/\s/g, '')

export default function Search({ onClose }) {
  const { stockList, themes, prices } = useMarket()
  const [q, setQ] = useState('')
  const input = useRef(null)
  useEffect(() => {
    input.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const results = useMemo(() => {
    const k = norm(q)
    if (!k) return { stocks: [], themes: [] }
    const starts = []
    const contains = []
    for (const [code, name, market] of stockList) {
      const n = norm(name)
      if (code.startsWith(k) || n.startsWith(k)) starts.push({ code, name, market })
      else if (n.includes(k)) contains.push({ code, name, market })
      if (starts.length >= 30) break
    }
    return {
      stocks: [...starts, ...contains].slice(0, 30),
      themes: themes.filter((t) => norm(t.name).includes(k) || norm(t.desc).includes(k)).slice(0, 5),
    }
  }, [q, stockList, themes])

  const open = (path) => {
    onClose()
    go(path)
  }

  return (
    <div className="search-layer" role="dialog" aria-modal="true" aria-label="검색">
      <div className="search-bar">
        <SearchIcon />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="종목명, 종목코드, 테마"
          inputMode="search" autoComplete="off" />
        <button className="icon-btn" onClick={onClose} aria-label="닫기"><CloseIcon /></button>
      </div>
      <div className="search-body">
        {!q && <p className="search-hint">예) 삼성전자, 005930, 반도체</p>}
        {q && !results.stocks.length && !results.themes.length && <p className="search-hint">검색 결과가 없습니다</p>}
        {results.themes.length > 0 && (
          <>
            <h3 className="search-group">테마</h3>
            {results.themes.map((t) => (
              <button key={t.id} className="search-item" onClick={() => open(`/theme/${t.id}`)}>
                <b>{t.name}</b><span className="muted">{t.desc}</span><Rate value={t.avg} />
              </button>
            ))}
          </>
        )}
        {results.stocks.length > 0 && (
          <>
            <h3 className="search-group">종목</h3>
            {results.stocks.map((s) => (
              <button key={s.code} className="search-item" onClick={() => open(`/stock/${s.code}`)}>
                <b>{s.name}</b>
                <span className="muted">{s.market === 'P' ? '코스피' : '코스닥'} {s.code}</span>
                {prices[s.code] && <Rate value={prices[s.code].change_rate} />}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
