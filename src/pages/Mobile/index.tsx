import MobileDailyProgress from './MobileDailyProgress'
import './mobile-app.css'
import { useMobileCheckpoint } from './useMobileCheckpoint'
import { useMobileDailyProgress } from './useMobileDailyProgress'
import logo from '@/assets/logo.svg'
import { currentDictInfoAtom } from '@/store'
import { openAccountDialog } from '@/sync/account-dialog-events'
import { loadAuth } from '@/sync/auth'
import { secureLearningEntry } from '@/sync/learning-sync-policy'
import { useAtomValue } from 'jotai'
import { BookOpen, ChevronRight, CircleUserRound, Cloud, LayoutGrid, Medal, Settings2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'

/** Dedicated menu-first mobile shell. Every displayed entry has a real route. */
export default function MobilePage() {
  const { checkpoint } = useMobileCheckpoint()
  const daily = useMobileDailyProgress()
  const dictionary = useAtomValue(currentDictInfoAtom)
  const auth = loadAuth({ preserveExpired: true })
  const accountHref = (REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : '') + '/mobile/account'
  // Replace the home history entry so the account flow does not retain it.
  // Some mobile browsers otherwise apply a new-tab policy to ordinary links.
  const openAccount = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    openAccountDialog()
  }
  const expired = !!auth && auth.expiresAt * 1000 <= Date.now()
  const menus = [
    { title: '成就', subtitle: '成就雅集 · 查看解锁与收藏', icon: Medal, route: '/mobile/achievements' },
    { title: '词库', subtitle: '选择词库 · 分别保留学习进度', icon: BookOpen, route: '/mobile/library' },
    { title: '学习记录', subtitle: '按日期与词库查看已保存的练习', icon: LayoutGrid, route: '/mobile/history' },
    {
      title: '账号与云同步',
      subtitle: auth ? (expired ? '登录已过期 · ' : '已登录 · ') + auth.user.username : '登录或注册 · 使用账号学习空间',
      icon: Cloud,
      route: '/mobile/data',
    },
    { title: '设置', subtitle: '每日目标 · 单词发音 · 显示', icon: Settings2, route: '/mobile/settings' },
  ]
  const resume = checkpoint ? Math.min(checkpoint.index + 1, checkpoint.words.length) : null

  return (
    <main data-mobile-menu className="mobile-app mobile-home">
      <div className="mobile-home-inner">
        <header className="mobile-brand">
          <img src={logo} width={40} height={40} alt="" aria-hidden="true" />
          <div className="mobile-brand-name">
            <h1>
              QWERTY <span>Plus</span>
            </h1>
            <small>把专注留给每一个单词</small>
          </div>
          <a
            href={accountHref}
            target="_self"
            onClick={openAccount}
            className="mobile-user-status mobile-account-entry"
            aria-label={auth ? '账号：' + auth.user.username + (expired ? '，登录已过期' : '') : '登录或注册'}
            data-mobile-account-entry
          >
            <CircleUserRound size={24} aria-hidden="true" />
          </a>
        </header>

        <section className="mobile-today" aria-labelledby="mobile-today-title">
          <p className="mobile-eyebrow">TODAY · LEARN</p>
          <h2 id="mobile-today-title">今天，继续积累。</h2>
          <Link to="/mobile/library" className="mobile-today-dictionary mobile-dictionary-link">
            {dictionary.name}
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
          <MobileDailyProgress summary={daily} />
          <p className="mobile-today-summary" data-mobile-checkpoint-status>
            {checkpoint ? '上次学到本轮第 ' + resume + ' / ' + checkpoint.words.length + ' 词' : '从今天的复习和新词开始'}
          </p>
          <Link className="mobile-start-link" to="/mobile/study" aria-label={checkpoint ? '继续手机学习' : '开始手机学习'}>
            {checkpoint ? '继续学习' : '开始手机学习'} <ChevronRight size={19} aria-hidden="true" />
          </Link>
          <p className="mobile-p0-note">轻触学习为主 · 需要时可选择独立拼写</p>
        </section>

        <section className="mobile-home-menu" aria-label="功能菜单">
          <h2>更多功能</h2>
          {menus.map((item) => (
            <Link className="mobile-menu-item" to={item.route} key={item.title}>
              <span className="mobile-menu-icon"><item.icon size={20} aria-hidden="true" /></span>
              <span className="mobile-menu-text"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
              <ChevronRight size={18} aria-hidden="true" className="mobile-menu-chevron" />
            </Link>
          ))}
        </section>
        <footer className="mobile-home-footer">
          {secureLearningEntry(window.location.href) ? '当前仅在本机保存 · 请使用安全站点同步' : '手机端独立界面 · 与桌面共享学习数据'}
        </footer>
      </div>
    </main>
  )
}
