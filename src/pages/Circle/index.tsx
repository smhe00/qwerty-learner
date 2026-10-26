import './circle.css'
import {
  CircleError,
  circleDays,
  circleErrorText,
  circleRequest,
  circleUnavailable,
  isLegacyCircleInvite,
  memberLabel,
  normalizeCircleNickname,
  normalizeCirclePassphrase,
  readCircleHints,
  saveCircleHints,
} from '@/circle/client'
import type { CircleDay, CircleItem, CircleView, CreateDraft } from '@/circle/client'
import { useCircleAuth } from '@/circle/useCircleAuth'
import MobilePageFrame from '@/pages/Mobile/MobilePageFrame'
import { openAccountManagement } from '@/sync/account-navigation'
import type { CloudAuthState } from '@/sync/types'
import { ArrowLeft, Check, Copy, KeyRound, Plus, RefreshCw, ThumbsUp, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

export default function CirclePage({ mobile = false, embedded = false }: { mobile?: boolean; embedded?: boolean }) {
  const auth = useCircleAuth()
  const unavailable = circleUnavailable()
  const content = (
    <div className="circle-ui" data-circle-page>
      <header className="circle-intro">
        {!mobile && !embedded && (
          <Link to="/learn" className="circle-back">
            <ArrowLeft size={17} /> 返回学习
          </Link>
        )}
        <h2>和同学一起坚持</h2>
        <p>分享打卡，给同学一个赞。只保留最近 7 天。</p>
      </header>
      {unavailable || !auth ? (
        <section className="circle-card circle-empty">
          <Users size={36} aria-hidden="true" />
          <h3>{unavailable ? '圈子暂不可用' : '登录后，和同学一起学习'}</h3>
          <p>{unavailable || '创建自己的小圈子，或用朋友分享的口令加入。'}</p>
          {!unavailable && (
            <button type="button" className="circle-primary" onClick={() => openAccountManagement(mobile)}>
              去登录
            </button>
          )}
        </section>
      ) : (
        <CircleContent key={auth.user.userId + ':' + auth.token} auth={auth} mobile={mobile} />
      )}
    </div>
  )
  return mobile ? (
    <MobilePageFrame title="圈子">{content}</MobilePageFrame>
  ) : embedded ? (
    content
  ) : (
    <main className="circle-standalone">{content}</main>
  )
}

function CircleContent({ auth, mobile }: { auth: CloudAuthState; mobile: boolean }) {
  const [items, setItems] = useState<CircleItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState('')
  const [day, setDay] = useState(() => circleDays()[0])
  const [view, setView] = useState<CircleView | null>(null)
  const [daily, setDaily] = useState<CircleDay | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [listRefresh, setListRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const alive = useRef(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)
  const [form, setForm] = useState<'create' | 'join' | null>(() => (readCircleHints(auth.user.userId).pending ? 'create' : null))
  const [pending, setPending] = useState<CreateDraft | undefined>(() => readCircleHints(auth.user.userId).pending)
  const [name, setName] = useState(() => readCircleHints(auth.user.userId).pending?.name || '')
  const [passphrase, setPassphrase] = useState(() => readCircleHints(auth.user.userId).pending?.passphrase || '')
  const [nickname, setNickname] = useState(() => readCircleHints(auth.user.userId).pending?.nickname || '')
  const [joinNickname, setJoinNickname] = useState('')
  const [replacement, setReplacement] = useState('')
  const [invite, setInvite] = useState('')
  const [newWords, setNewWords] = useState('')
  const [sentLikes, setSentLikes] = useState<Set<string>>(new Set())
  const [sentCheckins, setSentCheckins] = useState<Set<string>>(new Set())
  const days = circleDays()
  const owner = view?.meta.ownerUserId === auth.user.userId
  const hints = readCircleHints(auth.user.userId)
  const localCode =
    selected && (hints.inviteRevisions?.[selected] || 'legacy') === (view?.meta.inviteRevision || 'legacy')
      ? hints.invites[selected]
      : undefined
  const code = owner && view?.ownerInviteCode ? view.ownerInviteCode : localCode
  const inviteInput = useRef<HTMLInputElement>(null)
  const disabled = busy || needsLogin || loading

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  function showError(reason: unknown) {
    if (!alive.current) return
    setError(circleErrorText(reason))
    if (reason instanceof CircleError && reason.status === 401) setNeedsLogin(true)
  }

  useEffect(() => {
    if (needsLogin) return
    const controller = new AbortController()
    circleRequest<{ circles: CircleItem[] }>(auth, '/mine', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        if (!Array.isArray(result.circles)) throw new CircleError('read_failed')
        setItems(result.circles)
        setLoaded(true)
        setSelected((current) => (result.circles.some((c) => c.circleId === current) ? current : result.circles[0]?.circleId || ''))
      })
      .catch((reason) => {
        if (!controller.signal.aborted) showError(reason)
      })
    return () => controller.abort()
  }, [auth, listRefresh, needsLogin])

  useEffect(() => {
    setView((current) => (current?.circleId === selected && current.day === day ? current : null))
    setDaily((current) => (current?.circleId === selected && current.day === day ? current : null))
    if (!selected || needsLogin) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    circleRequest<CircleView>(auth, '/' + selected + (day === circleDays()[0] ? '' : '/days/' + day), { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return
        if (
          next.schemaVersion !== 3 ||
          next.circleId !== selected ||
          next.day !== day ||
          !Array.isArray(next.members) ||
          !Array.isArray(next.progress) ||
          !Array.isArray(next.reactionCounts)
        )
          throw new CircleError('read_failed')
        setView(next)
        setDaily(next)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setView(null)
          setDaily(null)
          showError(reason)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [auth, selected, day, refresh, needsLogin])

  async function mutate(action: () => Promise<string>, membershipChanged = false) {
    if (locked.current || needsLogin) return
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const message = await action()
      if (!alive.current) return
      setNotice(message)
      if (membershipChanged) setListRefresh((n) => n + 1)
      setRefresh((n) => n + 1)
    } catch (reason) {
      showError(reason)
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  function refreshAll() {
    if (disabled) return
    setError('')
    if (!circleDays().includes(day)) setDay(circleDays()[0])
    setListRefresh((n) => n + 1)
    setRefresh((n) => n + 1)
  }
  async function create() {
    const normalized =
      pending?.passphrase === undefined && pending ? undefined : normalizeCirclePassphrase(pending?.passphrase ?? passphrase)
    if (normalized === null) throw new CircleError('invalid_circle_passphrase')
    const normalizedNickname = normalizeCircleNickname(nickname)
    if (!pending && normalizedNickname === null) throw new CircleError('invalid_circle_nickname')
    const draft = pending || {
      name: name.trim().normalize('NFKC'),
      operationId: crypto.randomUUID(),
      passphrase: normalized,
      nickname: normalizedNickname || '',
    }
    if (
      !draft.name ||
      Array.from(draft.name).length > 32 ||
      Array.from(draft.name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    ) {
      throw new CircleError('invalid_circle_input')
    }
    // Persist exact retry inputs before dispatch. No new UUID on an ambiguous retry.
    saveCircleHints(auth.user.userId, { ...readCircleHints(auth.user.userId), pending: draft })
    setPending(draft)
    let result: { circleId: string; inviteCode?: string; inviteRevision?: string; inviteChanged?: boolean }
    try {
      result = await circleRequest(auth, '', { method: 'POST', body: draft })
    } catch (reason) {
      if (
        reason instanceof CircleError &&
        ['circle_passphrase_taken', 'invalid_circle_passphrase', 'invalid_circle_nickname'].includes(reason.code)
      ) {
        // These responses precede creation writes; editing the rejected phrase is safe.
        const saved = readCircleHints(auth.user.userId)
        delete saved.pending
        saveCircleHints(auth.user.userId, saved)
        if (alive.current) setPending(undefined)
      }
      throw reason
    }
    if (
      !/^[a-f0-9]{24}$/.test(result.circleId) ||
      (!result.inviteChanged &&
        (draft.passphrase === undefined ? !isLegacyCircleInvite(result.inviteCode) : result.inviteCode !== draft.passphrase))
    ) {
      throw new CircleError('write_unknown')
    }
    const saved = readCircleHints(auth.user.userId)
    delete saved.pending
    if (result.inviteCode) {
      saved.invites[result.circleId] = result.inviteCode
      saved.inviteRevisions = { ...saved.inviteRevisions, [result.circleId]: result.inviteRevision || 'legacy' }
    }
    saveCircleHints(auth.user.userId, saved)
    if (alive.current) {
      setPending(undefined)
      setForm(null)
      setName('')
      setPassphrase('')
      setNickname('')
      setSelected(result.circleId)
      setDay(circleDays()[0])
    }
    return '圈子已创建。展开“邀请同学”即可复制口令。'
  }
  async function join() {
    const raw = invite.trim()
    if (isLegacyCircleInvite(raw) && raw.startsWith('QC2-')) throw new CircleError('legacy_invite')
    const code = isLegacyCircleInvite(raw) ? raw : normalizeCirclePassphrase(raw)
    if (!code) throw new CircleError('invalid_circle_passphrase')
    const normalizedNickname = normalizeCircleNickname(joinNickname)
    if (normalizedNickname === null) throw new CircleError('invalid_circle_nickname')
    const result = await circleRequest<{ circleId: string; inviteRevision?: string }>(auth, '/join', {
      method: 'POST',
      body: { inviteCode: code, nickname: normalizedNickname },
    })
    if (!/^[a-f0-9]{24}$/.test(result.circleId) || (isLegacyCircleInvite(code) && result.circleId !== code.slice(4, 28)))
      throw new CircleError('write_unknown')
    try {
      const hints = readCircleHints(auth.user.userId)
      saveCircleHints(auth.user.userId, {
        ...hints,
        invites: { ...hints.invites, [result.circleId]: code },
        inviteRevisions: { ...hints.inviteRevisions, [result.circleId]: result.inviteRevision || 'legacy' },
      })
    } catch {
      /* The membership is confirmed; invitation storage is optional on join. */
    }
    if (alive.current) {
      setForm(null)
      setInvite('')
      setJoinNickname('')
      setSelected(result.circleId)
      setDay(circleDays()[0])
    }
    return '已加入圈子，欢迎一起坚持。'
  }
  async function changePassphrase() {
    const text = normalizeCirclePassphrase(replacement)
    if (!text) throw new CircleError('invalid_circle_passphrase')
    const result = await circleRequest<{ circleId: string; inviteCode: string; inviteRevision: string }>(auth, '/' + selected + '/invite', {
      method: 'POST',
      body: { passphrase: text },
    })
    if (result.circleId !== selected || result.inviteCode !== text) throw new CircleError('write_unknown')
    const saved = readCircleHints(auth.user.userId)
    saveCircleHints(auth.user.userId, {
      ...saved,
      invites: { ...saved.invites, [selected]: text },
      inviteRevisions: { ...saved.inviteRevisions, [selected]: result.inviteRevision },
    })
    if (alive.current) setReplacement('')
    return '口令已更新。旧口令无法再加入，现有成员不受影响。'
  }
  async function checkIn() {
    const count = newWords.trim() ? Number(newWords) : 0
    if (!Number.isInteger(count) || count < 0 || count > 256) throw new CircleError('invalid_progress')
    if (day !== circleDays()[0]) throw new CircleError('circle_day_expired')
    await circleRequest(auth, '/' + selected + '/progress/' + day, {
      method: 'POST',
      body: { eventId: crypto.randomUUID(), completed: true, newWords: count },
    })
    if (alive.current) setSentCheckins((old) => new Set([...Array.from(old), selected + '/' + day]))
    return '打卡已送出，稍后会显示。学习记录不会因此改变。'
  }
  async function like(target: string) {
    const key = selected + '/' + day + '/' + target
    if (sentLikes.has(key)) return '已经给这位同学点过赞了。'
    await circleRequest(auth, '/' + selected + '/claps', { method: 'POST', body: { memberUserId: target, day } })
    if (alive.current) setSentLikes((old) => new Set([...Array.from(old), key]))
    return '赞已送出，给坚持一点鼓励。'
  }
  async function leaveOrClose() {
    await circleRequest(auth, '/' + selected + (owner ? '/close' : '/me'), {
      method: owner ? 'POST' : 'DELETE',
      ...(owner ? { body: {} } : {}),
    })
    const hints = readCircleHints(auth.user.userId)
    delete hints.invites[selected]
    try {
      saveCircleHints(auth.user.userId, hints)
    } catch {
      /* Already confirmed remotely. */
    }
    if (alive.current) {
      setSelected('')
      setView(null)
      setDaily(null)
    }
    return owner ? '圈子已关闭。' : '已退出圈子，以后仍可用口令加入。'
  }
  async function copyInvite() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setNotice('口令已复制，可以发给同学了。')
    } catch {
      inviteInput.current?.focus()
      inviteInput.current?.select()
      setNotice('请选中口令，手动复制后分享。')
    }
  }

  return (
    <>
      <div className="circle-notices" aria-live="polite">
        {error && (!form || needsLogin) && (
          <div className="circle-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="circle-notice" role="status">
            {notice}
          </div>
        )}
        {needsLogin && (
          <button type="button" className="circle-primary" onClick={() => openAccountManagement(mobile)}>
            重新登录
          </button>
        )}
      </div>
      {!needsLogin && (
        <div className="circle-layout">
          <aside className="circle-sidebar">
            <section className="circle-card">
              <div className="circle-section-heading">
                <h3>
                  {items.length ? '我的圈子' : '创建或加入圈子'} {items.length > 0 && <span>{items.length} / 3</span>}
                </h3>
                <button
                  type="button"
                  className="circle-icon-button"
                  disabled={disabled || loading}
                  aria-label="刷新圈子"
                  onClick={refreshAll}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                </button>
              </div>
              {!loaded && (
                <p className="circle-muted" role="status">
                  正在加载圈子…
                </p>
              )}
              {loaded && !items.length && <p className="circle-muted">创建自己的圈子，或输入朋友分享的口令。</p>}
              <div className="circle-list">
                {items.map((item) => (
                  <button
                    key={item.circleId}
                    type="button"
                    className="circle-list-item"
                    aria-pressed={selected === item.circleId}
                    disabled={disabled}
                    onClick={() => {
                      setSelected(item.circleId)
                      setDay(circleDays()[0])
                      setError('')
                      setNotice('')
                      setNewWords('')
                      setReplacement('')
                    }}
                  >
                    <span className="circle-avatar">
                      <Users size={19} aria-hidden="true" />
                    </span>
                    <span className="circle-list-name">
                      {item.name}
                      <small>
                        {item.role === 'owner' ? '我创建的' : '我加入的'}
                        {selected === item.circleId ? ' · 当前查看' : ''}
                      </small>
                    </span>
                    {selected === item.circleId && (
                      <span className="circle-selection-mark" aria-hidden="true">
                        <Check size={13} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="circle-entry-actions">
                <button
                  type="button"
                  disabled={disabled || (items.length >= 3 && !pending)}
                  onClick={() => setForm(form === 'create' ? null : 'create')}
                >
                  <Plus size={16} aria-hidden="true" /> 创建
                </button>
                <button type="button" disabled={disabled || items.length >= 3} onClick={() => setForm(form === 'join' ? null : 'join')}>
                  <KeyRound size={16} aria-hidden="true" /> 口令加入
                </button>
              </div>
              {pending && form !== 'create' && (
                <button type="button" className="circle-text-button" disabled={disabled} onClick={() => setForm('create')}>
                  上次创建未完成，继续创建
                </button>
              )}
              {form && (
                <form
                  className="circle-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void mutate(form === 'create' ? create : join, true)
                  }}
                >
                  <label>
                    {form === 'create' ? '圈子名称' : '圈子口令'}
                    <input
                      autoFocus
                      required
                      maxLength={form === 'create' ? 64 : 100}
                      autoComplete="off"
                      spellCheck={false}
                      value={form === 'create' ? pending?.name || name : invite}
                      readOnly={form === 'create' && !!pending}
                      disabled={disabled}
                      placeholder={form === 'create' ? '例如：每天十分钟' : '输入圈主设置的口令'}
                      onChange={(event) => (form === 'create' ? setName(event.target.value) : setInvite(event.target.value))}
                    />
                  </label>
                  {form === 'create' && (!pending || pending.passphrase !== undefined) && (
                    <label>
                      入圈口令
                      <input
                        required
                        maxLength={64}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="入圈口令"
                        aria-describedby="circle-create-passphrase-hint"
                        value={pending?.passphrase ?? passphrase}
                        readOnly={!!pending}
                        disabled={disabled}
                        placeholder="例如：每天学 English"
                        onChange={(event) => setPassphrase(event.target.value)}
                      />
                      <small id="circle-create-passphrase-hint">2–32 个字符，支持中英文，英文区分大小写。请勿使用账号密码。</small>
                    </label>
                  )}
                  {(form === 'join' || !pending || pending.nickname !== undefined) && (
                    <label>
                      圈内昵称（选填）
                      <input
                        aria-label="圈内昵称"
                        maxLength={64}
                        autoComplete="off"
                        value={form === 'create' ? pending?.nickname ?? nickname : joinNickname}
                        readOnly={form === 'create' && !!pending}
                        disabled={disabled}
                        placeholder={'留空使用用户名：' + auth.user.username}
                        onChange={(event) => (form === 'create' ? setNickname(event.target.value) : setJoinNickname(event.target.value))}
                      />
                    </label>
                  )}
                  <small>
                    {form === 'create'
                      ? pending
                        ? '上次创建尚未确认。继续创建会核对同一个圈子，不会重复创建。'
                        : '最多 50 人；创建后可复制口令邀请同学。'
                      : '有口令即可加入，无需圈主审核。'}
                  </small>
                  {busy && (
                    <p className="circle-muted" role="status">
                      {form === 'create' ? '正在创建“' + name + '”，请稍候…' : '正在加入圈子，请稍候…'}
                    </p>
                  )}
                  {error && (
                    <div className="circle-error" role="alert">
                      {error}
                    </div>
                  )}
                  <div className="circle-form-actions">
                    <button type="submit" className="circle-primary" disabled={disabled}>
                      {busy
                        ? form === 'create'
                          ? '正在创建…'
                          : '正在加入…'
                        : form === 'create'
                        ? pending
                          ? '继续创建'
                          : '创建圈子'
                        : '加入圈子'}
                    </button>
                    <button type="button" disabled={disabled} onClick={() => setForm(null)}>
                      收起
                    </button>
                  </div>
                </form>
              )}
            </section>
          </aside>
          <section className="circle-main" aria-label="圈子详情" aria-busy={loading}>
            {!selected && items.length > 0 && (
              <div className="circle-card circle-empty">
                <Users size={40} aria-hidden="true" />
                <h3>小小的圈子，多一点坚持</h3>
                <p>
                  创建一个圈子，或用朋友的口令加入。
                  <br />
                  每天打个卡，互相点个赞。
                </p>
              </div>
            )}
            {selected && loading && (
              <div className="circle-card circle-muted" role="status">
                正在加载打卡…
              </div>
            )}
            {view && daily && (
              <>
                <section className="circle-card">
                  <div className="circle-section-heading">
                    <div>
                      <h3 className="circle-title">{view.meta.name}</h3>
                      <p className="circle-muted">
                        {view.members.length} 位同学 · 最多 {view.meta.softMemberLimit} 人
                      </p>
                    </div>
                    <span className="circle-pill">近 7 天</span>
                  </div>
                  {owner && (
                    <div className="circle-form">
                      <label>
                        当前口令
                        <input aria-label="当前口令" readOnly value={code || ''} placeholder="旧口令仅存在原浏览器，可在管理区重新保存" />
                      </label>
                      {code && (
                        <button type="button" onClick={() => void copyInvite()}>
                          复制当前口令
                        </button>
                      )}
                    </div>
                  )}
                  <details className="circle-invite">
                    <summary>
                      <Copy size={14} aria-hidden="true" /> 邀请同学
                    </summary>
                    {code ? (
                      <div>
                        <label className="circle-sr-only" htmlFor="circle-invite-code">
                          分享口令
                        </label>
                        <input
                          id="circle-invite-code"
                          ref={inviteInput}
                          readOnly
                          value={code}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <button type="button" onClick={() => void copyInvite()}>
                          复制口令
                        </button>
                        <small>拿到口令的人可以加入，请只分享给想邀请的同学。</small>
                      </div>
                    ) : (
                      <p className="circle-muted">本机没有保存当前口令，请向圈主索取。圈主也可在下方管理区设置新口令。</p>
                    )}
                  </details>
                  <div className="circle-days" role="group" aria-label="最近七天">
                    {days.map((date, index) => (
                      <button
                        key={date}
                        type="button"
                        aria-pressed={day === date}
                        aria-label={date + (index === 0 ? ' 今天' : '')}
                        disabled={disabled}
                        onClick={() => {
                          setDay(date)
                          setError('')
                          setNotice('')
                        }}
                      >
                        <span>{index === 0 ? '今天' : index === 1 ? '昨天' : date.slice(5).replace('-', '/')}</span>
                        <small>{date.slice(8)} 日</small>
                      </button>
                    ))}
                  </div>
                </section>
                {day === days[0] && (
                  <form
                    className="circle-card circle-checkin"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void mutate(checkIn)
                    }}
                  >
                    <div>
                      <h3>今天也有在学习</h3>
                      <p className="circle-muted">手动打卡，仅在本圈分享。</p>
                    </div>
                    <label>
                      新学词数 <span>（选填）</span>
                      <input
                        aria-label="今天新学词数"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={256}
                        step={1}
                        value={newWords}
                        placeholder="0"
                        disabled={disabled}
                        onChange={(event) => setNewWords(event.target.value)}
                      />
                    </label>
                    <button type="submit" className="circle-primary" disabled={disabled}>
                      <Check size={17} aria-hidden="true" /> {busy ? '正在提交…' : '提交打卡'}
                    </button>
                  </form>
                )}
                <section className="circle-card">
                  <div className="circle-section-heading">
                    <h3>{day === days[0] ? '今日打卡' : day.slice(5).replace('-', '/') + ' 的打卡'}</h3>
                    <span className="circle-muted">{daily.progress.filter((p) => p.completed).length} 人已打卡</span>
                  </div>
                  <ul className="circle-members">
                    {view.members.map((member) => {
                      const progress = daily.progress.find((p) => p.authorUserId === member.userId)
                      const count = daily.reactionCounts.find((r) => r.authorUserId === member.userId)?.count || 0
                      const me = member.userId === auth.user.userId
                      const liked = sentLikes.has(selected + '/' + day + '/' + member.userId)
                      const sent = me && sentCheckins.has(selected + '/' + day)
                      return (
                        <li key={member.userId}>
                          <span className={'circle-person ' + (progress?.completed ? 'is-complete' : '')}>
                            {progress?.completed ? <Check size={17} aria-hidden="true" /> : <Users size={17} aria-hidden="true" />}
                          </span>
                          <div className="circle-member-info">
                            <strong>
                              {memberLabel(
                                member.userId,
                                auth.user.userId,
                                member.nickname || (member.userId === auth.user.userId ? auth.user.username : undefined),
                              )}{' '}
                              {member.role === 'owner' && <span className="circle-owner">圈主</span>}
                            </strong>
                            <small>
                              {progress?.completed
                                ? '已打卡' + (progress.newWords ? ' · 新学 ' + progress.newWords + ' 词' : '')
                                : sent
                                ? '打卡已送出，稍后更新'
                                : '还没有打卡'}
                            </small>
                          </div>
                          {me ? (
                            <span className="circle-like-count" aria-label={'收到 ' + count + ' 个赞'}>
                              <ThumbsUp size={15} aria-hidden="true" /> {count}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="circle-like"
                              aria-label={
                                (liked ? '已点赞 ' : '鼓励 ') +
                                memberLabel(
                                  member.userId,
                                  auth.user.userId,
                                  member.nickname || (member.userId === auth.user.userId ? auth.user.username : undefined),
                                )
                              }
                              disabled={disabled || !progress || liked}
                              onClick={() => void mutate(() => like(member.userId))}
                            >
                              <ThumbsUp size={16} aria-hidden="true" />
                              <span>{liked ? '已赞' : count || '点赞'}</span>
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  <p className="circle-footnote">打卡由同学自行分享，更新可能稍有延迟。昵称只在本圈使用。</p>
                </section>
                <details className="circle-card circle-manage">
                  <summary>{owner ? '圈子管理' : '离开圈子'}</summary>
                  {owner && (
                    <form
                      className="circle-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (window.confirm('更新口令后，旧口令将无法加入；现有成员不受影响。继续？')) void mutate(changePassphrase)
                      }}
                    >
                      <label>
                        新入圈口令
                        <input
                          required
                          maxLength={64}
                          autoComplete="off"
                          spellCheck={false}
                          value={replacement}
                          disabled={disabled}
                          placeholder="中文、英文或混合，2–32 个字符"
                          onChange={(event) => setReplacement(event.target.value)}
                        />
                      </label>
                      <small>仅圈主可修改。更新后请把新口令发给需要加入的同学。</small>
                      <button className="circle-primary" type="submit" disabled={disabled}>
                        {busy ? '正在保存…' : '保存口令'}
                      </button>
                    </form>
                  )}
                  {owner && (
                    <div className="circle-management-list">
                      {view.members
                        .filter((member) => member.userId !== auth.user.userId)
                        .map((member) => (
                          <div key={member.userId}>
                            <span>
                              {memberLabel(
                                member.userId,
                                auth.user.userId,
                                member.nickname || (member.userId === auth.user.userId ? auth.user.username : undefined),
                              )}
                            </span>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                if (window.confirm('移除这位同学？对方以后仍可用口令加入。'))
                                  void mutate(async () => {
                                    await circleRequest(auth, '/' + selected + '/remove', {
                                      method: 'POST',
                                      body: { memberUserId: member.userId },
                                    })
                                    return '已移除这位同学。'
                                  })
                              }}
                            >
                              移除
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="circle-danger"
                    disabled={disabled}
                    onClick={() => {
                      if (
                        window.confirm(
                          owner ? '关闭圈子后，所有成员都无法再进入，且不能恢复。确定关闭？' : '确定退出这个圈子？以后仍可用口令加入。',
                        )
                      )
                        void mutate(leaveOrClose, true)
                    }}
                  >
                    {owner ? '关闭圈子' : '退出圈子'}
                  </button>
                </details>
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}
