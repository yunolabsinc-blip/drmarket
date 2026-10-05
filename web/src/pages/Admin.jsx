import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/api'
import { SubBar } from '../components/ui'

const PAGE_NAMES = {
  home: '홈', themes: '전체 테마', theme: '테마 상세', rank: '순위', market: '시장종합',
  'market/news': '뉴스', 'market/calendar': '일정', watch: '관심종목', stock: '종목 화면', index: '지수 화면',
}
const EVENT_NAMES = {
  search: '검색 열기', orderbook: '호가 보기', news_open: '뉴스 요약 펼침', news_link: '기사 원문 이동',
  stock_chip: '뉴스→종목 버튼', ticker_open: '뉴스 띠 누름', chart_period: '차트 기간 변경', theme_open: '테마 열기',
  fav_add: '관심종목 추가', memo_save: '메모 저장', calendar_month: '달력 보기', install: '홈 화면 추가', feedback: '의견 보내기',
}
const KEY = 'drm.adminKey'

export default function Admin() {
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY) || '' } catch { return '' } })
  const [input, setInput] = useState('')
  const [days, setDays] = useState(14)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!key) return
    setError('')
    fetch(`${API_BASE}/api/admin/stats?days=${days}`, { headers: { 'X-Admin-Key': key } })
      .then(async (r) => {
        if (r.status === 401) { try { localStorage.removeItem(KEY) } catch {} ; setKey(''); throw new Error('관리자 키가 올바르지 않습니다.') }
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [key, days])

  const save = () => {
    const k = input.trim()
    if (!k) return
    try { localStorage.setItem(KEY, k) } catch {}
    setKey(k)
  }

  return (
    <>
      <SubBar title="관리자 · 사용 통계" />
      <main className="page admin">
        {!key ? (
          <div className="card admin-login">
            <p>관리자 키를 입력하세요. 이 기기에만 저장됩니다.</p>
            <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="관리자 키" onKeyDown={(e) => e.key === 'Enter' && save()} />
            <button className="btn" onClick={save}>확인</button>
            {error && <p className="fb-msg">{error}</p>}
          </div>
        ) : !data ? <p className="muted">{error || '불러오는 중…'}</p> : (
          <>
            <div className="segmented">
              {[7, 14, 30].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d}일</button>)}
            </div>
            <div className="admin-kpis">
              <div className="card"><span>방문자 (중복 제외)</span><b>{data.unique_visitors?.toLocaleString()}</b></div>
              <div className="card"><span>화면 조회</span><b>{data.daily?.reduce((s, d) => s + d.views, 0).toLocaleString()}</b></div>
              <div className="card"><span>총 이용 시간</span><b>{Math.round((data.daily?.reduce((s, d) => s + d.minutes, 0) || 0) / 60 * 10) / 10}시간</b></div>
            </div>

            <h2 className="admin-h">날짜별</h2>
            <div className="card"><table className="admin-table">
              <thead><tr><th>날짜</th><th>방문자</th><th>조회</th><th>이용(분)</th></tr></thead>
              <tbody>{data.daily.map((d) => <tr key={d.date}><td>{d.date.slice(5)}</td><td>{d.visitors}</td><td>{d.views}</td><td>{d.minutes}</td></tr>)}</tbody>
            </table></div>

            <h2 className="admin-h">화면별</h2>
            <div className="card"><table className="admin-table">
              <thead><tr><th>화면</th><th>조회</th><th>이용(분)</th><th>평균(초)</th></tr></thead>
              <tbody>{data.pages.map((p) => <tr key={p.page}><td>{PAGE_NAMES[p.page] || p.page}</td><td>{p.views}</td><td>{p.minutes}</td><td>{p.avg_sec}</td></tr>)}</tbody>
            </table></div>

            <h2 className="admin-h">기능 사용</h2>
            <div className="card"><table className="admin-table">
              <tbody>{Object.entries(data.events).map(([k, v]) => <tr key={k}><td>{EVENT_NAMES[k] || k}</td><td>{v}회</td></tr>)}</tbody>
            </table>{!Object.keys(data.events).length && <p className="muted-box">아직 기록이 없습니다</p>}</div>

            <h2 className="admin-h">받은 의견 ({data.feedback.length})</h2>
            <div className="card list">
              {data.feedback.length ? data.feedback.map((f, i) => (
                <div key={i} className="admin-fb">
                  <span>{f.t.replace('T', ' ').slice(0, 16)}{f.page ? ` · ${PAGE_NAMES[f.page] || f.page}` : ''}{f.contact ? ` · 연락처: ${f.contact}` : ''}</span>
                  <p>{f.text}</p>
                </div>
              )) : <p className="muted-box">아직 받은 의견이 없습니다</p>}
            </div>
            <button className="btn ghost wide-ghost" onClick={() => { try { localStorage.removeItem(KEY) } catch {} ; setKey(''); setData(null) }}>이 기기에서 관리자 키 지우기</button>
          </>
        )}
      </main>
    </>
  )
}
