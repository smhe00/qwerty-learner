/* eslint-env node */
import { checkAuthRateLimit } from './auth-rate-limit.js'
import { AppError } from './core.js'
import crypto from 'node:crypto'

const HASH = /^[a-f0-9]{64}$/
const OWNER = /^(?:a-[a-f0-9]{32}|g-[a-f0-9]{64})$/
const OP = /^[a-f0-9]{32}$/
const states = ['waiting', 'handling', 'resolved']
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (status, code, message) => {
  throw new AppError(status, code, message)
}
const rootPrefix = (owner) => (owner.startsWith('a-') ? `users/${owner.slice(2)}/feedback/v1/` : `feedback/v1/guests/${owner.slice(2)}/`)
const indexPrefix = (owner) => `feedback/v1/index/${owner ? owner + '/' : ''}`

/** Independent private conversations. Immutable content keys make identical retries
 * safe without a Blob CAS or a shared messages array. No learning records touched. */
export function createFeedbackService({ store, backend, administrator, rateStorage }) {
  const get = (key) => store.get(key, { type: 'json', consistency: 'strong' })
  async function save(key, value) {
    const old = await get(key)
    if (old !== null) {
      if (digest({ ...old, createdAt: 0 }) !== digest({ ...value, createdAt: 0 })) fail(503, 'feedback_integrity', '反馈内容暂时无法确认。')
      return old
    }
    // Do not replay an unknown write. Resolve it with one strong read instead.
    try {
      await store.setJSON(key, value)
    } catch {
      /* read-back below */
    }
    const confirmed = await get(key)
    if (confirmed === null || digest({ ...confirmed, createdAt: 0 }) !== digest({ ...value, createdAt: 0 })) {
      fail(503, 'feedback_write_unknown', '发送结果暂未确认，请重试原消息。')
    }
    return confirmed
  }
  async function list(prefix, cursor = '', limit = 20) {
    if (typeof cursor !== 'string' || cursor.length > 2048) fail(400, 'invalid_cursor', '分页信息无效。')
    const page = await store.list({ prefix, cursor: cursor || undefined, limit, paginate: false, consistency: 'strong' })
    if (
      !Array.isArray(page?.blobs) ||
      page.blobs.length > limit ||
      page.blobs.some((x) => typeof x.key !== 'string' || !x.key.startsWith(prefix))
    ) {
      fail(503, 'feedback_list_unavailable', '暂时无法读取反馈，请稍后重试。')
    }
    return { keys: page.blobs.map((x) => x.key), cursor: page.cursor || '' }
  }
  async function messages(owner, id) {
    const entries = []
    let cursor = ''
    const seen = new Set()
    do {
      const page = await list(rootPrefix(owner) + id + '/messages/', cursor, 100)
      entries.push(...page.keys)
      if (entries.length > 1000 || (page.cursor && seen.has(page.cursor))) fail(409, 'feedback_full', '这条反馈内容较多，请新建反馈。')
      cursor = page.cursor
      seen.add(cursor)
    } while (cursor)
    const result = []
    for (let i = 0; i < entries.length; i += 5) {
      result.push(...(await Promise.all(entries.slice(i, i + 5).map(get))))
    }
    if (result.some((x) => x === null)) fail(503, 'feedback_list_unavailable', '回复暂时无法完整读取。')
    return result.sort((a, b) => a.createdAt - b.createdAt || a.role.localeCompare(b.role) || a.id.localeCompare(b.id))
  }
  async function principal(request, clientIp) {
    if (typeof clientIp !== 'string' || !clientIp.trim() || clientIp.length > 128) fail(503, 'feedback_unavailable', '反馈暂时不可用。')
    const write = request.method === 'POST'
    const budget = await checkAuthRateLimit({
      storage: rateStorage,
      clientIp: `feedback-${write ? 'write' : 'read'}:${clientIp}`,
      requestLimit: write ? 10 : 60,
      windowSeconds: 60,
    })
    if (!budget.allowed) fail(429, 'feedback_rate_limited', '操作较频繁，请稍后再试。')
    const authorization = request.headers.get('authorization')
    if (authorization !== null) {
      const token = /^Bearer (.+)$/i.exec(authorization)?.[1]
      if (!token) fail(401, 'invalid_token', '请重新登录。')
      const { user } = await backend.me(token)
      if (!/^[a-f0-9]{32}$/.test(user?.userId || '')) fail(401, 'invalid_token', '请重新登录。')
      return {
        owner: 'a-' + user.userId,
        administrator: administrator.isAdministrator({ ...user, normalizedUsername: user.username.toLowerCase(), status: 'active' }),
      }
    }
    const secret = request.headers.get('x-feedback-key') || ''
    if (!HASH.test(secret)) fail(401, 'feedback_key_required', '请使用原浏览器或私密链接查看反馈。')
    return { owner: 'g-' + digest(secret), administrator: false }
  }
  function content(body, creating, admin) {
    if (!body || typeof body !== 'object' || !OP.test(body.operationId || '')) fail(400, 'invalid_feedback', '反馈格式无效。')
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (text.length > 2000 || (creating && (!text || !title || title.length > 80)) || (!creating && !text && !body.status)) {
      fail(400, 'invalid_feedback', '请填写内容，标题最多 80 字，正文最多 2000 字。')
    }
    if (body.status !== undefined && (!admin || !states.includes(body.status)))
      fail(403, 'feedback_status_forbidden', '仅管理员可以修改处理状态。')
    return {
      text,
      ...(creating ? { title } : {}),
      operationId: body.operationId,
      ...(creating ? {} : { status: admin ? body.status || 'handling' : 'waiting' }),
    }
  }
  return {
    async handle({ request, clientIp, readBody }) {
      const actor = await principal(request, clientIp)
      const url = new URL(request.url)
      const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '')
      if (path === '/feedback' && request.method === 'GET') {
        const all = url.searchParams.get('scope') === 'all'
        if (all && !actor.administrator) fail(403, 'feedback_forbidden', '没有管理权限。')
        const page = await list(indexPrefix(all ? '' : actor.owner), url.searchParams.get('cursor') || '')
        const items = []
        for (let offset = 0; offset < page.keys.length; offset += 5) {
          const batch = await Promise.all(
            page.keys.slice(offset, offset + 5).map(async (key) => {
              const match = /^feedback\/v1\/index\/((?:a-[a-f0-9]{32}|g-[a-f0-9]{64}))\/([a-f0-9]{64})\.json$/.exec(key)
              if (!match || (!all && match[1] !== actor.owner)) fail(503, 'feedback_list_unavailable', '反馈列表暂时不可用。')
              const root = await get(rootPrefix(match[1]) + match[2] + '/root.json')
              return root ? { owner: match[1], id: match[2], title: root.title, createdAt: root.createdAt } : null
            }),
          )
          items.push(...batch.filter(Boolean))
        }
        return { items: items.sort((a, b) => b.createdAt - a.createdAt), cursor: page.cursor, administrator: actor.administrator }
      }
      if (path === '/feedback' && request.method === 'POST') {
        const payload = content(await readBody(16384), true, false)
        const id = digest({ owner: actor.owner, ...payload })
        // Repairable opaque index before content. An incomplete create stays invisible.
        await save(indexPrefix(actor.owner) + id + '.json', { id })
        const root = await save(rootPrefix(actor.owner) + id + '/root.json', { ...payload, createdAt: Date.now() })
        return { owner: actor.owner, id, ...root }
      }
      const match = /^\/feedback\/([^/]+)\/([^/]+)(\/messages)?$/.exec(path)
      if (!match || !OWNER.test(match[1]) || !HASH.test(match[2])) fail(404, 'not_found', '反馈不存在。')
      const [, owner, id, suffix] = match
      if (owner !== actor.owner && !actor.administrator) fail(404, 'not_found', '反馈不存在。')
      const root = await get(rootPrefix(owner) + id + '/root.json')
      if (!root) fail(404, 'not_found', '反馈不存在。')
      if (!suffix && request.method === 'GET') {
        const replies = await messages(owner, id)
        return { owner, id, ...root, messages: replies, status: replies.at(-1)?.status || 'waiting' }
      }
      if (suffix && request.method === 'POST') {
        const payload = content(await readBody(16384), false, actor.administrator)
        const role = actor.administrator ? 'admin' : 'user'
        const messageId = digest({ ...payload, role })
        const key = rootPrefix(owner) + id + '/messages/' + messageId + '.json'
        const old = await get(key)
        if (old) return old
        if ((await messages(owner, id)).length >= 200) fail(409, 'feedback_full', '请新建反馈继续交流。')
        return save(key, { id: messageId, ...payload, role, createdAt: Date.now() })
      }
      fail(405, 'method_not_allowed', '不支持此操作。')
    },
  }
}
