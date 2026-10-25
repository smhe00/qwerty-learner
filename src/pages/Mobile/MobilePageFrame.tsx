import './mobile-app.css'
import './mobile-page-heading.css'
import MobileBackControl from '@/components/MobileBackControl'
import type { ReactNode } from 'react'

export default function MobilePageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mobile-app mobile-home mobile-detail-page">
      <div className="mobile-home-inner">
        <header className="mobile-detail-header mobile-subpage-heading">
          <MobileBackControl to="/mobile" label="返回首页" />
          <h1>{title}</h1>
        </header>
        {children}
      </div>
    </main>
  )
}
