import { useState } from 'react'
import { LogoMark } from './Logo'
import { GATE_KEY } from '../lib/api'

// 시세 이용 계약 전까지 사이트를 비밀번호로 막아 둔다 (코스콤: 증권사 API 시세의 외부 화면 표출 금지)
// 비밀번호로 접속 키를 만들어 이 기기에 저장(다음부터는 묻지 않음). 서버도 같은 키로 확인한다
// 코드에는 비밀번호·키 대신 키의 해시만 둔다
const HASH = 'da7e11ba92ccaabab239516146b07dd28432664c1c3744aae17a36bd41c7e335'   // sha256(접속 키), 서버 main.py 와 같음

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const unlocked = () => { try { return !!localStorage.getItem(GATE_KEY) } catch { return false } }

export default function Gate({ children }) {
  const [open, setOpen] = useState(unlocked)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  if (open) return children
  const submit = async (e) => {
    e.preventDefault()
    const token = await sha256(`drmarket-api:${pin}`)
    if ((await sha256(token)) === HASH) {
      try { localStorage.setItem(GATE_KEY, token) } catch {}
      setOpen(true)
    } else {
      setError('비밀번호가 맞지 않습니다')
      setPin('')
    }
  }
  return (
    <main className="gate">
      <LogoMark size={44} />
      <h1>닥터마켓</h1>
      <p>정식 공개 전 준비 중인 서비스입니다.</p>
      <form className="card admin-login" onSubmit={submit}>
        <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" className="pin-input" autoFocus
          value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }} placeholder="비밀번호" aria-label="비밀번호" />
        <button className="btn" type="submit" disabled={!pin}>들어가기</button>
        {error && <p className="fb-msg">{error}</p>}
      </form>
    </main>
  )
}
