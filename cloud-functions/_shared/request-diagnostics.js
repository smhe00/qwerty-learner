/* eslint-env node */
/** Per-request metadata only. No arguments, keys, error messages or bodies
 * enter the trace. Wrappers preserve sync return values and original errors.
 */
export function createRequestDiagnostics(context = {}) {
  const rawId = context.uuid
  const requestId = typeof rawId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(rawId) ? rawId : undefined
  const stages = new Map()
  const mark = (error, stage) => { if (!stages.has(error)) stages.set(error, stage) }
  return {
    requestId,
    stageFor: error => stages.get(error),
    async run(stage, operation) {
      try { return await operation() }
      catch (error) { mark(error, stage); throw error }
    },
    storage(adapter) {
      const wrappers = new Map()
      return new Proxy(adapter, {
        get(target, name) {
          const value = Reflect.get(target, name)
          if (typeof value !== 'function') return value
          if (!wrappers.has(name)) {
            const stage = typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,48}$/.test(name)
              ? 'storage-' + name : 'storage-operation'
            wrappers.set(name, (...args) => {
              try {
                const answer = Reflect.apply(value, target, args)
                return answer && typeof answer.then === 'function'
                  ? answer.catch(error => { mark(error, stage); throw error }) : answer
              } catch (error) { mark(error, stage); throw error }
            })
          }
          return wrappers.get(name)
        },
      })
    },
  }
}
