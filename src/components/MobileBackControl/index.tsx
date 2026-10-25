import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import './mobile-back-control.css'

type Props = {
  label?: string
  className?: string
} & (
  | { to: string; onBack?: never }
  | { to?: never; onBack: () => void }
)

/** Shared visual control only: callers retain their existing routing semantics. */
export default function MobileBackControl(props: Props) {
  const label = props.label ?? '返回首页'
  const className = ['mobile-back-control', props.className].filter(Boolean).join(' ')
  const icon = <ChevronLeft size={24} strokeWidth={1.8} aria-hidden="true" focusable="false" />
  return props.to !== undefined ? (
    <Link to={props.to} className={className} aria-label={label} title={label} data-mobile-back-control="">
      {icon}
    </Link>
  ) : (
    <button type="button" onClick={props.onBack} className={className}
      aria-label={label} title={label} data-mobile-back-control="">
      {icon}
    </button>
  )
}
