import { Suspense, lazy } from 'react'
import { useLocation } from 'react-router-dom'
import './mobile-app.css'

const LearnPage = lazy(() => import('@/pages/Learn'))

/** Mobile uses the shared Learn session controller and scheduler, with a
 * separate interaction surface. Keyboard input is opt-in by key or explicit selection. */
export default function MobileStudyPage() {
  const location = useLocation()
  return (
    <Suspense fallback={
      <main className="mobile-app mobile-study" data-mobile-study-start>
        <div className="mobile-study-inner">
          <section className="mobile-today mobile-study-start-card" role="status">
            <p className="mobile-eyebrow">TODAY · LEARN</p>
            <h1>正在准备学习</h1>
            <p className="mobile-today-summary">正在载入学习流程…</p>
          </section>
        </div>
      </main>
    }>
      <LearnPage mobile key={location.key} />
    </Suspense>
  )
}
