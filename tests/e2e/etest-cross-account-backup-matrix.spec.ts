import { expect, test, type BrowserContext, type Page, type Download } from '@playwright/test'
import { gunzipSync } from 'node:zlib'

const base = 'https://etest.edgeone.dev/'
const prefix = process.env.QWERTY_E2E_USER_PREFIX!
const password = process.env.QWERTY_E2E_PASSWORD!
type Name = 'a'|'b'|'c'|'d'
const username = (n:Name) => prefix+'_'+n
const dialogChoices = new WeakMap<Page,'accept'|'dismiss'>()
const checkpoints: Array<{case:string,localRows?:number,remoteRevision?:number,result:string}> = []
const add = (name:string, result:string, rows?:number, revision?:number) =>
  checkpoints.push({case:name,result,localRows:rows,remoteRevision:revision})

async function learnRows(page:Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {
      const request=indexedDB.open('RecordDB')
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
    })
    try {
      return await new Promise<number>((resolve,reject) => {
        const tx=db.transaction('wordRecords','readonly')
        const req=tx.objectStore('wordRecords').getAll()
        req.onsuccess=()=>resolve((req.result as Array<{sourceMode?:string}>)
          .filter(x=>x.sourceMode==='learn').length)
        req.onerror=()=>reject(req.error)
      })
    }finally{db.close()}
  })
}
async function accountId(page:Page) {
  return page.evaluate(() => {
    const auth=JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1')||'null')
    return auth?.user?.userId as string|undefined
  })
}
async function getMeta(page:Page) {
  const token=await page.evaluate(()=>
    JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1')||'null')?.token as string)
  expect(token).toBeTruthy()
  let last=''
  for(let i=0;i<4;i++){
    try {
      const res=await page.request.get(base+'api/sync/v2/meta',{
        headers:{Authorization:'Bearer '+token},timeout:20000})
      last='HTTP '+res.status()
      if(res.ok())return await res.json() as {
        revision:number,hasData:boolean,logicalFingerprint:string|null,
        payloadSha256:string|null,clientFormatVersion:string|null
      }
    }catch(e){last=String(e)}
    await new Promise(resolve=>setTimeout(resolve,600*(i+1)))
  }
  throw new Error('Read-only V4 meta unavailable: '+last)
}
async function open(page:Page, name:Name){
  await page.goto(base+'?s1-account=manage',{waitUntil:'domcontentloaded'})
  const dialog=page.getByRole('dialog',{name:'安全账户管理（S1）'})
  await expect(dialog).toBeVisible({timeout:30000})
  await page.getByPlaceholder('用户名').fill(username(name))
  await page.getByPlaceholder('账户密码').fill(password)
  await page.getByPlaceholder('注册密码确认').fill(password)
  await page.getByRole('button',{name:'注册新账户'}).click()
  // S1 registration is a PRE-MOUNT owner transition and intentionally
  // replaces the document. Wait for navigation; its previous execution
  // context must not be treated as a failed registration.
  await expect(page).not.toHaveURL(/s1-account=manage/,{timeout:60000})
  await expect.poll(async()=>page.evaluate(()=>
    JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1')||'null')?.user?.username||null)
    .catch(()=>null),{timeout:60000}).toBe(username(name))
  await page.goto(base,{waitUntil:'domcontentloaded'})
  const id=await accountId(page)
  expect(id).toMatch(/^[a-f0-9]{16,}$/)
  return id!
}
async function learn(page:Page, count:number){
  const before=await learnRows(page)
  await page.goto(base+'learn',{waitUntil:'domcontentloaded'})
  const word=page.locator('[data-typing-word]:visible').first()
  await expect(word).toBeVisible({timeout:35000})
  const prompt=page.getByText(/按任意键(?:开始|继续)/).first()
  if(await prompt.isVisible().catch(()=>false))await page.keyboard.press('a')
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible({timeout:25000})
  for(let i=1;i<=count;i++){
    await expect(word).toHaveAttribute('data-typing-word',/\S+/,{timeout:30000})
    const spell=await word.getAttribute('data-typing-word')
    const prev=await page.evaluate(() => {
      const raw=localStorage.getItem('reviewModeInfo')
      const row=raw?JSON.parse(raw)?.reviewRecord:null
      return row?.index ?? null
    })
    await page.keyboard.type(spell!)
    await expect.poll(()=>learnRows(page),{timeout:30000}).toBe(before+i)
    if(i<count)await expect.poll(async()=>{
      const state=await page.evaluate(()=>{
        const raw=localStorage.getItem('reviewModeInfo')
        const row=raw?JSON.parse(raw)?.reviewRecord:null
        return {index:row?.index ?? null,finished:row?.isFinished===true}
      })
      return state.finished||(prev!==null&&state.index!==null&&state.index>prev)
    },{timeout:30000}).toBe(true)
  }
  await page.reload({waitUntil:'domcontentloaded'})
  expect(await learnRows(page)).toBe(before+count)
}
async function downloadBytes(download:Download):Promise<Buffer> {
  const chunks:Buffer[]=[]
  const stream=await download.createReadStream()
  for await(const chunk of stream)chunks.push(Buffer.from(chunk))
  const zipped=Buffer.concat(chunks)
  const archive=JSON.parse(gunzipSync(zipped).toString('utf8'))
  expect(archive.metadata.source.kind).toBe('account')
  expect(archive.workspaceData.database.data.tables.length).toBe(6)
  return zipped
}
async function localExport(page:Page) {
  await page.goto(base+'?v4-import=manage',{waitUntil:'domcontentloaded'})
  await expect(page.getByText('本地导入完整 Backup V4')).toBeVisible({timeout:30000})
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:/① 下载当前本地完整 V4 备份/}).click()
  return downloadBytes(await download)
}
async function cloudExport(page:Page) {
  await page.goto(base+'?v4-cloud-backup=download',{waitUntil:'domcontentloaded'})
  await expect(page.getByText('导出云端完整 Backup V4')).toBeVisible({timeout:30000})
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:/下载标准 V4 文件/}).click()
  return downloadBytes(await download)
}
async function importV4(page:Page, gz:Buffer, targetId:string, cancel=false){
  const prior=await getMeta(page)
  await page.goto(base+'?v4-import=manage',{waitUntil:'domcontentloaded'})
  await expect(page.getByText('本地导入完整 Backup V4')).toBeVisible({timeout:30000})
  await page.getByLabel('选择 Backup V4 gzip 文件').setInputFiles({
    name:'cross-account-v4.gz',mimeType:'application/gzip',buffer:gz})
  await expect(page.getByText(/备份文件结构与数据表校验通过/)).toBeVisible({timeout:20000})
  await expect(page.getByText(/账号 ID 不同/)).toBeVisible()
  const apply=page.getByRole('button',{name:/② 我确认用 V4 备份完整替换/})
  await expect(apply).toBeDisabled()
  const dl=page.waitForEvent('download')
  await page.getByRole('button',{name:/① 下载当前本地完整 V4 备份/}).click()
  await downloadBytes(await dl)
  await page.getByLabel('我已确认当前本地备份文件保存成功').check()
  await page.getByLabel(/我明白：将完整替换/).check()
  await page.getByLabel('确认当前接收账号 ID').fill(targetId)
  await expect(apply,'cross-owner requires separate consent').toBeDisabled()
  await page.getByLabel(/我明确同意把来源不同 ID/).check()
  await expect(apply).toBeEnabled()
  dialogChoices.set(page,cancel?'dismiss':'accept')
  await apply.click()
  if(cancel){
    await expect(page.getByText(/操作已取消/)).toBeVisible({timeout:10000})
  }else{
    await expect.poll(async()=> (await page.locator('body').innerText())
      .includes('本地完整 V4 恢复完成'),{timeout:60000}).toBe(true)
  }
  const current=await getMeta(page)
  expect(current.revision,'import must not mutate target cloud revision').toBe(prior.revision)
  expect(current.logicalFingerprint,'import must not mutate target cloud fingerprint')
    .toBe(prior.logicalFingerprint)
}
async function sync(page:Page, expected:'upload'|'noop'|'conflict'){
  await page.goto(base+'?s2-sync=run',{waitUntil:'domcontentloaded'})
  const status=page.getByRole('status').filter({
    hasText:expected==='upload'?/同步完成：本地进度已安全上传/:
      expected==='noop'?/同步完成：本地和云端已经一致/:
        /同步冲突：本地和云端均有变化/}).first()
  await expect(status,'expected S2 '+expected).toBeVisible({timeout:90000})
}
async function advanced(page:Page, owner:string, choice:'keep-local'|'keep-cloud',
  cancel=false) {
  const before=await getMeta(page)
  await page.goto(base+'?s2-recovery=manage',{waitUntil:'domcontentloaded'})
  await expect(page.getByText('云同步高级恢复（S2）')).toBeVisible({timeout:30000})
  const apply=page.getByRole('button',{name:/⑤ 我已备份两端数据/})
  await expect(apply).toBeDisabled()
  const dl1=page.waitForEvent('download')
  await page.getByRole('button',{name:/① 下载本地完整 Backup V4/}).click()
  await downloadBytes(await dl1)
  const dl2=page.waitForEvent('download')
  await page.getByRole('button',{name:/② 下载云端原始 Backup V4/}).click()
  await downloadBytes(await dl2)
  await page.getByLabel('已确认本地备份保存成功').check()
  await page.getByLabel('已确认云端原始备份保存成功').check()
  await page.locator('select').selectOption(choice)
  await page.getByLabel('确认不可变账户 ID').fill('wrong-id')
  await expect(apply).toBeDisabled()
  await page.getByLabel('确认不可变账户 ID').fill(owner)
  await expect(apply).toBeEnabled()
  page.once('dialog',d=>cancel?d.dismiss():d.accept())
  await apply.click()
  if(cancel) {
    await expect(page.getByText(/用户取消/)).toBeVisible({timeout:15000})
    expect((await getMeta(page)).revision).toBe(before.revision)
    return before.revision
  }
  if(choice==='keep-local') {
    await expect(page.getByText(/已按确认保留本机学习记录，云端现为 V4 revision/))
      .toBeVisible({timeout:90000})
    await expect.poll(async()=>(await getMeta(page)).revision,{timeout:30000})
      .toBe(before.revision+1)
  } else {
    await expect.poll(async()=>!new URL(page.url()).searchParams.has('s2-recovery'),
      {timeout:90000}).toBe(true)
    await page.goto(base,{waitUntil:'domcontentloaded'})
    expect((await getMeta(page)).revision).toBe(before.revision)
  }
  return before.revision
}
test('cross-account LOCAL/CLOUD Backup V4: empty, identical, divergent, both overwrites and cancellation',async({browser})=>{
  test.setTimeout(1_200_000)
  expect(process.env.GITHUB_REF_NAME).toBe('qa/etest-cross-account-backup-matrix-20261015')
  expect(prefix).toMatch(/^e2e_xa_[0-9]+_[0-9]+$/)
  expect(password.length).toBeGreaterThanOrEqual(20)
  const contexts:BrowserContext[]=[]
  const make=async()=>{const c=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'})
    contexts.push(c);const p=await c.newPage()
    p.on('dialog',d=>{
      const choice=dialogChoices.get(p)
      dialogChoices.delete(p)
      void (choice==='dismiss'||(!choice&&d.message().includes('复制到新账户'))
        ?d.dismiss():d.accept()).catch(()=>{})
    })
    return p
  }
  try{
    const A=await make(),aId=await open(A,'a')
    await learn(A,2)
    const aLocal=await localExport(A)
    await sync(A,'upload')
    const aCloud=await cloudExport(A)
    add('A-source-local-and-cloud','two-real-Learn-records',2,(await getMeta(A)).revision)

    // Path 1: local portable backup -> new target with no cloud -> CAS push.
    const B=await make(),bId=await open(B,'b')
    expect((await getMeta(B)).hasData).toBe(false)
    await importV4(B,aLocal,bId)
    expect(await learnRows(B)).toBe(2)
    await sync(B,'upload')
    expect((await getMeta(B)).hasData).toBe(true)
    add('local-A-to-empty-B','push',2,(await getMeta(B)).revision)
    await importV4(B,aLocal,bId)
    await sync(B,'noop')
    add('local-A-to-equal-B','noop',2,(await getMeta(B)).revision)

    // Path 2: cloud export A -> new target with no cloud -> CAS push.
    const C=await make(),cId=await open(C,'c')
    expect((await getMeta(C)).hasData).toBe(false)
    await importV4(C,aCloud,cId)
    expect(await learnRows(C)).toBe(2)
    await sync(C,'upload')
    add('cloud-A-to-empty-C','push',2,(await getMeta(C)).revision)
    await importV4(C,aCloud,cId)
    await sync(C,'noop')
    add('cloud-A-to-equal-C','noop',2,(await getMeta(C)).revision)

    // Divergent target D has its own independent Learn record in cloud.
    const D=await make(),dId=await open(D,'d')
    await learn(D,1)
    const dLocal=await localExport(D)
    await sync(D,'upload')
    const dCloud=await cloudExport(D)
    const originalD=await getMeta(D)
    expect(originalD.hasData).toBe(true)
    add('target-D-independent','one-real-Learn-record',1,originalD.revision)

    // Local A -> existing D cloud; first abort the import confirmation.
    await importV4(D,aLocal,dId,true)
    expect(await learnRows(D)).toBe(1)
    await importV4(D,aLocal,dId)
    expect(await learnRows(D)).toBe(2)
    await sync(D,'conflict')
    expect((await getMeta(D)).revision).toBe(originalD.revision)
    await advanced(D,dId,'keep-local',true)
    expect((await getMeta(D)).revision).toBe(originalD.revision)
    add('local-A-versus-cloud-D','conflict-preserved-both',2,originalD.revision)

    // Explicit KEEP CLOUD: restore D's one real record, do not advance revision.
    await advanced(D,dId,'keep-cloud')
    await expect.poll(()=>learnRows(D),{timeout:40000}).toBe(1)
    expect((await getMeta(D)).revision).toBe(originalD.revision)
    await sync(D,'noop')
    add('local-source-keep-cloud','local-restored-cloud-unchanged',1,originalD.revision)

    // Cloud-exported A -> D's divergent cloud, then KEEP LOCAL (replace cloud).
    await importV4(D,aCloud,dId)
    await sync(D,'conflict')
    await advanced(D,dId,'keep-local')
    expect(await learnRows(D)).toBe(2)
    expect((await getMeta(D)).revision).toBe(originalD.revision+1)
    await sync(D,'noop')
    add('cloud-source-keep-local','cloud-overwritten-CAS',2,originalD.revision+1)

    // Opposite choices: imported LOCAL D -> B's cloud A2, KEEP LOCAL.
    const bPrior=await getMeta(B)
    await importV4(B,dLocal,bId)
    await sync(B,'conflict')
    await advanced(B,bId,'keep-local')
    await expect.poll(()=>learnRows(B)).toBe(1)
    expect((await getMeta(B)).revision).toBe(bPrior.revision+1)
    await sync(B,'noop')
    add('local-source-keep-local','explicit-cloud-overwrite',1,bPrior.revision+1)

    // Imported CLOUD D -> C's cloud A2, KEEP CLOUD.
    const cPrior=await getMeta(C)
    await importV4(C,dCloud,cId)
    await sync(C,'conflict')
    await advanced(C,cId,'keep-cloud')
    await expect.poll(()=>learnRows(C)).toBe(2)
    expect((await getMeta(C)).revision).toBe(cPrior.revision)
    await sync(C,'noop')
    add('cloud-source-keep-cloud','explicit-local-restore',2,cPrior.revision)

    // Source owners cannot be stolen: A remained untouched throughout.
    expect(await learnRows(A)).toBe(2)
    expect((await accountId(A))).toBe(aId)
    add('source-A-untouched','ownership-isolated',2)
  }finally{
    await Promise.all(contexts.map(c=>c.close().catch(()=>{})))
    console.log('CROSS_ACCOUNT_REDACTED_CHECKPOINTS',JSON.stringify(checkpoints))
  }
})
