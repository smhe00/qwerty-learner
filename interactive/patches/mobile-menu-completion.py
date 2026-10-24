"""Idempotent, exact-context integration of the mobile presentation changes.

Runs ONLY in the isolated feature-branch builder. The resulting real source
changes are committed to that branch; no runtime patching, DB/Cloud writes,
force push, or changes to master/etest are permitted.
"""
from pathlib import Path


def patch(path, old, new):
    file = Path(path)
    source = file.read_text()
    if old not in source:
        if new in source:
            return
        raise RuntimeError('Integration anchor changed: ' + path)
    if source.count(old) != 1:
        raise RuntimeError('Ambiguous integration anchor: ' + path)
    file.write_text(source.replace(old, new, 1))


home = 'src/pages/Mobile/index.tsx'
patch(home, '/** Mobile P0 is a separate menu-first app shell; not a scaled desktop Header.\n * Nonfunctional P2 entries are deliberately disabled rather than fake links.\n */', '/** Dedicated menu-first mobile shell. Every displayed entry has a real route. */')
patch(home, "{ title: '成就', subtitle: '移动端成就即将开放', icon: Medal },", "{ title: '成就', subtitle: '成就雅集 · 查看解锁与收藏', icon: Medal, route: '/mobile/achievements' },")
patch(home, "{ title: '学习记录', subtitle: '移动端统计即将开放', icon: LayoutGrid },", "{ title: '学习记录', subtitle: '按日期与词库查看已保存的练习', icon: LayoutGrid, route: '/mobile/history' },")
patch(home, '      href: accountHref,', "      route: '/mobile/data',")
file = Path(home)
s = file.read_text()
start = s.find('          {menus.map((item) =>\n')
end = s.find('\n        </section>', start)
if start >= 0 and end > start:
    s = s[:start] + '''          {menus.map((item) => (
            <Link className="mobile-menu-item" to={item.route} key={item.title}>
              <span className="mobile-menu-icon"><item.icon size={20} aria-hidden="true" /></span>
              <span className="mobile-menu-text"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
              <ChevronRight size={18} aria-hidden="true" className="mobile-menu-chevron" />
            </Link>
          ))}''' + s[end:]
    file.write_text(s)
elif 'to={item.route} key={item.title}' not in s or 'mobile-menu-unavailable' in s:
    raise RuntimeError('Mobile menu map changed')

app = 'src/app.tsx'
patch(app, "const AchievementsPage = lazy(() => loadRouteWithRefresh('achievements', loadAchievementsPage))", "const AchievementsPage = lazy(() => loadRouteWithRefresh('achievements', loadAchievementsPage))\nconst MobileHistory = lazy(() => loadRouteWithRefresh('mobile-history', () => import('./pages/Mobile/MobileHistory')))\nconst MobileData = lazy(() => loadRouteWithRefresh('mobile-data', () => import('./pages/Mobile/MobileData')))")
patch(app, 'aria-label="返回移动端说明"', 'aria-label="返回手机首页"')
patch(app, "  if (location.pathname === '/mobile/settings') return <MobileSettings />", "  if (location.pathname === '/mobile/settings') return <MobileSettings />\n  const mobilePath = location.pathname.replace(/\\/$/, '')\n  if (mobilePath === '/mobile/history') return <MobileHistory />\n  if (mobilePath === '/mobile/data') return <MobileData />\n  if (mobilePath === '/mobile/achievements') return <MobileAchievementsRoute />")

practice = 'src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx'
patch(practice, "import MobilePracticeExample from './MobilePracticeExample'", "import MobilePracticeExample from './MobilePracticeExample'\nimport MobilePhonetic from '@/pages/Mobile/MobilePhonetic'")
patch(practice, '''              {(word.ukphone || word.usphone) && (
                <p className="mobile-practice-phonetic">{word.ukphone ? '/' + word.ukphone + '/' : '/' + word.usphone + '/'}</p>
              )}''', '''              <MobilePhonetic word={word} voice={pronunciation.type} />''')

