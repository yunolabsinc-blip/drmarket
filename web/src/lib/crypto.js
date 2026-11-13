import { useEffect, useState } from 'react'

// 비트코인·이더리움: 업비트 웹소켓으로 체결될 때마다 받는다 (서버를 거치지 않음, 화면이 보일 때만 연결)
const URL = 'wss://api.upbit.com/websocket/v1'
const live = {}            // 코드 → { value, change, changeRate, date }
const listeners = new Set()
let ws = null
let codes = []
let retry = null

function connect() {
  clearTimeout(retry)
  if (ws || !codes.length || document.visibilityState !== 'visible') return
  const sock = new WebSocket(URL)
  ws = sock
  sock.binaryType = 'arraybuffer'
  sock.onopen = () => sock.send(JSON.stringify([{ ticket: `drm-${Date.now()}` }, { type: 'ticker', codes }, { format: 'SIMPLE' }]))
  sock.onmessage = (e) => {
    try {
      const j = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data))
      if (!j.cd || !(j.tp > 0)) return
      const d = j.tdt || ''   // 업비트 하루는 UTC 기준(오전 9시 KST) — 서버가 주는 날짜와 같게
      live[j.cd] = { value: j.tp, change: j.scp, changeRate: Math.round(j.scr * 10000) / 100, date: d.length === 8 ? `${d.slice(4, 6)}/${d.slice(6)}` : '' }
      listeners.forEach((f) => f())
    } catch {}
  }
  sock.onclose = () => {
    if (ws === sock) ws = null
    if (listeners.size) retry = setTimeout(connect, 3000)
  }
  sock.onerror = () => sock.close()
}

function disconnect() {
  clearTimeout(retry)
  const sock = ws
  ws = null
  sock?.close()
}

document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? connect() : disconnect()))

// items 중 market === 'crypto' 인 것의 값을 실시간 값으로 바꿔 돌려준다
export function useCryptoLive(items) {
  const want = (items || []).filter((i) => i?.market === 'crypto').map((i) => i.code).sort().join(',')
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!want) return
    const f = () => setTick((n) => n + 1)
    listeners.add(f)
    if (want !== codes.join(',')) { codes = want.split(','); disconnect() }
    connect()
    return () => {
      listeners.delete(f)
      if (!listeners.size) { codes = []; disconnect() }
    }
  }, [want])
  return (items || []).map((i) => (i?.market === 'crypto' && live[i.code] ? { ...i, ...live[i.code] } : i))
}
