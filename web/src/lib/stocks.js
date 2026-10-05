// 글(뉴스 제목·요약)에서 종목명을 찾아 종목 코드로 연결
// - 긴 이름을 먼저 찾아 "LG에너지솔루션"이 "LG"로 잡히지 않게 한다
// - 2글자 이름은 앞뒤가 다른 글자와 붙어 있지 않을 때만 인정하고, 일반 단어와 같은 이름은 제외
// - 자주 쓰는 줄임말은 별도 표로 연결

const ALIASES = {
  삼전: '005930', 삼성전자: '005930', 하이닉스: '000660', 하닉: '000660',
  네이버: '035420', 현대자동차: '005380', LG엔솔: '373220', 엘지엔솔: '373220',
  삼바: '207940', 삼성바이오: '207940', 한화에어로: '012450', 한화에어로스페이스: '012450',
  셀트리온: '068270', 카카오: '035720', 포스코: '005490', 포스코홀딩스: '005490',
  현대중공업: '329180', 한화오션: '042660', 두산에너빌: '034020', 두산에너빌리티: '034020',
  에코프로비엠: '247540', 알테오젠: '196170', 삼성SDI: '006400', LG화학: '051910',
  KB금융: '105560', 신한지주: '055550', 하나금융: '086790', 하나금융지주: '086790',
  우리금융: '316140', 우리금융지주: '316140', 기아: '000270', 현대차: '005380',
}

// 종목명이지만 일반 단어로 더 자주 쓰여 본문 매칭에서 제외하는 이름
const GENERIC = new Set([
  '대상', '동양', '선진', '태양', '진도', '나노', '레이', '레몬', '캐리', '삼일', '한창', '일승', '성우', '진영',
  '서남', '태성', '세중', '대창', '서한', '신원', '대원', '원준', '전방', '삼진', '우성', '신흥', '남성', '동방',
  '덕성', '백산', '화신', '서흥', '흥국', '광무', '상보', '영흥', '대현', '두올', '세방', '승일', '오공', '서산',
  '코디', '하츠', '풍강', '테스', '우양', '삼기', '알톤', '율촌', '포톤', '러셀', '야스', '배럴', '핀텔', '국전',
  '대모', '센코', '노을', '워트', '꿈비', '삼현', '하스', '삐아', '컨텍', '벡트', '위츠', '알트', '더즌', '닷밀',
  '노타', '대동', '혜인', '방림', '삼영', '원림', '서연', '대덕', '원풍', '금비', '이렘', '청보', '부방', '졸스',
  '대교', '서원', '태광', '인팩', '동서', '한컴', '피노', '무학', '솔본', '희림', '파루', '태웅', '세동', '유신',
  '엠로', '미코', '빅텍', '오텍', '쎄크', '인콘', '후성', '한텍', '스맥', '톱텍', '제닉', '뉴온', '코칩', '앱코',
  '딜리', '아톤', '핑거', '베셀', '웹스', '캐프', '엑셈', '넵튠', '팬젠', '본느', '힘스', '앱튼', '팸텍', '천보',
  '트윔', '쿠콘', '누보', '원텍', '오아', '핌스', '휴럼', '알멕', '코셈', '엔젯', '산돌', '한싹', '퓨릿', '지슨', '한켐',
])

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const KO = /[가-힣A-Za-z0-9]/
// 종목명 뒤에 붙어도 되는 조사·접미어 (그 외 한글이 붙으면 더 긴 단어의 일부로 본다)
const PARTICLE = /^(은|는|이|가|을|를|의|와|과|에|도|만|로|으|측|주|株|등|까지|부터|보다|처럼)/
// 기사에서 분석 주체로 자주 나오는 증권사는 해당 종목 기사로 보기 어렵다
const BROKER = /증권$|금융투자$/

export function buildMatcher(stockList) {
  if (!stockList?.length) return () => []
  const byName = new Map()
  for (const [code, name] of stockList) byName.set(name, code)
  const names = [...byName.keys(), ...Object.keys(ALIASES)]
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)
  const re = new RegExp(names.map(esc).join('|'), 'g')
  const nameMap = new Map(stockList.map(([code, name]) => [code, name]))

  return (text) => {
    if (!text) return []
    const found = new Map()
    const brokers = new Map()   // 증권사는 다른 종목이 없을 때만 (증권사 자체 기사)
    let m
    re.lastIndex = 0
    while ((m = re.exec(text))) {
      const name = m[0]
      const before = text[m.index - 1] || ''
      const after = text[m.index + name.length] || ''
      const rest = text.slice(m.index + name.length, m.index + name.length + 2)
      if (name.length <= 2 || /^[A-Za-z0-9]+$/.test(name)) {
        if (GENERIC.has(name)) continue
        if (KO.test(before)) continue
        if (KO.test(after) && !PARTICLE.test(rest)) continue        // 다른 글자와 붙어 있으면 다른 단어
      } else {
        if (/[가-힣]/.test(before)) continue                         // 앞에 한글이 붙어 있으면 더 긴 단어의 일부
        if (/[가-힣]/.test(after) && !PARTICLE.test(rest)) continue  // "이녹스리튬"의 "이녹스" 같은 경우
      }
      const code0 = ALIASES[name] || byName.get(name)
      if (BROKER.test(name)) { if (code0 && !brokers.has(code0)) brokers.set(code0, nameMap.get(code0) || name); continue }
      const code = ALIASES[name] || byName.get(name)
      if (code && !found.has(code)) found.set(code, nameMap.get(code) || name)
      if (found.size >= 6) break
    }
    // 괄호 안 종목코드 "(005930)"
    for (const [, code] of text.matchAll(/\((\d{6})\)/g)) {
      if (nameMap.has(code) && !found.has(code)) found.set(code, nameMap.get(code))
    }
    const result = found.size ? found : brokers
    return [...result].map(([code, name]) => ({ code, name }))
  }
}
