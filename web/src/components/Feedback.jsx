import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/api'
import { track } from '../lib/analytics'
import { CloseIcon } from './ui'

// 의견 보내기: 내용(필수) + 연락처(선택). 연락처를 적은 경우에만 저장된다.
export default function Feedback({ onClose, page }) {
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState('idle')   // idle | sending | done | error
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = async () => {
    if (text.trim().length < 2) { setMsg('내용을 입력해 주세요.'); return }
    setState('sending')
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, contact, page }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || '보내지 못했습니다')
      }
      track('feedback')
      setState('done')
    } catch (e) {
      setState('error')
      setMsg(e.message || '보내지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <div className="sheet-layer" onClick={onClose} role="dialog" aria-modal="true" aria-label="의견 보내기">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b className="sheet-title">의견 보내기</b>
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><CloseIcon /></button>
        </div>
        {state === 'done' ? (
          <div className="fb-done">
            <p>보내 주셔서 감사합니다. 서비스 개선에 반영하겠습니다.</p>
            <button className="btn" onClick={onClose}>닫기</button>
          </div>
        ) : (
          <>
            <p className="fb-desc">불편한 점, 있었으면 하는 기능, 오류 등 무엇이든 적어 주세요.</p>
            <textarea className="fb-text" value={text} maxLength={1000} autoFocus
              placeholder="예) 종목 화면에서 호가가 늦게 바뀌어요" onChange={(e) => { setText(e.target.value); setMsg('') }} />
            <input className="fb-contact" value={contact} maxLength={100}
              placeholder="답변 받을 연락처 (선택 · 이메일이나 카카오톡 ID)" onChange={(e) => setContact(e.target.value)} />
            <p className="fb-note">연락처는 적은 경우에만 답변 목적으로 저장되며, 그 외 개인정보는 수집하지 않습니다.</p>
            {msg && <p className="fb-msg">{msg}</p>}
            <div className="sheet-actions">
              <button className="btn" onClick={send} disabled={state === 'sending'}>{state === 'sending' ? '보내는 중…' : '보내기'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
