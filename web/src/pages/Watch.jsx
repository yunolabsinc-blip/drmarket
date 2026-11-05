import { useState } from 'react'
import { useMarket } from '../lib/store'
import { Disclaimer, Empty, StatusLine, StockRow } from '../components/ui'

// 정렬 기준 — 같은 칩을 다시 누르면 내림차순 ↔ 오름차순
const SORTS = [
  { id: 'added', label: '추가순' },
  { id: 'rate', label: '등락률' },
  { id: 'price', label: '현재가' },
  { id: 'name', label: '이름' },
]
const loadSort = () => {
  try { const s = JSON.parse(localStorage.getItem('drm.watchSort')); if (SORTS.some((x) => x.id === s?.by)) return s } catch {}
  return { by: 'added', desc: false }
}

export default function Watch({ onSearch }) {
  const { favorites, prices, stockMap, memos } = useMarket()
  const [sort, setSortState] = useState(loadSort)
  const setSort = (by) => {
    // 새 기준은 이름만 가나다(오름차순)부터, 나머지는 큰 값(내림차순)부터
    const next = by === sort.by ? { by, desc: !sort.desc } : { by, desc: by !== 'name' && by !== 'added' }
    setSortState(next)
    try { localStorage.setItem('drm.watchSort', JSON.stringify(next)) } catch {}
  }
  const stocks = favorites.map((code, i) => ({ i, code, name: stockMap[code]?.name || prices[code]?.name || code, ...prices[code] }))
  const key = { added: (s) => s.i, rate: (s) => s.change_rate, price: (s) => s.price, name: (s) => s.name }[sort.by]
  const sorted = [...stocks].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x == null || y == null) return x == null ? (y == null ? a.i - b.i : 1) : -1   // 시세가 아직 없는 종목은 뒤로
    const d = typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y
    return (sort.desc ? -d : d) || a.i - b.i
  })
  return (
    <main className="page">
      <h1 className="page-title">관심종목</h1>
      <p className="page-desc">관심종목과 메모는 이 기기의 브라우저에만 저장됩니다.</p>
      <StatusLine />
      {!favorites.length ? (
        <Empty title="관심종목이 없습니다" desc="종목 화면에서 ☆를 누르면 여기에 모아 볼 수 있어요."
          action={<button className="btn" onClick={onSearch}>종목 검색</button>} />
      ) : (
        <>
          <div className="chips wrap" style={{ marginBottom: 10 }}>
            {SORTS.map((s) => (
              <button key={s.id} className={`chip ${sort.by === s.id ? 'chip-on' : ''}`} onClick={() => setSort(s.id)}
                aria-label={`${s.label} ${sort.by === s.id ? (sort.desc ? '내림차순' : '오름차순') : '정렬'}`}>
                {s.label}{sort.by === s.id && (sort.desc ? ' ↓' : ' ↑')}
              </button>
            ))}
          </div>
          <div className="card list">
            {sorted.map((s) => (
              <div key={s.code} className="watch-item">
                <StockRow stock={s} />
                {memos[s.code] && <p className="watch-memo">{memos[s.code]}</p>}
              </div>
            ))}
          </div>
        </>
      )}
      <Disclaimer />
    </main>
  )
}
