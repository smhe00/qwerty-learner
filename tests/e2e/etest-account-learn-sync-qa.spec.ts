import { expect, test, type Page, type BrowserContext } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const base = 'https://etest.edgeone.dev/'
const user = process.env.QWERTY_E2E_USERNAME
const password = process.env.QWERTY_E2E_PASSWORD

async function owner(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('qwerty.cloudAuth.v1')
    return raw ? JSON.parse(raw)?.user?.username : null
  }).catch(() => null)
}

async function readLearn(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, bad) => {
      const r = indexedDB.open('RecordDB')
      r.onerror = () => bad(r.error)
      r.onsuccess = () => ok(r.result)
    })
    try {
      const rows = await new Promise<Array<{word?: string,sourceMode?: string}>>((ok, bad) => {
        const tx = db.transaction('wordRecords', 'readonly')
        const r = tx.objectStore('wordRecords').getAll()
        r.onsuccess = () => ok(r.result)
        r.onerror = () => bad(r.error)
      })
      return {learnRows: rows.filter(r => r.sourceMode === 'learn').length,
        allRows: rows.length}
    } finally { db.close() }
  })
}

async function enterAccount(page: Page, register: boolean) {
  await page.goto(base + '?s1-account=manage', {waitUntil: 'domcontentloaded'})
  const dialog = page.getByRole('dialog', {name:'安全账户管理（S1）'})
  if (!await dialog.isVisible().catch(() => false)) {
    await page.goto(base + '?s1-account=manage', {waitUntil:'domcontentloaded'})
  }
  await expect(dialog).toBeVisible({timeout: 30000})
  await page.getByPlaceholder('用户名').fill(user!)
  await page.getByPlaceholder('账户密码').fill(password!)
  if (register) await page.getByPlaceholder('注册密码确认').fill(password!)
  await page.getByRole('button',{name:register?'注册新账户':'登录已有账户'}).click()
  await expect.poll(()=>owner(page), {timeout:60000}).toBe(user)
  await page.goto(base, {waitUntil:'domcontentloaded'})
}

async function manualSync(page: Page, checkpoint: string) {
  await page.goto(base, {waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'打开设置对话框'}).click()
  await page.getByRole('tab',{name:'数据设置'}).click()
  const button = page.getByRole('button',{name:'立即同步'})
  await expect(button).toBeEnabled({timeout:15000})
  await button.click()
  const message = await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('qwerty.s2.last-sync-result')), {
      timeout:90000, message:'S2 sync outcome after '+checkpoint
    }).toMatch(/同步完成：/)
  const value = await page.evaluate(() => sessionStorage.getItem('qwerty.s2.last-sync-result'))
  expect(value).toContain('同步完成：')
  return value
}

test('etest actual Learn -> manual V4 sync -> other isolated browser restore -> refresh', async ({browser}) => {
  test.setTimeout(280000)
  expect(process.env.GITHUB_REF_NAME).toBe('qa/etest-e2e-audit-20261015')
  expect(user).toMatch(/^e2e_mc_[0-9]+_[0-9]+_a$/)
  expect(password?.length).toBeGreaterThanOrEqual(20)
  const checkpoints: Array<{event:string,count?:number,result?:string}> = []
  const contexts: BrowserContext[] = []
  const open = async () => {
    const context=await browser.newContext({serviceWorkers:'block'})
    contexts.push(context)
    const page=await context.newPage()
    page.on('dialog',dialog=>void dialog.dismiss().catch(()=>{}))
    return page
  }
  try {
    const a=await open()
    // Registration first asks to copy anonymous records. Keep test identity empty.
    await enterAccount(a,true)
    expect((await readLearn(a)).learnRows).toBe(0)
    checkpoints.push({event:'new-account-empty',count:0})
    await a.goto(base+'learn',{waitUntil:'domcontentloaded'})
    const prompt=a.getByText(/按任意键(?:开始|继续)/).first()
    const pause=a.getByRole('button',{name:'暂停',exact:true})
    if (await prompt.isVisible().catch(()=>false)) await a.keyboard.press('a')
    await expect(pause).toBeVisible({timeout:20000})
    for(let i=1;i<=2;i++){
      const word=a.locator('[data-typing-word]:visible').first()
      await expect(word).toHaveAttribute('data-typing-word',/\S+/,{timeout:20000})
      const spell=await word.getAttribute('data-typing-word')
      expect(spell).toBeTruthy()
      await a.keyboard.type(spell!)
      await expect.poll(async()=>(await readLearn(a)).learnRows,{timeout:25000}).toBe(i)
    }
    checkpoints.push({event:'learn-two-words',count:2})
    await a.reload({waitUntil:'domcontentloaded'})
    expect((await readLearn(a)).learnRows).toBe(2)
    checkpoints.push({event:'local-refresh-retains-two',count:2})
    const push=await manualSync(a,'browser A')
    expect(push).toMatch(/已安全上传|已经一致/)
    checkpoints.push({event:'A-manual-cloud-sync',result:'success'})
    const b=await open()
    await enterAccount(b,false)
    expect((await readLearn(b)).learnRows).toBe(0)
    checkpoints.push({event:'B-isolated-empty',count:0})
    const pull=await manualSync(b,'browser B')
    expect(pull).toMatch(/已安全恢复|已经一致/)
    await expect.poll(async()=>(await readLearn(b)).learnRows,{timeout:30000}).toBe(2)
    checkpoints.push({event:'B-restores-two',count:2})
    await b.reload({waitUntil:'domcontentloaded'})
    expect((await readLearn(b)).learnRows).toBe(2)
    checkpoints.push({event:'B-refresh-retains-two',count:2})
    expect((await readLearn(a)).learnRows).toBe(2)
  } finally {
    const filename=test.info().outputPath('etest-user-journey-redacted.json')
    mkdirSync(dirname(filename),{recursive:true})
    writeFileSync(filename, JSON.stringify({schema:'etest-e2e-user-journey-v1',checkpoints},null,2))
    await test.info().attach('etest-user-journey-redacted.json',
      {path:filename,contentType:'application/json'})
    await Promise.allSettled(contexts.map(c=>c.close()))
  }
})
