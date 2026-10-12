/* eslint-env node */
import { AppError } from '../core.js'

/**
 * Server-only, fail-closed HTTP adapter. NOT mounted in the production gateway.
 * The containing gateway owns CORS. This adapter returns no permissive CORS
 * headers and never accepts user identity from request JSON.
 */
export function createCircleHttpHandler({ service, enabled = false, rateLimit } = {}) {
  if (!service) throw new TypeError('Circle service is required')
  if (enabled && typeof rateLimit !== 'function') {
    throw new TypeError('Enabling Circle requires a server-side account/IP rate limiter')
  }

  const send = (payload, status = 200) => new Response(JSON.stringify({ ok: true, ...payload }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
  const error = (status, code, message) => new AppError(status, code, message)
  const pattern = /^\/api\/circle\/v1(?:\/|$)/

  async function input(request) {
    const contentType = request.headers.get('content-type') || ''
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw error(415, 'unsupported_media_type', 'JSON body required')
    }
    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > 8192) {
      throw error(413, 'circle_request_too_large', 'Circle input exceeds 8KiB')
    }
    if (!text) throw error(400, 'invalid_json', 'JSON object required')
    let body
    try { body = JSON.parse(text) } catch {
      throw error(400, 'invalid_json', 'Invalid JSON')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw error(400, 'invalid_json', 'JSON object required')
    }
    return body
  }

  async function handle(request) {
    if (!enabled) throw error(404, 'not_found', 'Not found')
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)
    if (!pattern.test(url.pathname) || segments[0] !== 'api' ||
        segments[1] !== 'circle' || segments[2] !== 'v1') {
      throw error(404, 'not_found', 'Not found')
    }
    const auth = request.headers.get('authorization') || ''
    const match = /^Bearer\s+(\S+)$/i.exec(auth)
    if (!match) throw error(401, 'missing_token', 'Bearer session is required')
    // Rate-limit reads as well as writes; in particular no invite guessing,
    // membership enumeration or repeated response-size probing is allowed.
    // The gateway must supply a limiter using BOTH account and source IP.
    const limited = await rateLimit(request)
    if (limited !== true) throw error(429, 'circle_rate_limited', 'Circle request rate limit')
    const token = match[1]
    const rest = segments.slice(3)
    const method = request.method.toUpperCase()
    if (rest.length === 0 && method === 'POST') {
      return send(await service.createCircle(token, await input(request)), 201)
    }
    if (rest.length === 1 && rest[0] === 'join' && method === 'POST') {
      const body = await input(request)
      return send(await service.joinCircle(token, body.inviteCode))
    }
    const id = rest[0]
    if (!id || !/^[A-Za-z0-9_-]{12}$/.test(id)) {
      throw error(404, 'not_found', 'Not found')
    }
    if (rest.length === 1 && method === 'GET') {
      return send(await service.getCircle(token, id))
    }
    if (rest.length === 2 && rest[1] === 'me' && method === 'DELETE') {
      return send(await service.leaveCircle(token, id))
    }
    if (rest.length === 2 && rest[1] === 'remove' && method === 'POST') {
      const body = await input(request)
      return send(await service.removeMember(token, id, body.memberUserId))
    }
    if (rest.length === 2 && rest[1] === 'rotate-invite' && method === 'POST') {
      return send(await service.rotateInvite(token, id))
    }
    if (rest.length === 2 && rest[1] === 'close' && method === 'POST') {
      return send(await service.closeCircle(token, id))
    }
    if (rest.length === 3 && rest[1] === 'progress' && method === 'POST') {
      return send(await service.publishProgress(token, id, rest[2], await input(request)), 201)
    }
    if (rest.length === 3 && rest[1] === 'progress' && method === 'GET') {
      return send({ progress: await service.getProgress(token, id, rest[2]) })
    }
    if (rest.length === 2 && rest[1] === 'claps' && method === 'POST') {
      const body = await input(request)
      return send(await service.reactProgress(token, id, body.memberUserId, body.day), 201)
    }
    if (rest.length === 4 && rest[1] === 'claps' && method === 'GET') {
      return send(await service.getReactions(token, id, rest[2], rest[3]))
    }
    if (rest.length === 2 && rest[1] === 'showcase' && method === 'POST') {
      const body = await input(request)
      return send(await service.shareAchievement(token, id, body.achievementId), 201)
    }
    if (rest.length === 3 && rest[1] === 'showcase' && method === 'GET') {
      const raw = url.searchParams.get('ids') || ''
      const ids = raw ? raw.split(',') : []
      return send({ entries: await service.getShowcase(token, id, rest[2], ids) })
    }
    throw error(404, 'not_found', 'Not found')
  }
  return Object.freeze({ handle })
}