settings = 'src/pages/Mobile/MobileSettings.tsx'
patch(settings, "import MobilePageFrame from './MobilePageFrame'", "import MobilePageFrame from './MobilePageFrame'\nimport './mobile-completion.css'\nimport { Link } from 'react-router-dom'")
patch(settings, '    </MobilePageFrame>', '''      <section className="mobile-settings-card">
        <h2>记录与备份</h2>
        <p>查看学习历史，或核对同步状态、导出和校验备份。</p>
        <div className="mobile-data-actions">
          <Link className="mobile-secondary-action" to="/mobile/history" onClick={event => { if (dirty && !window.confirm('设置尚未保存，仍要离开吗？')) event.preventDefault() }}>查看学习记录</Link>
          <Link className="mobile-secondary-action" to="/mobile/data" onClick={event => { if (dirty && !window.confirm('设置尚未保存，仍要离开吗？')) event.preventDefault() }}>同步与备份</Link>
        </div>
      </section>
    </MobilePageFrame>''')

cloud = 'src/sync/CloudSyncSetting.tsx'
patch(cloud, 'export default function CloudSyncSetting() {', '''export default function CloudSyncSetting({
  navigateToTool = (path: string) => window.location.assign(path),
  disabled = false,
}: { navigateToTool?: (path: string) => void; disabled?: boolean } = {}) {''')
patch(cloud, "  const enabled = REACT_APP_DEPLOY_ENV !== 'pages' &&", "  const enabled = !disabled && import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true' && REACT_APP_DEPLOY_ENV !== 'pages' &&")
patch(cloud, '    if (!loggedIn || !auth || expired || checking) return', '    if (disabled || !loggedIn || !auth || expired || checking) return')
patch(cloud, 'disabled={checking || expired}', "disabled={disabled || checking || expired || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true'}")
for path in ['/?s1-migration=confirm', '/?s2-sync=run', '/?v4-cloud-backup=download', '/?s2-recovery=manage', '/?perf-report=view']:
    patch(cloud, "window.location.assign('" + path + "')", "navigateToTool('" + path + "')")
patch(cloud, '<button type="button" className="my-btn-primary"\n            onClick={() => navigateToTool', '<button type="button" className="my-btn-primary" disabled={disabled}\n            onClick={() => navigateToTool')
patch(cloud, '<button type="button" className="text-xs underline"\n        onClick={() => navigateToTool', '<button type="button" className="text-xs underline" disabled={disabled}\n        onClick={() => navigateToTool')
patch(cloud, '登录、注册及安全退出已统一移动到网站右上角的账户入口。', '登录、注册及安全退出请使用账号入口。')
patch(cloud, '当前为匿名本地工作区。需要云同步时，请点击右上角「登录 / 注册」。', '当前为匿名本地工作区。需要云同步时，请通过账号入口登录或注册。')
patch(cloud, '              {remote && <p>云端：', '              {!remote && <p>尚未检查云端状态；这不代表数据已经同步。</p>}\n              {remote && <p>云端：')
patch(cloud, '请先保存两端备份，再选择保留哪一份。', '请先保存备份，再在安全恢复页核对；本页不会直接覆盖任何一端。')

routes = 'scripts/emit-edgeone-spa-entries.mjs'
patch(routes, "    'mobile/study', 'mobile/account', 'mobile/library', 'mobile/settings',", "    'mobile/study', 'mobile/account', 'mobile/library', 'mobile/settings',\n    'mobile/history', 'mobile/data', 'mobile/achievements',")

tests = 'tests/e2e/mobile-p0.spec.ts'
patch(tests, "await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(2)", "await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(0)\n  await expect(menu.getByRole('link', { name: /^成就/ })).toHaveAttribute('href', '/mobile/achievements')\n  await expect(menu.getByRole('link', { name: /^学习记录/ })).toHaveAttribute('href', '/mobile/history')")
patch(tests, "await expect(menu.getByRole('link', { name: /账号与云同步/ })).toHaveAttribute('href', '/mobile/account')", "await expect(menu.getByRole('link', { name: /账号与云同步/ })).toHaveAttribute('href', '/mobile/data')")
config = 'tests/e2e/mobile-p0.config.ts'
patch(config, "'mobile-ergonomics.spec.ts']", "'mobile-ergonomics.spec.ts', 'mobile-menu-completion.spec.ts']")
print('Exact-context mobile integration complete; record/sync protocols unchanged.')
