/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { isHandoffExperimentEnabled } from '../../cloud-functions/_shared/session-handoff-deployment-policy.js'
import { runtimeEnvironment } from '../../cloud-functions/_shared/runtime-environment.js'
test('only exact server branch=etest enables handoff',()=>{
 for(const branch of ['master',undefined,null,'','ETEST','edgeone-test',' etest','etest ']) assert.equal(isHandoffExperimentEnabled({branch}),false)
 assert.equal(isHandoffExperimentEnabled(undefined),false)
 assert.equal(isHandoffExperimentEnabled({branch:'etest'}),true)
})
test('Node fallback and explicit context binding preserve deployment isolation',()=>{
 assert.equal(isHandoffExperimentEnabled(runtimeEnvironment(undefined,{branch:'etest'})),true)
 for(const branch of ['master','',null]) assert.equal(isHandoffExperimentEnabled(runtimeEnvironment({branch},{branch:'etest'})),false)
 assert.equal(isHandoffExperimentEnabled(runtimeEnvironment({branch:'etest'},{branch:'master'})),true)
 assert.equal(isHandoffExperimentEnabled(runtimeEnvironment({branch:undefined},{branch:'master'})),false)
})
test('literal process.env.branch injection works in Node function bundlers',async()=>{
 for(const branch of ['master','etest']){
 const result=await build({entryPoints:['cloud-functions/_shared/runtime-environment.js'],bundle:true,format:'esm',platform:'node',target:'node20',write:false,define:{'process.env.branch':JSON.stringify(branch)}})
 const {runtimeEnvironment:injected}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))
 assert.equal(injected().branch,branch)
 assert.equal(isHandoffExperimentEnabled(injected()),branch==='etest')
 }
})
