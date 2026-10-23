import './mobile-app.css'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export default function MobilePageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mobile-app mobile-home mobile-detail-page">
      <div className="mobile-home-inner">
        <header className="mobile-detail-header">
          <Link to="/mobile" className="mobile-back">
            <ArrowLeft size={18} aria-hidden="true" />
            返回首页
          </Link>
          <h1>{title}</h1>
        </header>
        {children}
      </div>
    </main>
  )
}
