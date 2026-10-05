export const fmtPrice = (n) => (n || n === 0 ? Math.round(n).toLocaleString('ko-KR') : '-')

export const fmtIndex = (n) =>
  n ? n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'

export const fmtRate = (r) => {
  if (r === null || r === undefined || Number.isNaN(r)) return '-'
  const v = Number(r)
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

export const fmtChange = (c) => {
  if (!c) return '0'
  return `${c > 0 ? '▲' : '▼'} ${Math.abs(Math.round(c)).toLocaleString('ko-KR')}`
}

// 원 단위 금액 → 조/억 표기
export const fmtWon = (n) => {
  if (!n) return '-'
  const eok = n / 1e8
  if (eok >= 10000) {
    const jo = Math.floor(eok / 10000)
    const rest = Math.round(eok % 10000)
    return rest ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억` : `${jo.toLocaleString()}조`
  }
  if (eok >= 1) return `${Math.round(eok).toLocaleString()}억`
  return `${Math.round(n / 1e4).toLocaleString()}만`
}

// 좁은 칸용: 1조 이상은 소수 첫째 자리 조 단위
export const fmtWonShort = (n) => {
  if (!n) return '-'
  const eok = n / 1e8
  if (eok >= 10000) return `${(eok / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조`
  return fmtWon(n)
}

export const fmtVolume = (n) => {
  if (!n) return '-'
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억주`
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만주`
  return `${n.toLocaleString()}주`
}

export const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat')

// 한국 장 운영 상태 (공휴일은 반영하지 않음)
export function marketPhase(now = new Date()) {
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
  const day = kst.getDay()
  const m = kst.getHours() * 60 + kst.getMinutes()
  if (day === 0 || day === 6) return { key: 'closed', label: '휴장' }
  if (m >= 510 && m < 540) return { key: 'pre', label: '장 시작 전' }
  if (m >= 540 && m <= 930) return { key: 'open', label: '장 운영 중' }
  return { key: 'closed', label: '장 마감' }
}

export const fmtTime = (d) =>
  d ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''
