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

// 종목 화면 전체가 쓰는 호가 (차트 탭에서도 계속 받음) — 호가·현재가·차트 마지막 봉이 같은 응답에서 나와 같이 움직인다
export function useOrderbook(code) {
  const [book, setBook] = useState(() => books.get(code)?.d || null)
  const [failed, setFailed] = useState(false)
  const bookRef = useRef(book)

  useEffect(() => {
    let alive = true
    let timer
    setBook(books.get(code)?.d || null)
    const load = () =>
      getOrderbook(code)
        .then((d) => { remember(code, d); if (alive) { bookRef.current = d; setBook(d); setFailed(false) } })
        .catch(() => alive && setFailed(true))
        .finally(() => {
          // 서버가 부하에 맞춰 알려주는 간격(1~8초)을 따른다. 화면이 안 보이면 30초
          if (!alive) return
          const next = document.visibilityState !== 'visible' ? 30000 : marketPhase().key === 'open' ? (bookRef.current?.next_ms || 1000) : 30000
          timer = setTimeout(load, next)
        })
    timer = setTimeout(load, books.has(code) ? 0 : 300)   // 처음엔 차트가 먼저 뜨게 아주 잠깐 뒤에
    // 다른 앱에 갔다 돌아오면 30초를 기다리지 않고 바로 갱신
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !alive) return
      clearTimeout(timer)
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [code])
  return { book, failed }
}

// VI(변동성완화장치) 구분 코드: 없음이면 N·0·빈값
export const viOn = (code) => !!code && !['N', '0', '00'].includes(code)

// 10단계 호가: 위쪽 매도(파랑), 아래쪽 매수(빨강), 잔량 막대
// 매도 쪽 오른칸·매수 쪽 왼칸(비어 있는 자리)에 현재가·시가·고가·저가·상하한·VI를 보여 준다
export default function OrderBook({ book, failed, prevClose, price, detail }) {

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

  const now = price || book.price || detail?.price || 0
  // 장중 고가·저가는 호가 응답(같은 순간)에 있으면 그걸, 없으면 종목 시세 값
  const high = Math.max(book.high || 0, detail?.high || 0, now) || 0
  const lowCands = [book.low, detail?.low, now].filter((v) => v > 0)
  const low = lowCands.length ? Math.min(...lowCands) : 0
  const open = book.open || detail?.open || 0
  const vi = viOn(book.vi_code)

  const item = (label, v, cls) => ({ label, v, cls })
  const infos = [
    item('현재', now, 'ob-i-now'),
    item('시가', open),
    item('고가', high),
    item('저가', low),
    detail?.upper_limit ? item('상한', detail.upper_limit) : null,
    detail?.lower_limit ? item('하한', detail.lower_limit) : null,
    { label: 'VI', vi: true },
  ].filter(Boolean)
  // 매도 오른칸부터 채우고, 매도 호가 줄이 모자라면 매수 왼칸으로
  const askInfo = infos.slice(0, asks.length)
  const bidInfo = infos.slice(asks.length)

  const info = (x) => {
    if (!x) return null
    if (x.vi) {
      return (
        <span className="ob-info">
          <small>VI</small>
          {vi ? <b className="ob-vi">발동</b> : <b className="muted">{book.vi_code == null ? '-' : '없음'}</b>}
        </span>
      )
    }
    return (
      <span className={`ob-info ${x.cls || ''}`}>
        <small>{x.label}</small>
        <span className={`ob-info-v ${x.v ? tone(x.v - prevClose) : 'muted'}`}><b>{x.v ? fmtPrice(x.v) : '-'}</b>{x.v && prevClose ? <em>{fmtRate(rate(x.v))}</em> : null}</span>
      </span>
    )
  }

  const row = (side, level, extra) => {
    // 호가 줄 안에 색으로: 고가(빨강)·저가(파랑)·시가(회색) 배지, 상·하한가 배지, 오늘 움직인 범위(저가~고가)는 왼쪽 띠
    const p = level.price
    const tags = []
    if (p === high && high) tags.push(<i key="h" className="ob-tag ob-tag-high">고</i>)
    if (p === low && low) tags.push(<i key="l" className="ob-tag ob-tag-low">저</i>)
    if (p === open && open) tags.push(<i key="o" className="ob-tag ob-tag-open">시</i>)
    if (p === detail?.upper_limit) tags.push(<i key="u" className="ob-tag ob-tag-high">상</i>)
    if (p === detail?.lower_limit) tags.push(<i key="d" className="ob-tag ob-tag-low">하</i>)
    const inRange = low && high && p >= low && p <= high
    const cls = [`ob-row ob-${side}`, p === now && 'ob-now', p === high && high && 'ob-at-high', p === low && low && 'ob-at-low', inRange && 'ob-in-range', vi && p === now && 'ob-vi-now'].filter(Boolean).join(' ')
    return (
      <div key={`${side}${level.price}`} className={cls}>
        <span className="ob-qty ob-left">
          {side === 'ask' ? <><i style={{ width: `${(level.qty / max) * 100}%` }} /><em>{level.qty.toLocaleString()}</em></> : info(extra)}
        </span>
        <span className={`ob-price ${tone(level.price - prevClose)}`}>
          {tags.length > 0 && <span className="ob-tags">{tags}</span>}
          <b>{fmtPrice(level.price)}</b>
          <small>{fmtRate(rate(level.price))}</small>
        </span>
        <span className="ob-qty ob-right">
          {side === 'bid' ? <><i style={{ width: `${(level.qty / max) * 100}%` }} /><em>{level.qty.toLocaleString()}</em></> : info(extra)}
        </span>
      </div>
    )
  }

  return (
    <div className={`orderbook${Math.max(0, ...book.asks.map((a) => a.price), ...book.bids.map((b) => b.price), detail?.upper_limit || 0) >= 1000000 ? ' ob-long' : ''}`}>
      {vi && <div className="ob-vi-bar">변동성완화장치(VI) 발동 중 · 단일가 매매</div>}
      <div className="ob-head"><span>매도 잔량</span><span>통합 호가</span><span>매수 잔량</span></div>
      {asks.map((a, i) => row('ask', a, askInfo[i]))}
      {book.bids.map((b, i) => row('bid', b, bidInfo[i]))}
      <div className="ob-foot">
        <span className="down">{book.total_ask.toLocaleString()}</span>
        <span className="muted">{book.stale ? '접속 많음 · 잠시 지연' : 'KRX+NXT 합산'}{time ? ` · ${time}` : ''}</span>
        <span className="up">{book.total_bid.toLocaleString()}</span>
      </div>
    </div>
  )
}
