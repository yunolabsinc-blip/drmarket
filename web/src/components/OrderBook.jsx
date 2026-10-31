import { useEffect, useRef, useState } from 'react'
import { getOrderbook } from '../lib/api'
import { fmtPrice, fmtRate, marketPhase, tone } from '../lib/format'

// 마지막으로 받은 호가를 종목별로 기억 → 호가 탭을 누르면 기다리지 않고 바로 보여 주고 뒤에서 갱신
const books = new Map()
const remember = (code, d) => {
  books.delete(code)
  books.set(code, { at: Date.now(), d })
  if (books.size > 30) books.delete(books.keys().next().value)
}

// 종목 화면을 열 때 미리 받아 둠 (차트를 보는 동안)
export function prefetchOrderbook(code) {
  const hit = books.get(code)
  if (hit && Date.now() - hit.at < 5000) return
  getOrderbook(code).then((d) => remember(code, d)).catch(() => {})
}

// 10단계 호가: 위쪽 매도(파랑), 아래쪽 매수(빨강), 잔량 막대
export default function OrderBook({ code, prevClose }) {
  const [book, setBook] = useState(() => books.get(code)?.d || null)
  const [failed, setFailed] = useState(false)
  const bookRef = useRef(book)

  useEffect(() => {
    let alive = true
    let timer
    const load = () =>
      getOrderbook(code)
        .then((d) => { remember(code, d); if (alive) { bookRef.current = d; setBook(d); setFailed(false) } })
        .catch(() => alive && setFailed(true))
        .finally(() => {
          // 서버가 부하에 맞춰 알려주는 간격(1~8초)을 따른다. 화면이 안 보이면 30초
          if (!alive) return
          const next = document.visibilityState !== 'visible' ? 30000 : marketPhase().key === 'open' ? (bookRef.current?.next_ms || 1500) : 30000
          timer = setTimeout(load, next)
        })
    load()
    // 다른 앱에 갔다 돌아오면 30초를 기다리지 않고 바로 갱신
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !alive) return
      clearTimeout(timer)
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [code])

  if (!book) {
    return failed
      ? <div className="chart-empty" style={{ height: 220 }}>호가를 불러오지 못했습니다</div>
      : <div className="skeleton chart-skel" />
  }

  const max = Math.max(1, ...book.asks.map((a) => a.qty), ...book.bids.map((b) => b.qty))
  const rate = (p) => (prevClose ? ((p - prevClose) / prevClose) * 100 : null)
  const asks = [...book.asks].reverse()   // 높은 가격이 위로
  const t = book.time
  const time = t && t.length === 6 ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}` : ''

  const row = (side, level) => (
    <div key={`${side}${level.price}`} className={`ob-row ob-${side}`}>
      <span className="ob-qty ob-left">
        {side === 'ask' && <><i style={{ width: `${(level.qty / max) * 100}%` }} /><em>{level.qty.toLocaleString()}</em></>}
      </span>
      <span className={`ob-price ${tone(level.price - prevClose)}`}>
        <b>{fmtPrice(level.price)}</b>
        <small>{fmtRate(rate(level.price))}</small>
      </span>
      <span className="ob-qty ob-right">
        {side === 'bid' && <><i style={{ width: `${(level.qty / max) * 100}%` }} /><em>{level.qty.toLocaleString()}</em></>}
      </span>
    </div>
  )

  return (
    <div className="orderbook">
      <div className="ob-head"><span>매도 잔량</span><span>통합 호가</span><span>매수 잔량</span></div>
      {asks.map((a) => row('ask', a))}
      {book.bids.map((b) => row('bid', b))}
      <div className="ob-foot">
        <span className="down">{book.total_ask.toLocaleString()}</span>
        <span className="muted">{book.stale ? '접속 많음 · 잠시 지연' : 'KRX+NXT 합산'}{time ? ` · ${time}` : ''}</span>
        <span className="up">{book.total_bid.toLocaleString()}</span>
      </div>
    </div>
  )
}
