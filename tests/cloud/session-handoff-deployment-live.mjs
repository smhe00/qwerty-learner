/* eslint-env node */
import assert from 'node:assert/strict'
import { HANDOFF_EXPERIMENT_ENABLED } from '../../cloud-functions/_shared/session-handoff-deployment-policy.js'
if (HANDOFF_EXPERIMENT_ENABLED) {
 await import('./session-handoff-live.mjs')
} else {
 const base=process.env.QWERTY_SYNC_BASE_URL
 assert.equal(new URL(base).origin,'https://t.smhe.cn')
 const health=await fetch(new URL('/api/health',base),{cache:'no-store',signal:AbortSignal.timeout(15000)})
 assert.equal(health.status,200)
 const data=await health.json()
 assert.equal(data.service,'qwerty-sync-gateway')
 assert.equal(data.capabilities.includes('account-handoff-blob-fixtures-v1'),false)
 assert.equal(data.handoffMode,undefined)
 assert.equal(data.capabilities.includes('idle-auto-policy-v1'),true)
 const status=await fetch(new URL('/api/auth/handoff/status',base),{cache:'no-store',signal:AbortSignal.timeout(15000)})
 assert.equal(status.status,404)
 console.log(JSON.stringify({deploymentMode:'handoff-disabled',health:200,experimentRoute:404,idlePreserved:true,accountWrites:0}))
}
