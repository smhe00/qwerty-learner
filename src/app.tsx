import Loading from './components/Loading'
import InterfaceErrorBoundary from './components/InterfaceErrorBoundary'
import { useLearnKeyboardIntent } from '@/hooks/useLearnKeyboardIntent'
import NavigationOverlay, { AUXILIARY_PATHS, getAuxiliaryBackground } from './components/NavigationOverlay'
import QuickSyncNotice from './components/QuickSyncNotice'
import FeedbackCenter from './feedback/FeedbackCenter'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import MobileLibrary from './pages/Mobile/MobileLibrary'
import MobileSettings from './pages/Mobile/MobileSettings'
import MobileStudyPage from './pages/Mobile/MobileStudy'
import TypingPage from './pages/Typing'
import AccountTools from './sync/AccountTools'
import { isBrowserFuzzFaultEnabled } from '@/dev/browser-fuzz-hooks'
import { isOpenDarkModeAtom, reviewModeInfoAtom } from '@/store'
import 'animate.css'
import { useAtom, useAtomValue } from 'jotai'
import React, { Suspense, lazy, useEffect, useState } from 'react'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

// Below this width the keyboard-first Learn/Typing toolbar no longer has a
// reliable two-row fit; use the dedicated narrow-screen layout instead.
const MOBILE_LAYOUT_BREAKPOINT = 700

// A wide tablet still needs touch controls. These describe the primary input,
// not the UA or the mere presence of a touchscreen on a mouse-first laptop.
const TOUCH_POINTER_QUERY = '(pointer: coarse)'
const NO_HOVER_QUERY = '(hover: none)'
function prefersTouchLayout() {
  return (
    window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT ||
    (typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_POINTER_QUERY).matches && window.matchMedia(NO_HOVER_QUERY).matches)
  )
}

const loadAnalysisPage = () => import('./pages/Analysis')
const loadGalleryPage = () => import('./pages/Gallery-N')
const loadLearnPage = () => import('./pages/Learn')
const loadAchievementsPage = () => import('./pages/Achievements')

async function loadRouteWithRefresh<T>(routeKey: string, loader: () => Promise<T>): Promise<T> {
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

const AnalysisPage = lazy(() => loadRouteWithRefresh('analysis', loadAnalysisPage))
const GalleryPage = lazy(() => loadRouteWithRefresh('gallery', loadGalleryPage))
const LearnPage = lazy(() => loadRouteWithRefresh('learn', loadLearnPage))
const AchievementsPage = lazy(() => loadRouteWithRefresh('achievements', loadAchievementsPage))
const CirclePage = lazy(() => loadRouteWithRefresh('circles', () => import('./pages/Circle')))
const UserGuidePage = lazy(() => loadRouteWithRefresh('guide', () => import('./pages/UserGuide')))
const MobileHistory = lazy(() => loadRouteWithRefresh('mobile-history', () => import('./pages/Mobile/MobileHistory')))
const MobileData = lazy(() => loadRouteWithRefresh('mobile-data', () => import('./pages/Mobile/MobileData')))

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
  const persistedBackground = (
    location.state as {
      backgroundLocation?: { pathname: string }
    } | null
  )?.backgroundLocation
  const hasLiveBackground = persistedBackground?.pathname === '/learn' || persistedBackground?.pathname === '/typing'
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
        <Route path="/circles" element={<CirclePage />} />
        <Route path="/guide" element={<UserGuidePage />} />
        <Route path="/*" element={<Navigate to="/" />} />
      </Routes>
      {isAuxiliary && hasLiveBackground && location.pathname === '/gallery' && (
        <NavigationOverlay title="选择词库" size="xl">
          <GalleryPage embedded />
        </NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/analysis' && (
        <NavigationOverlay title="数据统计" size="xl">
          <AnalysisPage embedded />
        </NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/achievements' && (
        <NavigationOverlay title="成就" size="xl">
          <AchievementsPage embedded />
        </NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/error-book' && (
        <NavigationOverlay title="错题本" size="lg">
          <ErrorBook embedded />
        </NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/circles' && (
        <NavigationOverlay title="圈子" size="lg">
          <CirclePage embedded />
        </NavigationOverlay>
      )}
      {isAuxiliary && hasLiveBackground && location.pathname === '/guide' && <UserGuidePage embedded />}
      {isAuxiliary && hasLiveBackground && location.pathname === '/friend-links' && (
        <NavigationOverlay title="网站信息" size="md">
          <FriendLinks embedded />
        </NavigationOverlay>
      )}
    </>
  )
}

/** The collection owns one integrated mobile header, not a second brand bar. */
function MobileAchievementsRoute() {
  return <AchievementsPage embedded mobile />
}

/** An explicit mobile study route stays mounted through tablet rotation. */
function ResponsiveRoutes({ isMobile }: { isMobile: boolean }) {
  const location = useLocation()
  // An explicit touch route is a user choice. Rotation, unfolding or attaching
  // a pointer must not send its menu back to keyboard-first Learn.
  if (location.pathname === '/mobile') return <MobilePage />
  if (location.pathname === '/mobile/study') return <MobileStudyPage />
  if (location.pathname === '/mobile/library') return <MobileLibrary />
  if (location.pathname === '/mobile/settings') return <MobileSettings />
  const mobilePath = location.pathname.replace(/\/$/, '')
  if (mobilePath === '/mobile/guide' || (isMobile && mobilePath === '/guide')) return <UserGuidePage mobile />
  if (mobilePath === '/mobile/history') return <MobileHistory />
  if (isMobile && mobilePath === '/circles') return <CirclePage mobile />
  if (mobilePath === '/mobile/circles') return <CirclePage mobile />
  if (mobilePath === '/mobile/data') return <MobileData />
  if (mobilePath === '/mobile/achievements') return <MobileAchievementsRoute />
  return isMobile ? (
    <Routes>
      <Route path="/mobile" element={<MobilePage />} />
      <Route path="/achievements" element={<MobileAchievementsRoute />} />
      <Route path="/*" element={<Navigate to="/mobile" replace />} />
    </Routes>
  ) : (
    <DesktopRoutes />
  )
}

function Root() {
  useLearnKeyboardIntent()
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

  const [isMobile, setIsMobile] = useState(prefersTouchLayout)

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = prefersTouchLayout()
      setIsMobile(nextIsMobile)

      // Normal responsive transitions stay inside the router and retain the
      // same document/writer lease. Keep the explicit simulator fault only.
      if (isBrowserFuzzFaultEnabled('desktop-resize-navigates-root') && !nextIsMobile) {
        const rootPath = REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner/' : '/'
        window.location.replace(rootPath)
      }
    }

    window.addEventListener('resize', handleResize)
    const inputQueries =
      typeof window.matchMedia === 'function' ? [window.matchMedia(TOUCH_POINTER_QUERY), window.matchMedia(NO_HOVER_QUERY)] : []
    inputQueries.forEach((query) => query.addEventListener('change', handleResize))

    return () => {
      window.removeEventListener('resize', handleResize)
      inputQueries.forEach((query) => query.removeEventListener('change', handleResize))
    }
  }, [])

  return (
    <React.StrictMode>
      <BrowserRouter basename={REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : ''}>
        <Suspense fallback={<Loading />}>
          <ResponsiveRoutes isMobile={isMobile} />
        </Suspense>
        <AccountTools />
        <QuickSyncNotice />
        <FeedbackCenter />
      </BrowserRouter>
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

container && createRoot(container).render(<InterfaceErrorBoundary><Root /></InterfaceErrorBoundary>)
