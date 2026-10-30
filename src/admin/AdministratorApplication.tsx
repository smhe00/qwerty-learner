import { Conversation } from '../feedback/FeedbackCenter'
import { FeedbackRejectedError } from '../feedback/client'
import type { Identity } from '../feedback/client'
import type { CloudAuthState } from '../sync/types'
import './administration.css'
import { AdministrationError, administrationEnabled, administrationRequest } from './client'
import { ordinaryLoginPath, rememberAdministratorReturn } from './ordinary-return'
import { forgetAdministratorSession, readAdministratorSession, rememberAdministratorSession } from './session'
import { useEffect, useRef, useState } from 'react'

type Row = {
  id: string
  username: string
  createdAt: string
  testAccount: boolean
  activeDays: string[]
  attempts: number | null
  recentAttempts: number | null
  historyComplete: boolean
  metadataAvailable: boolean
}
type Overview = { rows: Row[]; nextCursor: string | null; asOf: string }
type Visitors = { today: number; last7Days: number }
type Cleanup = {
  executionEnabled: boolean
  results: { userId?: string; username?: string; action: string; expiresAt?: string }[]
  nextCursor: string | null
}
const tabs = ['运营概览', '用户使用', '反馈回复', '系统维护']
const text = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请稍后重试。')
const date = (s: string) => new Date(s).toLocaleString('zh-CN')
const demo: Overview = {
  rows: [
    {
      id: 'demo-1',
      username: '示例学习者',
      createdAt: new Date().toISOString(),
      testAccount: false,
      activeDays: [new Date().toISOString().slice(0, 10)],
      attempts: 24,
      recentAttempts: 24,
      historyComplete: true,
      metadataAvailable: true,
    },
  ],
  nextCursor: null,
  asOf: new Date().toISOString(),
}

