import {
  FeedbackRejectedError,
  currentAccount,
  feedbackEnabled,
  feedbackRequest,
  randomKey,
  readPending,
  savePending,
  selectGuest,
  statusText,
} from './client'
import type { Identity, Item, Pending, Status, Thread } from './client'
import './feedback.css'
import { finishFeedbackRecovery, pendingFeedbackRecovery } from './recovery-link'
import { Dialog } from '@headlessui/react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const date = (at: number) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const errorText = (error: unknown) => (error instanceof Error ? error.message : '暂时无法完成，请稍后重试。')

function Conversation({ identity }: { identity: Identity }) {
  const [items, setItems] = useState<Item[]>([])
  const [cursor, setCursor] = useState('')
  const [administrator, setAdministrator] = useState(false)
  const [all, setAll] = useState(false)
  const [thread, setThread] = useState<Thread | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('handling')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [privateLink, setPrivateLink] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (error) {
      if (alive.current) setError(errorText(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function listing(next = '', scope = all) {
    const result = await feedbackRequest<{ items: Item[]; cursor: string; administrator: boolean }>(
      identity,
      '?scope=' + (scope ? 'all' : 'mine') + '&cursor=' + encodeURIComponent(next),
    )
    if (!alive.current) return
    setItems((old) => (next ? [...old, ...result.items.filter((x) => !old.some((y) => y.id === x.id))] : result.items))
    setCursor(result.cursor)
    setAdministrator(result.administrator)
  }
  async function detail(item: Item) {
    const result = await feedbackRequest<Thread>(identity, '/' + item.owner + '/' + item.id)
    if (!alive.current) return
    setThread(result)
    setStatus(result.status === 'waiting' ? 'handling' : result.status)
    setCreating(false)
    setText('')
  }
  useEffect(() => {
    void run(async () => {
      setPending(readPending(identity))
      await listing()
    })
    // Identity changes remount this component and discard old requests/results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function send(operation: Pending) {
    savePending(identity, operation)
    setPending(operation)
    let result: Item
    try {
      result = await feedbackRequest<Item>(identity, operation.path, operation.body)
    } catch (error) {
      if (alive.current && error instanceof FeedbackRejectedError) {
        savePending(identity, null)
        setPending(null)
        setText(operation.body.text)
        if (!operation.path) {
          setCreating(true)
          setTitle(operation.body.title || '')
        }
      }
      throw error
    }
    if (!alive.current) return
    if (
      !result ||
      !/^[a-f0-9]{64}$/.test(result.id || '') ||
      (!operation.path && !/^(a-[a-f0-9]{32}|g-[a-f0-9]{64})$/.test(result.owner || ''))
    ) {
      throw new Error('发送结果尚未确认。内容已保留，请重试发送。')
    }
    savePending(identity, null)
    setPending(null)
    setText('')
    setTitle('')
    const target = operation.path
      ? (() => {
          const [, owner, id] = operation.path.split('/')
          return { owner, id } as Item
        })()
      : result
    await detail(target)
    setNotice('已发送')
  }
  const frozen = busy || !!pending
  return (
    <>
      <div className="feedback-toolbar">
        {creating || thread ? (
          <button
            className="feedback-text-button"
            aria-label="返回反馈列表"
            disabled={frozen}
            onClick={() => {
              if (creating) setCreating(false)
              else
                void run(async () => {
                  await listing()
                  setThread(null)
                  setText('')
                })
            }}
          >
            ‹ 返回
          </button>
        ) : (
          <h3>{all ? '全部反馈' : '我的反馈'}</h3>
        )}
        <div className="feedback-actions">
          {!creating && (
            <button
              className="feedback-text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (thread) await detail(thread)
                  else await listing()
                })
              }
            >
              刷新
            </button>
          )}
          {!thread && !creating && (
            <button
              className="feedback-primary"
              disabled={frozen}
              onClick={() => {
                setCreating(true)
                setPrivateLink('')
                setText('')
                setTitle('')
              }}
            >
              写反馈
            </button>
          )}
        </div>
      </div>
      {administrator && !thread && !creating && (
        <button
          className="feedback-text-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await listing('', !all)
              setAll(!all)
            })
          }
        >
          {all ? '我的反馈' : '管理全部反馈'}
        </button>
      )}
      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="feedback-info">
          <p>有一条尚未确认的发送，原内容已保留。</p>
          <p className="feedback-text">
            {pending.body.title}
            {pending.body.title ? '：' : ''}
            {pending.body.text}
          </p>
          <button disabled={busy} onClick={() => void run(() => send(pending))}>
            重试发送
          </button>
        </div>
      )}
      {busy && <p role="status">正在处理…</p>}
      {thread ? (
        <>
          <div className="feedback-thread">
            <h3>{thread.title}</h3>
            <p className="feedback-meta">
              {date(thread.createdAt)} · {statusText[thread.status]}
            </p>
            <article className="feedback-message">
              <strong>反馈内容</strong>
              <p className="feedback-text">{thread.text}</p>
            </article>
            {thread.messages.map((message) => (
              <article className={'feedback-message ' + (message.role === 'admin' ? 'feedback-admin' : '')} key={message.id}>
                <div className="feedback-meta">
                  {message.role === 'admin' ? '管理员' : '反馈人'} · {date(message.createdAt)} · {statusText[message.status]}
                </div>
                {message.text && <p className="feedback-text">{message.text}</p>}
              </article>
            ))}
          </div>
        </>
      ) : (
        !creating && (
          <section aria-label={all ? '全部反馈' : '我的反馈'}>
            {!busy && items.length === 0 && !error && (
              <p className="feedback-empty feedback-meta">还没有反馈，欢迎告诉我们哪里可以改进。</p>
            )}
            {items.map((item) => (
              <button className="feedback-list-item" disabled={frozen} key={item.id} onClick={() => void run(() => detail(item))}>
                <strong>{item.title}</strong>
                <span className="feedback-meta">{date(item.createdAt)} · 查看回复 ›</span>
              </button>
            ))}
            {cursor && (
              <button disabled={busy} onClick={() => void run(() => listing(cursor))}>
                加载更多
              </button>
            )}
          </section>
        )
      )}
      {(creating || thread) && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (frozen) return
            const operation: Pending = {
              path: thread ? '/' + thread.owner + '/' + thread.id + '/messages' : '',
              body: {
                operationId: randomKey(16),
                text,
                ...(thread ? (administrator ? { status } : {}) : { title }),
              },
            }
            void run(() => send(operation))
          }}
        >
          {creating && (
            <>
              <label>
                标题
                <input
                  maxLength={80}
                  required
                  value={title}
                  disabled={frozen}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="简单描述你的建议或问题"
                />
              </label>
            </>
          )}
          <label>
            {thread ? '继续交流' : '具体内容'}
            <textarea
              aria-label={thread ? '继续交流' : '具体内容'}
              maxLength={2000}
              required={!thread || !administrator}
              rows={4}
              disabled={frozen}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="请勿填写密码等敏感信息"
            />
          </label>
          {administrator && thread && (
            <label>
              处理状态
              <select aria-label="处理状态" disabled={frozen} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {Object.entries(statusText).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="feedback-form-footer">
            <span className="feedback-meta">{text.length}/2000</span>
            <button
              className="feedback-primary"
              disabled={frozen || (creating && (!text.trim() || !title.trim())) || (!!thread && !administrator && !text.trim())}
              type="submit"
            >
              {creating ? '提交反馈' : '发送'}
            </button>
          </div>
        </form>
      )}
      {'secret' in identity && !creating && (
        <footer className="feedback-recovery">
          <button
            className="feedback-text-button"
            aria-expanded={!!privateLink}
            disabled={busy}
            onClick={() => {
              const url = new URL(window.location.href)
              url.hash = 'feedback=' + identity.secret
              setPrivateLink(privateLink ? '' : url.toString())
            }}
          >
            保存私密链接
          </button>
          {privateLink && (
            <div className="feedback-info">
              <label>
                匿名反馈私密链接
                <input aria-label="匿名反馈私密链接" readOnly value={privateLink} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <p>保存后可在未登录时查看和回复匿名反馈。请勿转发；清除浏览器数据且未保存链接将无法找回。</p>
              <button
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(privateLink)
                    setNotice('链接已复制')
                  })
                }
              >
                复制链接
              </button>
            </div>
          )}
        </footer>
      )}
    </>
  )
}

