import './mobile-app.css'
import './mobile-page-heading.css'
import { useMobileVisualViewport } from './useMobileVisualViewport'
import MobileBackControl from '@/components/MobileBackControl'
import { useRef } from 'react'
import type { ReactNode } from 'react'

export default function MobilePageFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useMobileVisualViewport(Boolean(footer), ref)
  return (
    <main ref={ref} className="mobile-app mobile-home mobile-detail-page" data-page-scroll={footer ? true : undefined}>
      <div className="mobile-home-inner">
        <header className="mobile-detail-header mobile-subpage-heading">
          <MobileBackControl to="/mobile" label="返回首页" />
          <h1>{title}</h1>
        </header>
        {footer ? (
          <>
            <div className="mobile-page-scroll">{children}</div>
            {footer}
          </>
        ) : (
          children
        )}
      </div>
    </main>
  )
}