export default function AdministratorApplication({ admissionError = '' }: { admissionError?: string }) {
  const [auth, setAuth] = useState<CloudAuthState | null>(() => readAdministratorSession())
  const [verified, setVerified] = useState(false)
  const [preview, setPreview] = useState(false)
  const [checking, setChecking] = useState(!!auth)
  const [tab, setTab] = useState(0)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(admissionError)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [visitors, setVisitors] = useState<Visitors | null>(null)
  const [excludeTests, setExcludeTests] = useState(true)
  const [cleanup, setCleanup] = useState<Cleanup | null>(null)
  const [cleanupCursor, setCleanupCursor] = useState('')
  const [usage, setUsage] = useState<{ accounts: number; objects: number; reportedBytes: number; sizeComplete: boolean } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const fail = (e: unknown) => {
    if (!alive.current) return
    if (e instanceof AdministrationError && [401, 403].includes(e.status)) {
      setVerified(false)
      forgetAdministratorSession()
      setAuth(null)
    }
    setError(text(e))
  }
  useEffect(() => {
    if (!auth || !administrationEnabled) {
      setChecking(false)
      return
    }
    let current = true
    setChecking(true)
    setVerified(false)
    void administrationRequest<{ administrator: boolean }>('/api/admin/access')
      .then((result) => {
        if (!current) return
        if (result.administrator !== true) throw new AdministrationError('当前账号没有管理权限。', 403)
        setVerified(true)
      })
      .catch((e) => {
        if (current) fail(e)
      })
      .finally(() => {
        if (current) setChecking(false)
      })
    return () => {
      current = false
    }
  }, [auth])
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      fail(e)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function load(next = '') {
    if (preview) {
      setOverview(demo)
      return
    }
    if (!next) {
      void administrationRequest<Visitors>('/api/admin/visits')
        .then((result) => {
          if (alive.current && Number.isSafeInteger(result.today) && Number.isSafeInteger(result.last7Days) && result.today >= 0 && result.last7Days >= result.today)
            setVisitors(result)
        })
        .catch(() => { /* Missing statistics must not interrupt administration. */ })
    }
    const result = await administrationRequest<Overview>('/api/admin/overview?cursor=' + encodeURIComponent(next))
    if (alive.current)
      setOverview((old) => ({
        ...result,
        rows: next && old ? [...old.rows.filter((r) => !result.rows.some((n) => n.id === r.id)), ...result.rows] : result.rows,
      }))
  }
  useEffect(() => {
    if (!verified) return
    void run(() => load())
    // One fresh scan per verified session. Page continuations are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified])
  const rows = (overview?.rows || []).filter((r) => !excludeTests || !r.testAccount)
  const known = rows.filter((r) => r.metadataAvailable)
  const today = overview?.asOf.slice(0, 10)
  const metrics = [
    ['已核对普通账号', rows.length, '管理员不计入；可排除测试账号'],
    ['今日云端活跃', known.filter((r) => r.activeDays.includes(today || '')).length, '按 UTC 日认证 / 同步活动计算'],
    ['近 7 天云端活跃', known.filter((r) => r.activeDays.length).length, '去重账号；不等于正在在线人数'],
    ['近 7 天已核对练习', known.reduce((sum, r) => sum + (r.recentAttempts || 0), 0), '按已上云事件去重；不含仅在本机的数据'],
  ] as const
  const feedbackTransport = <T,>(identity: Identity, path: string, body?: unknown) => {
    const session = readAdministratorSession()
    if (!session || !('token' in identity) || session.token !== identity.token || session.user.userId !== identity.owner)
      return Promise.reject(new AdministrationError('管理会话已改变，请重新登录。', 401))
    return administrationRequest<T>('/api/feedback' + path, { body }).catch((e) => {
      fail(e)
      if (e instanceof AdministrationError && e.status >= 400 && e.status < 500 && ![401, 403, 429].includes(e.status))
        throw new FeedbackRejectedError(e.message)
      throw e
    })
  }
  return (
    <div className="admin-console" data-admin-console>
      <header className="admin-header">
        <div>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setTab(0)
            }}
            className="admin-brand"
          >
            QWERTY Plus <span>管理控制台</span>
          </a>
          <p>运营、反馈与维护</p>
        </div>
        {(verified || preview) && (
          <div className="admin-identity">
            <span>{preview ? '界面示例' : '管理员 admin'}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (auth && !preview) rememberAdministratorReturn(auth)
                forgetAdministratorSession()
                window.location.replace(ordinaryLoginPath())
              }}
            >
              普通账号登录
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const token = auth?.token
                  forgetAdministratorSession()
                  setVerified(false)
                  setAuth(null)
                  setPreview(false)
                  setOverview(null)
                  setCleanup(null)
                  setUsage(null)
                  if (token) {
                    // The local session is already gone; a lost revoke response cannot
                    // resurrect the console or change the ordinary learning workspace.
                    try {
                      await administrationRequest('/api/admin/logout', { token, anonymous: true, body: {} })
                    } catch {
                      /* Local exit remains available offline. */
                    }
                  }
                  setNotice('已退出本机管理会话。')
                })
              }
            >
              退出管理
            </button>
          </div>
        )}
      </header>
      {!verified && !preview ? (
        <main className="admin-login">
          <section className="admin-card">
            <p className="admin-eyebrow">ADMINISTRATION</p>
            <h1>登录管理控制台</h1>
            <p>查看使用情况、处理反馈和维护系统。</p>
            {!administrationEnabled && <p className="admin-info">当前是界面预览。不会验证密码、读取真实用户或执行维护。</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  if (!administrationEnabled) {
                    setNotice('预览站不执行管理员认证。可查看管理界面示意。')
                    return
                  }
                  const signed = await administrationRequest<CloudAuthState>('/api/auth/login', {
                    anonymous: true,
                    body: { username: 'admin', password, deviceId: 'qwerty-admin-' + crypto.randomUUID() },
                  })
                  const access = await administrationRequest<{ administrator: boolean }>('/api/admin/access', {
                    token: signed.token,
                    anonymous: true,
                  })
                  if (access.administrator !== true) throw new AdministrationError('当前账号没有管理权限。', 403)
                  rememberAdministratorSession(signed)
                  setPassword('')
                  setAuth(signed)
                })
              }}
            >
              <label>
                管理员账号
                <input aria-label="管理员账号" value="admin" readOnly autoComplete="username" />
              </label>
              <label>
                管理员密码
                <input
                  aria-label="管理员密码"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={4}
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              <button className="admin-primary" disabled={busy || checking} type="submit">
                {checking ? '正在核验权限…' : busy ? '正在登录…' : '进入管理控制台'}
              </button>
            </form>
            {!administrationEnabled && (
              <button
                type="button"
                onClick={() => {
                  setPreview(true)
                  setOverview(demo)
                  setError('')
                }}
              >
                查看管理界面示意
              </button>
            )}
            {error && (
              <p role="alert" className="admin-error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <p className="admin-note">管理会话与学习账号分开。这里不加载学习数据，也不参与学习进度同步。</p>
            <a className="admin-account-link" href={ordinaryLoginPath()}>
              普通账号登录
            </a>
          </section>
        </main>
      ) : (
        <div className="admin-layout">
          <nav className="admin-navigation" aria-label="管理导航">
            <div role="tablist" aria-label="管理功能">
              {tabs.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={tab === i}
                  aria-controls={'admin-tab-' + i}
                  id={'admin-nav-' + i}
                  onClick={() => {
                    setTab(i)
                    setError('')
                    setNotice('')
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p>
              管理会话独立运行
              <br />
              学习同步未启动
            </p>
          </nav>
          <main className="admin-main" role="tabpanel" id={'admin-tab-' + tab} aria-labelledby={'admin-nav-' + tab}>
            {preview && (
              <p className="admin-info" role="status">
                示例数据 · 不是真实使用统计。回复与维护操作不可执行。
              </p>
            )}
            <div className="admin-page-heading">
              <div>
                <p className="admin-eyebrow">WORKSPACE</p>
                <h1>{tabs[tab]}</h1>
              </div>
              {tab < 2 && (
                <button disabled={busy} onClick={() => void run(() => load())}>
                  重新核对
                </button>
              )}
            </div>
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {tab === 0 && (
              <>
                <div className="admin-metrics" data-visitor-counts>
                  {[
                    ['今日访问 ID 数', preview ? 28 : visitors?.today ?? '—'],
                    ['近7日累计 ID 数', preview ? 96 : visitors?.last7Days ?? '—'],
                  ].map(([label, value]) => (
                    <article className="admin-card" key={label}>
                      <h2>{label}</h2>
                      <strong>{value}</strong>
                    </article>
                  ))}
                </div>
                <p className="admin-note">包含未登录访问；每个 ID 每日最多计 1 次，近 7 日按日相加（含今日）。按北京时间统计。</p>
              </>
            )}
            {tab < 2 && (
              <>
                <label className="admin-check">
                  <input type="checkbox" checked={excludeTests} onChange={(e) => setExcludeTests(e.target.checked)} /> 排除测试账号
                </label>
                {busy && <p role="status">正在核对云端使用情况…</p>}
                {overview && (
                  <>
                    <div className="admin-metrics">
                      {metrics.map(([label, value, note]) => (
                        <article className="admin-card" key={label}>
                          <h2>{label}</h2>
                          <strong>{value}</strong>
                          <p>{note}</p>
                        </article>
                      ))}
                    </div>
                    <p className="admin-note">账号与练习核对时间：{date(overview.asOf)}。下列统计按当前已读取的账号与事件计算，列表受云端可见性影响。</p>
                    {(overview.nextCursor || rows.some((r) => !r.historyComplete || !r.metadataAvailable)) && (
                      <p className="admin-info">账号与练习统计尚不完整，当前数字是已核对范围，不能当作全站总量。部分历史或元数据尚未读取。</p>
                    )}
                    {overview.nextCursor && (
                      <button disabled={busy} onClick={() => void run(() => load(overview.nextCursor || ''))}>
                        继续核对下一批账号
                      </button>
                    )}
                    {tab === 1 && (
                      <section className="admin-card">
                        <h2>用户使用明细</h2>
                        {rows.length ? (
                          <div className="admin-users">
                            {rows.map((row) => (
                              <article key={row.id}>
                                <div>
                                  <strong>{row.username}</strong>
                                  {row.testAccount && <span>测试账号</span>}
                                </div>
                                <p>注册：{date(row.createdAt)}</p>
                                <p>
                                  近 7 天云端活跃 {row.metadataAvailable ? row.activeDays.length : '未知'} 天 · 已核对练习{' '}
                                  {row.attempts ?? '未知'} 次{!row.historyComplete && '（历史未完整读取）'}
                                </p>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p>当前批次没有符合筛选条件的普通账号。</p>
                        )}
                      </section>
                    )}
                  </>
                )}
                <section className="admin-card">
                  <h2>云端账号与练习口径</h2>
                  <p>
                    云端活跃来自认证 / 同步活动，按 UTC 日去重。学习量来自已提交的 V2
                    学习事件，按练习标识去重；历史全量备份内的旧记录、未登录和离线尚未上传的学习不在这里计数。
                  </p>
                  <p>目前没有统计匿名访客或“此刻在线”人数，不能用注册数替代真实学习活跃。</p>
                </section>
              </>
            )}
            {tab === 2 && (
              <section className="admin-card admin-feedback feedback-dialog">
                <h2>反馈收件箱</h2>
                <p>查看全部反馈，回复用户并更新处理状态。</p>
                {preview ? (
                  <p>示例界面：真实反馈需在云端站点以管理员身份登录后读取。</p>
                ) : (
                  auth && (
                    <Conversation
                      key={auth.token}
                      identity={{ token: auth.token, owner: auth.user.userId }}
                      request={feedbackTransport}
                      initialAll
                    />
                  )
                )}
              </section>
            )}
            {tab === 3 && (
              <>
                <section className="admin-card">
                  <h2>云端存储</h2>
                  <p>只读核对存储对象和平台报告容量。</p>
                  <button
                    disabled={busy || preview}
                    onClick={() => void run(async () => setUsage(await administrationRequest('/api/admin/storage')))}
                  >
                    读取存储用量
                  </button>
                  {usage && (
                    <p>
                      {usage.accounts} 个账号 · {usage.objects} 个对象 ·{' '}
                      {usage.sizeComplete ? (usage.reportedBytes / 1048576).toFixed(2) + ' MiB' : '容量未知（平台未提供完整大小）'}
                    </p>
                  )}
                </section>
                <section className="admin-card">
                  <h2>闲置账号维护</h2>
                  <p>先预览本页到期账号，再确认执行。服务端会重新核验管理员身份和到期状态。</p>
                  <button
                    disabled={busy || preview}
                    onClick={() =>
                      void run(async () => {
                        const result = await administrationRequest<Cleanup>('/api/admin/idle')
                        setCleanupCursor('')
                        setCleanup(result)
                      })
                    }
                  >
                    预览清理名单
                  </button>
                  {cleanup && (
                    <>
                      <p>{cleanup.executionEnabled ? '维护执行已启用。' : '当前仅可预览，正式删除未启用。'}</p>
                      <div className="admin-users">
                        {cleanup.results.map((r, i) => (
                          <article key={r.userId || i}>
                            <strong>{r.username || '检查未确认'}</strong>
                            <p>
                              {(
                                {
                                  protected: '管理员保护',
                                  retain: '保留',
                                  candidate: '到期候选',
                                  error: '检查失败',
                                  deleted: '已删除',
                                  circle_hold: '圈子数据保留',
                                  draining: '等待请求结束',
                                  deleting: '正在分批清理',
                                } as Record<string, string>
                              )[r.action] || r.action}
                              {r.expiresAt && ' · 到期 ' + date(r.expiresAt)}
                            </p>
                          </article>
                        ))}
                      </div>
                      {cleanup.nextCursor !== null && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const cursor = cleanup.nextCursor || ''
                              const result = await administrationRequest<Cleanup>('/api/admin/idle?cursor=' + encodeURIComponent(cursor))
                              setCleanupCursor(cursor)
                              setCleanup(result)
                            })
                          }
                        >
                          预览下一页
                        </button>
                      )}
                      <button
                        className="admin-danger"
                        disabled={busy || preview || !cleanup.executionEnabled}
                        onClick={() => {
                          if (!window.confirm('确认对已预览的本页到期账号执行清理？账号和云端数据会被永久删除，本机记录保留。')) return
                          void run(async () => {
                            setCleanup(await administrationRequest('/api/admin/idle', { body: { dryRun: false, cursor: cleanupCursor } }))
                            setNotice('维护请求已完成，请逐项核对结果；失败或等待不代表已删除。')
                          })
                        }}
                      >
                        确认清理本页到期账号
                      </button>
                    </>
                  )}
                </section>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