export default function FeedbackCenter() {
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [error, setError] = useState('')
  const [session, setSession] = useState(0)
  useEffect(() => {
    function show(secret?: string) {
      setOpen(true)
      setError('')
      setSession((x) => x + 1)
      if (!feedbackEnabled) return
      try {
        const auth = currentAccount()
        // A recovery link preserves the guest key, but never overrides a signed-in account.
        if (secret && auth) selectGuest(secret)
        setIdentity(auth || { secret: selectGuest(secret) })
        return true
      } catch {
        setIdentity(null)
        setError('无法保存反馈入口，请允许此网站保存浏览器数据后重试。')
      }
    }
    const handler = () => show()
    window.addEventListener('qwerty:feedback-open', handler)
    const secret = /^#feedback=([a-f0-9]{64})$/.exec(location.hash)?.[1] || pendingFeedbackRecovery()
    if (secret) {
      if (show(secret)) {
        finishFeedbackRecovery()
        if (location.hash) navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true })
      }
    }
    return () => window.removeEventListener('qwerty:feedback-open', handler)
  }, [navigate, location.hash, location.pathname, location.search])
  return (
    <Dialog open={open} onClose={() => setOpen(false)} className="feedback-dialog">
      <div className="feedback-backdrop" aria-hidden="true" />
      <div className="feedback-position">
        <Dialog.Panel className="feedback-panel">
          <header className="feedback-heading">
            <div>
              <Dialog.Title>反馈与建议</Dialog.Title>
              <Dialog.Description>仅你和管理员可见。回复请回到这里查看。</Dialog.Description>
            </div>
            <button aria-label="关闭反馈" onClick={() => setOpen(false)}>
              关闭
            </button>
          </header>
          <div className="feedback-body">
            {!feedbackEnabled ? (
              <p>预览站不提供在线反馈，请在正式站使用此功能。</p>
            ) : (
              <>
                {error && <p role="alert">{error}</p>}
                {identity && <Conversation key={session} identity={identity} />}
              </>
            )}
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
