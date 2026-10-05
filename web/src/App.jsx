import { useCallback, useEffect, useState } from 'react'
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
import Admin from './pages/Admin'
import Feedback from './components/Feedback'
import { InstallGuide, useInstallGuide } from './components/Install'
import { setRoute, track } from './lib/analytics'

function Screen({ route, openSearch }) {
  switch (route.page) {
    case 'themes': return <Themes />
    case 'theme': return <ThemeDetail id={route.param} />
    case 'rank': return <Rank />
    case 'market': return <Market tab={route.param} />
    case 'watch': return <Watch onSearch={openSearch} />
    case 'stock': return <Stock key={route.param} code={route.param || ''} />
    case 'index': return <IndexPage key={route.param} code={route.param || ''} />
    case 'admin': return <Admin />
    default: return <Home />
  }
}

export default function App() {
  const route = useRoute()
  const [searching, setSearching] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const openSearch = useCallback(() => { setSearching(true); track('search') }, [])
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const install = useInstallGuide()
  useEffect(() => { setRoute(route) }, [route.page, route.param])
  const closeSearch = useCallback(() => setSearching(false), [])
  const isSub = ['theme', 'stock', 'index', 'admin'].includes(route.page)

  return (
    <MarketProvider>
      <div className="app">
        {!isSub && <TopBar onSearch={openSearch} onMenu={() => setMenuOpen(true)} />}
        <Screen route={route} openSearch={openSearch} />
        <NewsTicker hidden={(route.page === 'market' && route.param === 'news') || route.page === 'admin'} />
        <TabBar page={route.page} param={route.param} />
        {searching && <Search onClose={closeSearch} />}
        {menuOpen && <Menu onClose={closeMenu}
          onFeedback={() => { closeMenu(); setFeedbackOpen(true) }}
          onInstall={() => { closeMenu(); install.open() }} />}
        {feedbackOpen && <Feedback page={route.page === 'market' && route.param ? `market/${route.param}` : route.page} onClose={() => setFeedbackOpen(false)} />}
        {install.mode && <InstallGuide mode={install.mode} onClose={install.close} />}
      </div>
    </MarketProvider>
  )
}
