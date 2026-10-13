/* eslint-env node */
import { AppError } from '../core.js'

const MAX_BODY = 8192
const ROOT = '/api/circle/v2'
const METHODS = ['createCircle', 'joinCircle', 'getCircle', 'leaveCircle', 'removeMember',
  'closeCircle', 'publishProgress', 'getProgress', 'reactProgress', 'getReactions',
  'shareAchievement', 'getShowcase']
const fail = (status, code) => { throw new AppError(status, code, code) }
const headers = { 'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' }

function route(request) {
  const url = new URL(request.url)
  if (url.pathname !== ROOT && !url.pathname.startsWith(ROOT + '/')) fail(404, 'not_found')
  const rest = url.pathname === ROOT ? [] : url.pathname.slice(ROOT.length + 1).split('/')
  if (rest.some((s) => !s || /[%\\]/.test(s))) fail(404, 'not_found')
  let entry
  if (!rest.length) entry = { method: 'POST', action: 'createCircle', fields: ['name', 'operationId', 'softMemberLimit'] }
  else if (rest.length === 1 && rest[0] === 'join') entry = { method: 'POST', action: 'joinCircle', fields: ['inviteCode'] }
  else {
    const [circleId, area, item, day] = rest
    if (!/^[a-f0-9]{24}$/.test(circleId)) fail(404, 'not_found')
    if (rest.length === 1) entry = { method: 'GET', action: 'getCircle' }
    if (rest.length === 2 && area === 'me') entry = { method: 'DELETE', action: 'leaveCircle', fields: [] }
    if (rest.length === 2 && area === 'remove') entry = { method: 'POST', action: 'removeMember', fields: ['memberUserId'] }
    if (rest.length === 2 && area === 'close') entry = { method: 'POST', action: 'closeCircle', fields: [] }
    if (rest.length === 3 && area === 'progress' && /^\d{4}-\d{2}-\d{2}$/.test(item)) {
      entry = request.method === 'POST'
        ? { method: 'POST', action: 'publishProgress', fields: ['eventId', 'completed', 'newWords'] }
        : { method: 'GET', action: 'getProgress' }
    }
    if (rest.length === 2 && area === 'claps') entry = { method: 'POST', action: 'reactProgress', fields: ['memberUserId', 'day'] }
    if (rest.length === 4 && area === 'claps' && /^[A-Za-z0-9_-]{8,128}$/.test(item) &&
        /^\d{4}-\d{2}-\d{2}$/.test(day)) entry = { method: 'GET', action: 'getReactions' }
    if (rest.length === 2 && area === 'showcase') entry = { method: 'POST', action: 'shareAchievement', fields: ['achievementId'] }
    if (rest.length === 3 && area === 'showcase' && /^[A-Za-z0-9_-]{8,128}$/.test(item)) {
      entry = { method: 'GET', action: 'getShowcase' }
    }
    if (entry) Object.assign(entry, { circleId, item, day })
  }
  if (!entry) fail(404, 'not_found')
  if (request.method !== entry.method) fail(405, 'method_not_allowed')
  const queries = [...url.searchParams.keys()]
  if (queries.some((q) => q !== 'ids' || entry.action !== 'getShowcase') ||
      url.searchParams.getAll('ids').length > 1) fail(400, 'invalid_query')
  if (entry.action === 'getShowcase') {
    const raw = url.searchParams.get('ids') || ''
    entry.ids = raw ? raw.split(',') : []
    if (entry.ids.length > 24 || entry.ids.some((v) => !/^ACH_[A-Z0-9_]{3,72}$/.test(v))) {
      fail(400, 'invalid_achievement')
    }
  }
  return entry
}

