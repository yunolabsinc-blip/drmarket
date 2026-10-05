import { useCallback, useState } from 'react'
import { MarketProvider } from './lib/store'
import { useRoute } from './lib/router'
import { TabBar, TopBar } from './components/ui'
import Search from './components/Search'
import Home from './pages/Home'
import Themes, { ThemeDetail } from './pages/Themes'
import Rank from './pages/Rank'
import Watch from './pages/Watch'
import Stock, { IndexPage } from './pages/Stock'

function Screen({ route, openSearch }) {
  switch (route.page) {
    case 'themes': return <Themes />
    case 'theme': return <ThemeDetail id={route.param} />
    case 'rank': return <Rank />
    case 'watch': return <Watch onSearch={openSearch} />
    case 'stock': return <Stock key={route.param} code={route.param || ''} />
    case 'index': return <IndexPage key={route.param} code={route.param || ''} />
    default: return <Home />
  }
}

export default function App() {
  const route = useRoute()
  const [searching, setSearching] = useState(false)
  const openSearch = useCallback(() => setSearching(true), [])
  const closeSearch = useCallback(() => setSearching(false), [])
  const isSub = ['theme', 'stock', 'index'].includes(route.page)

  return (
    <MarketProvider>
      <div className="app">
        {!isSub && <TopBar onSearch={openSearch} />}
        <Screen route={route} openSearch={openSearch} />
        <TabBar page={route.page} />
        {searching && <Search onClose={closeSearch} />}
      </div>
    </MarketProvider>
  )
}
