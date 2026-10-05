import { useCallback, useState } from 'react'
import { MarketProvider } from './lib/store'
import { useRoute } from './lib/router'
import { TabBar, TopBar } from './components/ui'
import Search from './components/Search'
import Menu from './components/Menu'
import NewsTicker from './components/NewsTicker'
import Market from './pages/Market'
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
    case 'market': return <Market tab={route.param} />
    case 'watch': return <Watch onSearch={openSearch} />
    case 'stock': return <Stock key={route.param} code={route.param || ''} />
    case 'index': return <IndexPage key={route.param} code={route.param || ''} />
    default: return <Home />
  }
}

export default function App() {
  const route = useRoute()
  const [searching, setSearching] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const openSearch = useCallback(() => setSearching(true), [])
  const closeSearch = useCallback(() => setSearching(false), [])
  const isSub = ['theme', 'stock', 'index'].includes(route.page)

  return (
    <MarketProvider>
      <div className="app">
        {!isSub && <TopBar onSearch={openSearch} onMenu={() => setMenuOpen(true)} />}
        <Screen route={route} openSearch={openSearch} />
        <NewsTicker hidden={route.page === 'market' && route.param === 'news'} />
        <TabBar page={route.page} />
        {searching && <Search onClose={closeSearch} />}
        {menuOpen && <Menu onClose={closeMenu} />}
      </div>
    </MarketProvider>
  )
}
