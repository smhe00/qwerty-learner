import Loading from './components/Loading'
import NavigationOverlay, { AUXILIARY_PATHS, getAuxiliaryBackground } from './components/NavigationOverlay'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import MobileStudyPage from './pages/Mobile/MobileStudy'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom, reviewModeInfoAtom } from '@/store'
import 'animate.css'
import { useAtom, useAtomValue } from 'jotai'
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { isBrowserFuzzFaultEnabled } from '@/dev/browser-fuzz-hooks'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

// Below this width the keyboard-first Learn/Typing toolbar no longer has a
// reliable two-row fit; use the dedicated narrow-screen layout instead.
const MOBILE_LAYOUT_BREAKPOINT = 700

const loadAnalysisPage = () => import('./pages/Analysis')
const loadGalleryPage = () => import('./pages/Gallery-N')
const loadLearnPage = () => import('./pages/Learn')
const loadAchievementsPage = () => import('./pages/Achievements')

async function loadRouteWithRefresh<T>(
  routeKey: string,
  loader: () => Promise<T>,
): Promise<T> {
  const retryKey = `qwerty:lazy-route-reload:${routeKey}`

  try {
    const module = await loader()
    sessionStorage.removeItem(retryKey)
    return module
  } catch (error) {
    // A browser tab can keep the previous deployment's entry bundle alive
    // while EdgeOne has already promoted a new set of hashed route chunks.
    // A fresh document resolves the entry/chunk versions again. Retry only
    // once per route/build so a real network failure cannot cause a loop.
    if (sessionStorage.getItem(retryKey) !== LATEST_COMMIT_HASH) {
      sessionStorage.setItem(retryKey, LATEST_COMMIT_HASH)
      window.location.reload()
      return new Promise<T>(() => undefined)
    }
    throw error
  }
}

const AnalysisPage = lazy(() =>
  loadRouteWithRefresh('analysis', loadAnalysisPage),
)
const GalleryPage = lazy(() =>
  loadRouteWithRefresh('gallery', loadGalleryPage),
)
const LearnPage = lazy(() =>
  loadRouteWithRefresh('learn', loadLearnPage),
)
const AchievementsPage = lazy(() =>
  loadRouteWithRefresh('achievements', loadAchievementsPage),
)

/** The homepage always enters Learn. Explicit /typing deep links stay Typing,
 * and /learn retains its existing durable-checkpoint recovery semantics. */
function RootIndexRoute() {
  return <Navigate to="/learn" replace />
}

/** The explicit Typing URL always means Typing, even if a previous tab
 * persisted an unfinished Learn record. Preserve the record for later resume. */
function TypingRoute() {
  const [reviewMode, setReviewMode] = useAtom(reviewModeInfoAtom)
  useEffect(() => {
    if (reviewMode.isReviewMode) {
      setReviewMode((old) => ({ ...old, isReviewMode: false }))
    }
  }, [reviewMode.isReviewMode, setReviewMode])
  if (reviewMode.isReviewMode) return <Loading />
  return <TypingPage />
}

function DesktopRoutes() {
  const location = useLocation()
  const isAuxiliary = AUXILIARY_PATHS.has(location.pathname)
  const background = getAuxiliaryBackground(location.pathname, location.search, location.state)
  const persistedBackground = (location.state as {
    backgroundLocation?: { pathname: string }
  } | null)?.backgroundLocation
  const hasLiveBackground = persistedBackground?.pathname === '/learn' ||
    persistedBackground?.pathname === '/typing'
  return (
    <>
      <Routes location={isAuxiliary && hasLiveBackground && background ? background : location}>
        <Route index element={<RootIndexRoute />} />
        <Route path="/typing" element={<TypingRoute />} />
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/mobile" element={<MobilePage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/error-book" element={<ErrorBook />} />
        <Route path="/friend-links" element={<FriendLinks />} />
        <Route path="/*" element={<Navigate to="/" />} />
      </Routes>
      {isAuxiliary && hasLiveBackground && location.pathname === '/gallery' && (
        <NavigationOverlay title="选择词库" size="xl"><GalleryPage embedded /></NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/analysis' && (
        <NavigationOverlay title="数据统计" size="xl"><AnalysisPage embedded /></NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/achievements' && (
        <NavigationOverlay title="成就" size="xl"><AchievementsPage embedded /></NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/error-book' && (
        <NavigationOverlay title="错题本" size="lg"><ErrorBook embedded /></NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/friend-links' && (
        <NavigationOverlay title="网站信息" size="md"><FriendLinks embedded /></NavigationOverlay>
      )}
    </>
  )
}

