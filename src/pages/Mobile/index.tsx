import logo from '@/assets/logo.svg'
import { loadAuth } from '@/sync/auth'
import { currentDictInfoAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { BookOpen, ChevronRight, CircleUserRound, Cloud, LayoutGrid, Medal, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMobileCheckpoint } from './useMobileCheckpoint'
import './mobile-app.css'

/** Mobile P0 is a separate menu-first app shell; not a scaled desktop Header.
 * Nonfunctional P2 entries are deliberately disabled rather than fake links.
 */
export default function MobilePage() {
  const { checkpoint } = useMobileCheckpoint()
  const dictionary = useAtomValue(currentDictInfoAtom)
  const auth = loadAuth({ preserveExpired: true })
  const menus = [
    { title: '词库', subtitle: '移动端选择即将开放', icon: BookOpen },
    { title: '学习记录', subtitle: '移动端统计即将开放', icon: LayoutGrid },
    { title: '账号与云同步', subtitle: auth ? '已登录 · ' + auth.user.username : '未登录 · 即将开放', icon: Cloud },
    { title: '设置', subtitle: '移动端设置即将开放', icon: Settings2 },
  ]
  const resume = checkpoint ? Math.min(checkpoint.index + 1, checkpoint.words.length) : null

  return <main data-mobile-menu className="mobile-app mobile-home">
    <div className="mobile-home-inner">
      <header className="mobile-brand">
        <img src={logo} width={40} height={40} alt="" aria-hidden="true" />
        <div className="mobile-brand-name">
          <h1>QWERTY <span>Plus</span></h1>
          <small>把专注留给每一个单词</small>
        </div>
        <CircleUserRound size={22} aria-label={auth ? '账号已登录' : '尚未登录'} className="mobile-user-status" />
      </header>

      <section className="mobile-today" aria-labelledby="mobile-today-title">
        <p className="mobile-eyebrow">TODAY · LEARN</p>
        <h2 id="mobile-today-title">继续积累，一词一词来。</h2>
        <p className="mobile-today-dictionary">{dictionary.name}</p>
        <p className="mobile-today-summary" data-mobile-checkpoint-status>
          {checkpoint ? '可恢复的学习位置 · 第 ' + resume + ' / ' + checkpoint.words.length + ' 词'
            : '当前没有可恢复的 Learn 会话'}
        </p>
        <Link className="mobile-start-link" to="/mobile/study" aria-label="进入沉浸学习页面">
          {checkpoint ? '查看学习位置' : '预览学习页面'} <ChevronRight size={19} aria-hidden="true"/>
        </Link>
        <p className="mobile-p0-note">Mobile P0 · 学习界面预览，暂不提交拼写成绩</p>
      </section>

      <section className="mobile-home-menu" aria-label="功能菜单">
        <h2>更多功能</h2>
        <Link className="mobile-menu-item" to="/achievements">
          <span className="mobile-menu-icon"><Medal size={20} aria-hidden="true"/></span>
          <span className="mobile-menu-text"><strong>成就</strong><small>查看已获得的学习成就</small></span>
          <ChevronRight size={18} className="mobile-menu-chevron" aria-hidden="true" />
        </Link>
        {menus.map(item => <div className="mobile-menu-item mobile-menu-unavailable" key={item.title}
          aria-label={item.title + '，后续版本开放'}>
          <span className="mobile-menu-icon"><item.icon size={20} aria-hidden="true"/></span>
          <span className="mobile-menu-text"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
          <span className="mobile-soon">即将开放</span>
        </div>)}
      </section>
      <footer className="mobile-home-footer">手机端独立界面 · 与桌面共享学习数据</footer>
    </div>
  </main>
}
