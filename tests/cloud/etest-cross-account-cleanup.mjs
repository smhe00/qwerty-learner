/* eslint-env node */
// EXCLUSIVELY disposable etest identities for cross-account E2E.
// Credential-based deletion; never query or delete real accounts.
const base=process.env.QWERTY_SYNC_BASE_URL
const prefix=process.env.QWERTY_E2E_USER_PREFIX
const password=process.env.QWERTY_E2E_PASSWORD
if(base!=='https://etest.edgeone.dev/' ||
   !/^e2e_xa_[0-9]+_[0-9]+$/.test(prefix||'') ||
   !password || password.length<20 ||
   !process.env.GITHUB_RUN_ID || !prefix.includes(process.env.GITHUB_RUN_ID)) {
  throw new Error('Unsafe disposable-account cleanup environment')
}
const users=['a','b','c','d'].map(s=>prefix+'_'+s)
let failed=0
async function api(path,options={}) {
  const r=await fetch(new URL(path,base),{...options,
    headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),
      ...options.headers},signal:AbortSignal.timeout(20000)})
  return {status:r.status,result:await r.json().catch(()=>null)}
}
for(const username of users){
  try{
    let login
    for(let i=0;i<5;i++){
      try{login=await api('/api/auth/login',{method:'POST',body:JSON.stringify({
        username,password,deviceId:'qa-xaccount-cleanup'})})}catch(e){if(i===4)throw e}
      if(login&&login.status<500&&login.status!==429)break
      await new Promise(resolve=>setTimeout(resolve,600*(i+1)))
    }
    if(login?.status===401||login?.result?.error==='invalid_credentials'){
      console.log('Unregistered disposable identity skipped:',username)
      continue
    }
    if(login?.status!==200||!login.result?.token||
       login.result.user?.username!==username)throw Error('Cleanup login refused: '+login?.status)
    const deleted=await api('/api/auth/account',{method:'DELETE',
      headers:{Authorization:'Bearer '+login.result.token},
      body:JSON.stringify({currentPassword:password})})
    if(deleted.status!==200||deleted.result?.deleted?.accountDeleted!==true){
      throw Error('Cleanup delete failed HTTP '+deleted.status)
    }
    console.log('Deleted disposable cross-account E2E identity:',username)
  }catch(error){
    failed++
    console.error('Cleanup failed for disposable identity:',username,
      error instanceof Error?error.message:'unknown-error')
  }
}
if(failed)process.exitCode=1