async function input(request, fields) {
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    fail(400, 'invalid_content_length')
  }
  if (declared !== null && Number(declared) > MAX_BODY) fail(413, 'circle_request_too_large')
  const chunks = []
  let bytes = 0
  const reader = request.body?.getReader()
  if (reader) {
    try {
      for (let part = await reader.read(); !part.done; part = await reader.read()) {
        const { value } = part
        if (!(value instanceof Uint8Array)) fail(400, 'invalid_body')
        bytes += value.byteLength
        if (bytes > MAX_BODY) {
          await reader.cancel().catch(() => {})
          fail(413, 'circle_request_too_large')
        }
        chunks.push(Buffer.from(value))
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      fail(400, 'invalid_body')
    } finally { reader.releaseLock() }
  }
  if (declared !== null && Number(declared) !== bytes) fail(400, 'invalid_content_length')
  if (!bytes && !fields.length) return {}
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    fail(415, 'unsupported_media_type')
  }
  let body
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch { fail(400, 'invalid_json') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json')
  if (Object.keys(body).some((key) => !fields.includes(key))) fail(400, 'unexpected_field')
  return body
}

/**
 * Offline/server-only request dispatcher; not mounted anywhere.
 * Production http.js remains hard closed. Trusted rateLimit must authenticate
 * the account and use server-trusted source IP, never caller body/IP assertions.
 * No CORS, infrastructure, credentials, listener or environment activation.
 */
export function createCircleTransport({ service, rateLimit, maxResponseBytes = 65536 } = {}) {
  if (!service || METHODS.some((method) => typeof service[method] !== 'function')) {
    throw new TypeError('Complete light Circle service required')
  }
  if (typeof rateLimit !== 'function') throw new TypeError('Trusted account/IP limiter required')
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 256 || maxResponseBytes > 1048576) {
    throw new TypeError('Invalid Circle response budget')
  }
  const response = (value, status) => new Response(JSON.stringify(value), { status, headers })
  async function handle(request) {
    try {
      const r = route(request)
      const auth = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')
      if (!auth) fail(401, 'missing_token')
      const token = auth[1]
      if (await rateLimit({ request, token, action: r.action, circleId: r.circleId }) !== true) {
        fail(429, 'circle_rate_limited')
      }
      const body = r.fields ? await input(request, r.fields) : {}
      let result
      switch (r.action) {
        case 'createCircle': result = await service.createCircle(token, body); break
        case 'joinCircle': result = await service.joinCircle(token, body.inviteCode); break
        case 'getCircle': result = await service.getCircle(token, r.circleId); break
        case 'leaveCircle': result = await service.leaveCircle(token, r.circleId); break
        case 'removeMember': result = await service.removeMember(token, r.circleId, body.memberUserId); break
        case 'closeCircle': result = await service.closeCircle(token, r.circleId); break
        case 'publishProgress': result = await service.publishProgress(token, r.circleId, r.item, body); break
        case 'getProgress': result = await service.getProgress(token, r.circleId, r.item); break
        case 'reactProgress': result = await service.reactProgress(token, r.circleId, body.memberUserId, body.day); break
        case 'getReactions': result = await service.getReactions(token, r.circleId, r.item, r.day); break
        case 'shareAchievement': result = await service.shareAchievement(token, r.circleId, body.achievementId); break
        case 'getShowcase': result = await service.getShowcase(token, r.circleId, r.item, r.ids); break
        default: fail(404, 'not_found')
      }
      const payload = { ok: true, consistency: 'eventual', result }
      if (Buffer.byteLength(JSON.stringify(payload)) > maxResponseBytes) fail(503, 'circle_response_too_large')
      return response(payload, r.method === 'GET' ? 200 : 202)
    } catch (error) {
      // Stop unread streaming input when authentication, rate or route checks reject it.
      try { await request.body?.cancel() } catch { /* body may already be closed */ }
      if (error instanceof AppError && Number.isInteger(error.statusCode) &&
          error.statusCode >= 400 && error.statusCode <= 599 &&
          /^[a-z][a-z0-9_]{1,63}$/.test(error.code || '')) {
        return response({ ok: false, error: error.code }, error.statusCode)
      }
      if (error?.code === 'circle_append_unknown') {
        return response({ ok: false, error: 'circle_append_unknown' }, 503)
      }
      return response({ ok: false, error: 'circle_internal_error' }, 500)
    }
  }
  return Object.freeze({ handle })
}
