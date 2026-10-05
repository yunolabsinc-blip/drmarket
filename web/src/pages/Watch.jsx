import { useMarket } from '../lib/store'
import { Disclaimer, Empty, StatusLine, StockRow } from '../components/ui'

export default function Watch({ onSearch }) {
  const { favorites, prices, stockMap, memos } = useMarket()
  return (
    <main className="page">
      <h1 className="page-title">관심종목</h1>
      <p className="page-desc">관심종목과 메모는 이 기기의 브라우저에만 저장됩니다.</p>
      <StatusLine />
      {!favorites.length ? (
        <Empty title="관심종목이 없습니다" desc="종목 화면에서 ☆를 누르면 여기에 모아 볼 수 있어요."
          action={<button className="btn" onClick={onSearch}>종목 검색</button>} />
      ) : (
        <div className="card list">
          {favorites.map((code) => {
            const s = { code, name: stockMap[code]?.name || prices[code]?.name || code, ...prices[code] }
            return (
              <div key={code} className="watch-item">
                <StockRow stock={s} />
                {memos[code] && <p className="watch-memo">{memos[code]}</p>}
              </div>
            )
          })}
        </div>
      )}
      <Disclaimer />
    </main>
  )
}
