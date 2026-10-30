import MobileBackControl from '@/components/MobileBackControl'
import NavigationOverlay from '@/components/NavigationOverlay'
import UserGuideContent from '@/components/UserGuide'
import '@/pages/Mobile/mobile-app.css'
import '@/pages/Mobile/mobile-page-heading.css'
import { useLocation, useNavigate } from 'react-router-dom'

export default function UserGuidePage({ mobile = false, embedded = false }: { mobile?: boolean; embedded?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { guideReturnPath?: string } | null)?.guideReturnPath
  const knownReturn = mobile && ['/mobile', '/mobile/settings', '/mobile/data'].includes(from ?? '')
  const label = from === '/mobile/settings' ? '返回设置' : from === '/mobile/data' ? '返回账号与云同步' : mobile ? '返回首页' : '回到学习'
  const close = () => (embedded || knownReturn ? navigate(-1) : navigate(mobile ? '/mobile' : '/learn', { replace: true }))
  const content = <UserGuideContent mobile={mobile} onReturn={close} returnLabel={label} />
  if (embedded)
    return (
      <NavigationOverlay title="使用指南" size="md">
        {content}
      </NavigationOverlay>
    )
  return (
    <main className={mobile ? 'mobile-app mobile-home mobile-detail-page user-guide-page' : 'user-guide-page'}>
      <div className={mobile ? 'mobile-home-inner' : 'user-guide-page-inner'}>
        <header className={mobile ? 'mobile-detail-header mobile-subpage-heading' : 'user-guide-page-heading'}>
          <MobileBackControl onBack={close} label={label} />
          <h1>使用指南</h1>
        </header>
        <div className="user-guide-reading">{content}</div>
      </div>
    </main>
  )
}
