import { ChevronLeft } from 'lucide-react'
import './mobile-achievement-heading.css'

type Props = {
  title: string
  description: string
  onBack: () => void
  progress?: { earned: number; total: number }
}

/** One mobile page heading. Brand belongs to Home, not two stacked headers. */
export function MobileAchievementHeading({ title, description, onBack, progress }: Props) {
  return (
    <header className="mobile-achievement-heading" data-mobile-achievement-header>
      <div className="mobile-achievement-heading-row">
        <button type="button" className="mobile-achievement-back" onClick={onBack}
          aria-label="返回手机首页" title="返回手机首页">
          <ChevronLeft size={24} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <h1>{title}</h1>
        {progress && <span className="mobile-achievement-heading-progress"
          aria-label={'已解锁 ' + progress.earned + '/' + progress.total}>
          <span>已解锁</span>
          <strong>{progress.earned}<small> / {progress.total}</small></strong>
        </span>}
      </div>
      <p className="mobile-achievement-heading-intro">{description}</p>
    </header>
  )
}
