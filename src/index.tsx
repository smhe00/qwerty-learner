import Loading from './components/Loading'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import { Analytics } from '@vercel/analytics/react'
import 'animate.css'
import { useAtomValue } from 'jotai'
import mixpanel from 'mixpanel-browser'
import process from 'process'
import React, { Suspense, lazy, useEffect, useState } from 'react'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

const loadAnalysisPage = () => import('./pages/Analysis')
const loadGalleryPage = () => import('./pages/Gallery-N')
const loadLearnPage = () => import('./pages/Learn')

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

function hasPersistedLearnSession(): boolean {
  const raw = localStorage.getItem('reviewModeInfo')
  if (!raw) return false

  try {
    const value = JSON.parse(raw)
    return Boolean(value?.isReviewMode && value?.reviewRecord)
  } catch {
    return false
  }
}

function LearnSessionRoute() {
  // atomWithStorage hydrates after the first React render. Route admission
  // must therefore use localStorage synchronously and only once; subscribing
  // to reviewModeInfo here would let transient hydration/default values
  // redirect an otherwise valid live Learn session.
  return hasPersistedLearnSession() ? (
    <TypingPage />
  ) : (
    <Navigate to="/learn" replace />
  )
}

if (process.env.NODE_ENV === 'production') {
  // for prod
  mixpanel.init('bdc492847e9340eeebd53cc35f321691')
} else {
  // for dev
  mixpanel.init('5474177127e4767124c123b2d7846e2a', { debug: true })
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

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth <= 600
      if (!isMobile) {
        window.location.href = '/'
      }
      setIsMobile(isMobile)
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
                <Route index element={<TypingPage />} />
                <Route path="/typing" element={<TypingPage />} />
                <Route path="/learn" element={<LearnPage />} />
                <Route path="/learn/session" element={<LearnSessionRoute />} />
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
      <Analytics />
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

container && createRoot(container).render(<Root />)
