/* eslint-env node */
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

/** These reads never commit learning data. verify-set may persist only a
 * disposable server-owned verification checkpoint. No prefix/path wildcard. */
export function isStartupSyncRead(request) {
  const path = new URL(request.url).pathname.replace(/^\/api(?=\/|$)/, '')
  return (request.method === 'GET' && ['/sync/v2/meta', '/sync/events/v2/observed'].includes(path)) ||
    (request.method === 'POST' && path === '/sync/events/v2/verify-set')
}

const scopes = new AsyncLocalStorage()
export const circleBlobClientsEnabled = () => scopes.getStore() === true
export function withCircleBlobClients(request, operation) {
  const path = new URL(request.url).pathname.replace(/^\/api(?=\/|$)/, '')
  return scopes.run(/^\/circle\/v2(?:\/|$)/.test(path) || isStartupSyncRead(request), operation)
}

/** Reuse SDK transport and expiring provider credentials, never Blob values,
 * application authorization, or request/handoff/profile scopes. */
export function createBlobClientFactory(nativeGetStore, environment = () => process.env) {
  const clients = new Map()
  return options => {
    const o = typeof options === 'string' ? {name:options} : options || {}
    const env = environment()
    const key = createHash('sha256').update(JSON.stringify([o.name,o.consistency || 'eventual',
      o.projectId || env.PAGES_PROJECT_ID || '',o.token || env.PAGES_BLOB_DEPLOY_CREDENTIAL || '',env.PAGES_BLOB_STS_ENV || 'prod'])).digest('hex')
    if (clients.has(key)) {const client=clients.get(key);clients.delete(key);clients.set(key,client);return client}
    const raw = nativeGetStore(options)
    let ready = false
    let warming
    const methods = new Map()
    const client = new Proxy(raw, {get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (!['get','getWithHeaders','list','set','setJSON','delete'].includes(property)) return value.bind(target)
      if (!methods.has(property)) methods.set(property,(...args)=>{
        if (warming) return warming.then(()=>Reflect.apply(value,target,args))
        const result = Reflect.apply(value,target,args)
        if (ready || !result || typeof result.then !== 'function') return result
        // SDK0.0.18 does not coalesce concurrent initial credential fetches.
        // Queue only undispatched calls; never replay the original operation.
        warming=result.then(v=>{ready=true;return v})
        warming.then(()=>{warming=undefined},()=>{warming=undefined})
        return warming
      })
      return methods.get(property)
    }})
    clients.set(key,client)
    while(clients.size>16)clients.delete(clients.keys().next().value)
    return client
  }
}
