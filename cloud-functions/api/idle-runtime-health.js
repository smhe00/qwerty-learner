/* eslint-env node */
// Temporary read-only ABI probe: booleans/types only, never values or accounts.
const dateValid = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const regions = new Set(['ap-guangzhou', 'ap-shanghai', 'ap-nanjing', 'ap-beijing', 'ap-chengdu',
  'ap-singapore', 'ap-hongkong', 'ap-bangkok', 'ap-jakarta', 'ap-seoul', 'ap-tokyo', 'eu-frankfurt', 'na-ashburn', 'na-siliconvalley'])
export async function onRequestGet(context) {
  const env = context.env
  let mappedDate
  let mappedFlag
  let mapRead = 'not-applicable'
  if (env && typeof env.get === 'function') {
    try {
      mappedDate = await env.get('IDLE_POLICY_START_AT')
      mappedFlag = await env.get('IDLE_CLEANUP_EXECUTE')
      mapRead = 'observed'
    } catch { mapRead = 'unavailable' }
  }
  const nodeDate = typeof process === 'undefined' ? undefined : process.env.IDLE_POLICY_START_AT
  const nodeFlag = typeof process === 'undefined' ? undefined : process.env.IDLE_CLEANUP_EXECUTE
  const region = context.server?.region
  return new Response(JSON.stringify({ ok: true, probe: 'idle-env-abi-v1',
    context: { kind: kind(env), dateKind: kind(env?.IDLE_POLICY_START_AT),
      dateValid: dateValid(env?.IDLE_POLICY_START_AT), executionRequested: env?.IDLE_CLEANUP_EXECUTE === 'true',
      mapRead, mappedDateValid: dateValid(mappedDate), mappedExecutionRequested: mappedFlag === 'true' },
    node: { dateKind: kind(nodeDate), dateValid: dateValid(nodeDate), executionRequested: nodeFlag === 'true' },
    functionRegion: regions.has(region) ? region : 'not-reported',
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
