import { useEffect, useMemo, useRef, useState } from 'react'
import { useMarket } from '../lib/store'
import { go } from '../lib/router'
import { CloseIcon, Rate, SearchIcon } from './ui'

const norm = (s) => s.toLowerCase().replace(/\s/g, '')

// 초성 검색: "ㅅㅅㅈㅈ" → 삼성전자, "삼ㅅ" 처럼 섞어 써도 된다
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const isCho = (ch) => CHO.includes(ch)
const choOf = (ch) => {
  const c = ch.charCodeAt(0) - 0xac00
  return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch
}
const sameChar = (q, ch) => q === ch || (isCho(q) && choOf(ch) === q)
// -1: 없음, 0: 앞에서부터 일치, 1: 중간에 포함
function match(name, k) {
  if (name.startsWith(k)) return 0
  if (name.includes(k)) return 1
  if (![...k].some(isCho)) return -1
  for (let i = 0; i + k.length <= name.length; i++) {
    let ok = true
    for (let j = 0; j < k.length; j++) if (!sameChar(k[j], name[i + j])) { ok = false; break }
    if (ok) return i === 0 ? 0 : 1
  }
  return -1
}

// 최근 검색 (이 기기에만 저장)
const HISTORY_KEY = 'drm.searchHistory'
const HISTORY_MAX = 15
const loadHistory = () => {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
const saveHistory = (list) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch {} }

export default function Search({ onClose }) {
  const { stockList, themes, prices } = useMarket()
  const [q, setQ] = useState('')
  const [history, setHistory] = useState(loadHistory)
  const updateHistory = (list) => { setHistory(list); saveHistory(list) }
  const remember = (item) => updateHistory([item, ...history.filter((h) => h.path !== item.path)].slice(0, HISTORY_MAX))
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
      const m = code.startsWith(k) ? 0 : match(norm(name), k)
      if (m === 0) starts.push({ code, name, market })
      else if (m === 1) contains.push({ code, name, market })
      if (starts.length >= 30) break
    }
    return {
      stocks: [...starts, ...contains].slice(0, 30),
      themes: themes.filter((t) => match(norm(t.name), k) >= 0 || norm(t.desc).includes(k)).slice(0, 5),
    }
  }, [q, stockList, themes])

  const open = (path, item) => {
    if (item) remember({ ...item, path })
    onClose()
    go(path)
  }

  return (
    <div className="search-layer" role="dialog" aria-modal="true" aria-label="검색">
      <div className="search-bar">
        <SearchIcon />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="종목명, 초성, 종목코드, 테마"
          inputMode="search" autoComplete="off" />
        <button className="icon-btn" onClick={onClose} aria-label="닫기"><CloseIcon /></button>
      </div>
      <div className="search-body">
        {!q && history.length > 0 && (
          <>
            <div className="search-group search-history-head">
              <h3>최근 검색</h3>
              <button onClick={() => updateHistory([])}>전체 삭제</button>
            </div>
            {history.map((h) => (
              <div key={h.path} className="search-item search-history">
                <button className="search-history-open" onClick={() => open(h.path, h)}>
                  <b>{h.name}</b>
                  <span className="muted">{h.sub}</span>
                  {h.code && prices[h.code] && <Rate value={prices[h.code].change_rate} />}
                </button>
                <button className="icon-btn search-history-del" aria-label={`${h.name} 검색 기록 삭제`}
                  onClick={() => updateHistory(history.filter((x) => x.path !== h.path))}><CloseIcon /></button>
              </div>
            ))}
          </>
        )}
        {!q && !history.length && <p className="search-hint">예) 삼성전자, 005930, 반도체, 초성 ㅅㅅㅈㅈ</p>}
        {q && !results.stocks.length && !results.themes.length && <p className="search-hint">검색 결과가 없습니다</p>}
        {results.themes.length > 0 && (
          <>
            <h3 className="search-group">테마</h3>
            {results.themes.map((t) => (
              <button key={t.id} className="search-item" onClick={() => open(`/theme/${t.id}`, { name: t.name, sub: '테마' })}>
                <b>{t.name}</b><span className="muted">{t.desc}</span><Rate value={t.avg} />
              </button>
            ))}
          </>
        )}
        {results.stocks.length > 0 && (
          <>
            <h3 className="search-group">종목</h3>
            {results.stocks.map((s) => (
              <button key={s.code} className="search-item" onClick={() => open(`/stock/${s.code}`, { name: s.name, code: s.code, sub: `${s.market === 'P' ? '코스피' : '코스닥'} ${s.code}` })}>
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
