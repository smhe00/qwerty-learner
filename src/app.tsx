import Loading from './components/Loading'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import 'animate.css'
import { useAtomValue } from 'jotai'
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { isBrowserFuzzFaultEnabled } from '@/dev/browser-fuzz-hooks'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

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

type PersistedLearnRouteState = 'none' | 'active' | 'finished'

function getPersistedLearnRouteState(): PersistedLearnRouteState {
  const raw = localStorage.getItem('reviewModeInfo')
  if (!raw) return 'none'

  try {
    const value = JSON.parse(raw)
    if (!value?.isReviewMode || !value?.reviewRecord) return 'none'
    return value.reviewRecord.isFinished ? 'finished' : 'active'
  } catch {
    return 'none'
  }
}

function RootIndexRoute() {
  const learnState = getPersistedLearnRouteState()

  // A full-document navigation to "/" must never resurrect a Learn checkpoint.
  // This is especially important after terminal completion: the durable record
  // is already finished, while the Typing reducer starts from isFinished=false.
  if (learnState !== 'none') {
    return <Navigate to="/learn" replace />
  }
  return <TypingPage />
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

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600)
  const wasMobileRef = useRef(isMobile)

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 600
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
          <Routes>
            {isMobile ? (
              <Route path="/*" element={<Navigate to="/mobile" />} />
            ) : (
              <>
                <Route index element={<RootIndexRoute />} />
                <Route path="/typing" element={<TypingPage />} />
                <Route path="/learn" element={<LearnPage />} />
                <Route path="/achievements" element={<AchievementsPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/analysis" element={<AnalysisPage />} />
                <Route path="/error-book" element={<ErrorBook />} />
                <Route path="/friend-links" element={<FriendLinks />} />
                <Route path="/*" element={<Navigate to="/" />} />
              </>
            )}
            <Route path="/mobile" element={<MobilePage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

container && createRoot(container).render(<Root />)