/** Mobile achievements remain a standalone page opened from the Mobile menu. */
function MobileAchievementsRoute() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-[#f7f4ed] px-2 py-3 text-[#2c2a29] dark:bg-[#1d292c] dark:text-[#eee8dc]">
      <header className="mx-auto mb-3 flex w-full max-w-5xl items-center justify-between gap-3 px-2">
        <span className="text-sm font-semibold tracking-wide">QWERTY Plus · 成就雅集</span>
        <button type="button" onClick={() => navigate('/mobile')}
          className="rounded-lg border border-[#b9ae9a] px-3 py-2 text-sm dark:border-[#71847b]"
          aria-label="返回移动端说明">
          返回
        </button>
      </header>
      <AchievementsPage embedded />
    </div>
  )
}

/** An explicit mobile study route stays mounted through tablet rotation. */
function ResponsiveRoutes({ isMobile }: { isMobile: boolean }) {
  const location = useLocation()
  if (location.pathname === '/mobile/study') return <MobileStudyPage />
  return isMobile ? (
    <Routes>
      <Route path="/mobile" element={<MobilePage />} />
      <Route path="/achievements" element={<MobileAchievementsRoute />} />
      <Route path="/*" element={<Navigate to="/mobile" replace />} />
    </Routes>
  ) : <DesktopRoutes />
}

function Root() {
  const darkMode = useAtomValue(isOpenDarkModeAtom)

  useEffect(() => {
    // Gallery and Learn are the two most common route transitions. Preload
    // their chunks while the current deployment is known-good so a later
    // promotion cannot strand an already-open tab on an old lazy chunk URL.
    const timeout = window.setTimeout(() => {
      void loadGalleryPage().catch(() => undefined)
      void loadLearnPage().catch(() => undefined)
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return

    let active = true
    let cleanup: (() => void) | undefined

    void import('@/review/devtools').then(({ installReviewDevtools }) => {
      if (active) {
        cleanup = installReviewDevtools()
      }
    })

    return () => {
      active = false
      cleanup?.()
    }
  }, [])
  useEffect(() => {
    darkMode ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark')
  }, [darkMode])

  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT)
  const wasMobileRef = useRef(isMobile)

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT
      const wasMobile = wasMobileRef.current
      wasMobileRef.current = nextIsMobile
      setIsMobile(nextIsMobile)

      // Desktop resize is not navigation. The old handler forced every
      // desktop resize (DevTools, side panel, window drag) through "/", which
      // could remount Typing after a Learn terminal checkpoint and resurrect
      // the final word. Only a real mobile -> desktop transition needs to
      // leave the dedicated /mobile route.
      if (
        (
          isBrowserFuzzFaultEnabled(
            'desktop-resize-navigates-root',
          ) &&
          !nextIsMobile
        ) ||
        (
          wasMobile &&
          !nextIsMobile &&
          window.location.pathname.endsWith('/mobile')
        )
      ) {
        const rootPath =
          REACT_APP_DEPLOY_ENV === 'pages'
            ? '/qwerty-learner/'
            : '/'
        window.location.replace(rootPath)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <React.StrictMode>
      <BrowserRouter basename={REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : ''}>
        <Suspense fallback={<Loading />}>
          <ResponsiveRoutes isMobile={isMobile} />
        </Suspense>
      </BrowserRouter>
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

container && createRoot(container).render(<Root />)
