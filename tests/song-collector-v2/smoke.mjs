import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const base = process.env.SONG_COLLECTOR_URL || 'http://127.0.0.1:4321'
const dir = 'tests/song-collector-v2/artifacts'
await mkdir(dir, {recursive:true})
const browser = await chromium.launch({headless:true})

/** Browser fixture only: seed genuine Learn WordRecord-shaped evidence into
 * an isolated ephemeral IndexedDB. Never award states or bypass product access.
 */
async function addLearnDays(page, dayOffsets) {
  await page.evaluate(async offsets => {
    const request=indexedDB.open('RecordDB')
    const database=await new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
    })
    try {
      const tx=database.transaction('wordRecords','readwrite')
      const table=tx.objectStore('wordRecords')
      for(const offset of offsets){
        const d=new Date()
        d.setHours(0,1,0,0)
        d.setDate(d.getDate()-offset)
        table.add({word:'test',dict:'test-dict',chapter:0,timeStamp:Math.floor(d.getTime()/1000),
          sourceMode:'learn',timing:[100],wrongCount:0,mistakes:{}})
      }
      await new Promise((resolve,reject)=>{
        tx.oncomplete=()=>resolve()
        tx.onerror=()=>reject(tx.error)
        tx.onabort=()=>reject(tx.error)
      })
    } finally {database.close()}
  },dayOffsets)
}

async function assertFocusBeforeUnlock(page) {
  await page.locator('[data-focus-achievement-gallery]').waitFor({timeout:20000})
  assert.equal(await page.getByRole('heading',{name:'成就'}).count(),1)
  assert.equal(await page.locator('.focus-achievements-item').count(),34)
  assert.equal(await page.locator('.focus-achievements-item:disabled').count(),34)
  assert.equal(await page.locator('.focus-achievements-item[data-unlocked="true"]').count(),0)
  assert.equal(await page.locator('.focus-achievements-item').first().isDisabled(),true)
  assert.equal(await page.locator('.focus-achievements-item').first().locator('img').count(),0)
  assert.equal(await page.locator('.song-v2-card,.song-v2-collection,.song-v2-header').count(),0,
    'Art collector must be entirely unmounted before qualified and explicitly chosen')
  assert.equal(await page.getByRole('button',{name:'开启宋韵雅藏'}).count(),0,
    'No decorative-mode entry before three consecutive Learn days')
  const secrets=page.locator('.focus-achievements-item:not([data-achievement-id])')
  assert.equal(await secrets.count(),5,'Real hidden awards never leak their title in Focus')
  assert.equal(await secrets.first().innerText().then(t=>t.includes('隐藏成就')),true)
}


async function checkDesktop() {
  const page = await browser.newPage({ viewport:{width:1440,height:900},reducedMotion:'no-preference' })
  const errors = []
  page.on('pageerror',e=>errors.push(e.message))
  try {
    await page.goto(base+'/learn', {waitUntil:'domcontentloaded'})
    await page.getByRole('button', { name: '查看成就' }).click()
    await assertFocusBeforeUnlock(page)
    // Two separate Learn days cannot open the illustrated collection.
    await addLearnDays(page,[2,1])
    await page.reload({waitUntil:'domcontentloaded'})
    await assertFocusBeforeUnlock(page)
    await addLearnDays(page,[0])
    await page.reload({waitUntil:'domcontentloaded'})
    await page.locator('[data-focus-achievement-gallery]').waitFor({timeout:20000})
    await page.getByRole('button',{name:'开启宋韵雅藏'}).waitFor()
    assert.equal(await page.locator('[data-song-achievement-gallery]').count(),0)
    await page.getByRole('button',{name:'开启宋韵雅藏'}).click()
    await page.locator('[data-song-achievement-gallery]').waitFor()
    assert.equal(await page.locator('[data-navigation-dialog="achievements"]').count(), 1)
    assert.equal(await page.locator('[data-navigation-dialog="achievements"] .focus-overlay-header').count(),0,'No redundant achievement header')
    const cards=page.locator('.song-v2-card')
    assert.equal(await cards.count(),34,'Full 34-achievement catalogue should be visible')
    const visualGroups=[['ink',10,'素笺墨印'],['celadon',10,'汝窑天青'],
      ['cinnabar',8,'泥金朱砂'],['hidden',6,'云中秘藏']]
    assert.equal(await page.locator('.song-v2-card:disabled').count(),34,
      'Fresh account must have exactly 34 inert locked cards')
    assert.equal(await page.locator('.song-v2-card[data-art-source="locked-tier"]').count(),34)
    assert.equal(await page.locator('img.song-v2-card-full-illustration').count(),0,
      'Locked gallery must not mount any bespoke art')
    assert.equal(await page.locator('.song-v2-plaque-lettering, .song-v2-plaque-frame, .song-v2-shared-ornaments, .song-v2-card-lock-mist, .song-v2-card-status').count(),0,
      'Locked cards must contain only their level background and optional title')
    for(const [tier,count,label] of visualGroups){
      const group=page.locator('.song-v2-card[data-tier="'+tier+'"]')
      assert.equal(await group.count(),count,'Locked group '+label)
      for(const card of await group.all()){
        const img=card.locator('.song-v2-locked-background')
        assert.equal(await img.count(),1,tier+' must have one tier-specific background')
        const url=await img.getAttribute('src')
        assert.ok(url?.endsWith('/assets/achievements/song/locked/'+tier+'.webp'),tier)
        const response=await page.request.get(new URL(url,base).toString())
        assert.equal(response.status(),200,tier+' background reachable')
        assert.ok((response.headers()['content-type']||'').includes('image/webp'))
        // Browser loading="lazy" defers offscreen images; scroll before decode
        // to avoid waiting forever on a card below the fold.
        await img.scrollIntoViewIfNeeded()
        await img.evaluate(el=>el.decode())
        assert.deepEqual(await img.evaluate(el=>[el.naturalWidth,el.naturalHeight]),[960,1391])
        const inner=(await card.innerText()).trim()
        if(tier==='hidden'){
          assert.equal(inner,'','Secret locked card may not show ANY words')
          assert.equal(await card.locator('.song-v2-locked-name').count(),0)
          assert.ok((await card.getAttribute('aria-label')).startsWith('秘藏'))
        }else{
          assert.equal(await card.locator('.song-v2-locked-name').count(),1)
          assert.equal(inner,await card.locator('.song-v2-locked-name').innerText(),
            tier+' must show ONLY its own achievement title')
          assert.ok(inner.length>0)
        }
      }
    }
    const forbiddenPaths=['/first-batch/','/second-batch/','/third-batch/','/final-batch/']
    const mountedSources=await page.locator('.song-v2-card img').evaluateAll(imgs=>imgs.map(el=>el.src))
    assert.equal(mountedSources.filter(src=>forbiddenPaths.some(path=>src.includes(path))).length,0,
      'Locked catalogue must not mount individual achievement images')
    for(const [key,count,label] of visualGroups){
      await page.getByRole('button',{name:(key==='hidden'?'秘藏':label.slice(0,2))+' ('+count+')'}).click()
      assert.equal(await cards.count(),count,'Filter '+label)
    }
    await page.getByRole('button',{name:'全部 (34)'}).click()
    const gallery = page.locator('.song-v2-grid')
    const countColumns = () => gallery.evaluate(x=>getComputedStyle(x).gridTemplateColumns.split(' ').filter(Boolean).length)
    const wideColumns=await countColumns()
    assert.equal(wideColumns,4,'wide desktop should grow to four portrait columns')
    // Resize *the grid itself* to exercise actual container width, independent
    // of device/user-agent labels and without remounting the Learn workspace.
    for (const [width,expected] of [[500,2],[790,3]]) {
      await gallery.evaluate((node,w)=>{node.style.width=w+'px'},width)
      assert.equal(await countColumns(),expected,
        'container '+width+'px should produce '+expected+' columns')
    }
    await gallery.evaluate(node=>node.style.removeProperty('width'))
    assert.equal(await countColumns(),wideColumns,'restoring available width restores columns')
    const cardWidths=await cards.evaluateAll(nodes=>[
      nodes[0].getBoundingClientRect().width,
      nodes[nodes.length-1].getBoundingClientRect().width,
    ])
    assert.ok(Math.abs(cardWidths[0]-cardWidths[1])<2,
      'Incomplete last row must not stretch cards: '+JSON.stringify(cardWidths))
    const box=await cards.first().boundingBox()
    const ratio=box.width/box.height
    console.log('Portrait card desktop geometry', box, 'ratio',ratio)
    assert.ok(ratio>.63&&ratio<.76,'portrait card ratio target ≈ 0.69')
    const sprite=await page.locator('[data-song-achievement-gallery]').evaluate(el=>getComputedStyle(el).getPropertyValue('--song-sprite-url'))
    console.log('Actual raster sprite',sprite)
    assert.match(sprite,/gallery\/sprite.webp/)
    const imageUrl=new URL(sprite.match(/url\(["']?([^"')]+)["']?\)/)[1],base)
    const resp=await page.request.get(imageUrl.toString())
    assert.equal(resp.status(),200,'real reference art image loaded')
    assert.match(resp.headers()['content-type']||'',/image\/webp/)
    const lockedCards = page.locator('.song-v2-card[data-unlocked="false"]')
    assert.equal(await lockedCards.count(),34)
    assert.equal(await page.locator('.song-v2-card-lock-mist').count(),0)
    assert.equal(await page.locator('.song-v2-card[data-tier="hidden"] .song-v2-card-text').count(),0)
    await page.screenshot({path:dir+'/desktop.png',fullPage:false})
    // Locked cards are inert: neither pointer nor keyboard nor synthetic click opens a detail.
    assert.equal(await lockedCards.first().isDisabled(),true,'unlocked-only interaction gate')
    await lockedCards.first().evaluate(el=>el.click())
    assert.equal(await page.locator('.song-v2-detail').count(),0,'locked programmatic click must not show a detail')
    assert.equal(await page.locator('.song-v2-card:disabled').count(),await lockedCards.count())
    await page.getByRole('button',{name:'展卷演示'}).click()
    await page.locator('.song-v2-detail').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.song-v2-detail').waitFor({state:'detached'})
    await page.getByRole('button',{name:'展卷演示'}).click()
    await page.locator('.song-v2-detail').waitFor()
    await page.getByRole('button',{name:'重播钤印'}).click()
    await page.getByRole('button',{name:'关闭藏品'}).click()
    await page.getByRole('button',{name:'夜卷'}).click()
    assert.equal(await page.locator('[data-song-achievement-gallery]').getAttribute('data-song-theme'),'dark')
    assert.equal(await page.locator('.song-v2-card[data-tier="hidden"] .song-v2-locked-name').count(),0)
    assert.equal(await page.locator('.song-v2-card-lock-mist').count(),0)
    await page.screenshot({path:dir+'/desktop-dark-locked.png',fullPage:false})
    await page.getByRole('button',{name:'返回简洁版'}).click()
    await page.locator('[data-focus-achievement-gallery]').waitFor()
    assert.equal(await page.locator('[data-song-achievement-gallery]').count(),0,
      'Returning to Focus must unmount Song art again')
    assert.deepEqual(errors,[], 'No runtime exceptions')
  } finally {await page.close()}
}

async function checkMobile() {
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  try{
    await page.goto(base+'/achievements',{waitUntil:'domcontentloaded'})
    await assertFocusBeforeUnlock(page)
    await addLearnDays(page,[2,1,0])
    await page.reload({waitUntil:'domcontentloaded'})
    await page.locator('[data-focus-achievement-gallery]').waitFor({timeout:20000})
    await page.getByRole('button',{name:'开启宋韵雅藏'}).click()
    await page.locator('[data-song-achievement-gallery]').waitFor()
    const n=await page.locator('.song-v2-grid').evaluate(x=>getComputedStyle(x).gridTemplateColumns.split(' ').filter(Boolean).length)
    assert.equal(n,2,'390px phone naturally fits two portrait cards')
    assert.equal(await page.locator('.song-v2-card').count(),34)
    assert.equal(await page.locator('.song-v2-card[data-art-source="locked-tier"]').count(),34)
    assert.equal(await page.locator('.song-v2-card:disabled').count(),34,
      'Fresh local profile has no unlocked cards; all must be inert')
    const lockedArt=page.locator('.song-v2-card[data-locked-tier="celadon"] .song-v2-locked-background').first()
    await lockedArt.scrollIntoViewIfNeeded()
    await lockedArt.evaluate(img=>img.decode())
    await page.setViewportSize({width:320,height:844})
    const narrow=await page.locator('.song-v2-grid').evaluate(x=>
      getComputedStyle(x).gridTemplateColumns.split(' ').filter(Boolean).length)
    assert.equal(narrow,1,'320px phone should automatically use one column')
    const narrowDims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}))
    assert.ok(narrowDims.width<=narrowDims.viewport+2,
      '320px gallery must not overflow '+JSON.stringify(narrowDims))
    await page.setViewportSize({width:390,height:844})
    const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}))
    assert.ok(dims.width<=dims.viewport+2,'No horizontal overflow '+JSON.stringify(dims))
    await page.screenshot({path:dir+'/mobile.png',fullPage:false})
    await page.getByRole('button',{name:'夜卷'}).click()
    assert.equal(await page.locator('[data-song-achievement-gallery]').getAttribute('data-song-theme'),'dark')
    const mobileLocked=page.locator('.song-v2-card[data-unlocked="false"]')
    assert.ok(await mobileLocked.count()>0,'mobile locked card must be present')
    assert.equal(await page.locator('.song-v2-card-lock-mist').count(),0)
    assert.equal(await page.locator('.song-v2-card[data-tier="hidden"] .song-v2-locked-name').count(),0)
    await page.screenshot({path:dir+'/mobile-dark-locked.png',fullPage:false})
    await page.getByRole('button',{name:'展卷演示'}).click()
    await page.locator('.song-v2-detail').waitFor()
    await page.getByRole('button',{name:'关闭藏品'}).click()
    assert.deepEqual(errors,[],'No mobile runtime exception')
  }finally{await context.close()}
}
async function checkCompleteMuseum() {
  const context=await browser.newContext({viewport:{width:1365,height:850}})
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await context.addInitScript(() => {
    indexedDB.open=()=>{throw new Error('Read-only museum must never open IndexedDB')}
  })
  try{
    const response=await page.goto(base+'/preview/song-complete/',{waitUntil:'domcontentloaded'})
    assert.equal(response?.status(),200,'Direct showroom link serves actual HTML')
    await page.locator('[data-showcase-all-unlocked="true"]').waitFor({timeout:20000})
    const cards=page.locator('.song-v2-card')
    assert.equal(await cards.count(),34,'Exactly 34 works')
    assert.equal(await page.locator('.song-v2-card[data-unlocked="true"]').count(),34)
    assert.equal(await page.locator('.song-v2-card:disabled').count(),0)
    assert.equal(await page.locator('img.song-v2-card-full-illustration').count(),34)
    const visualCounts=[['ink',10],['celadon',10],['cinnabar',8],['hidden',6]]
    for(const [name,n] of visualCounts) {
      assert.equal(await page.locator('.song-v2-card[data-tier="'+name+'"]').count(),n,
        'Full museum artistically arranged '+name)
    }
    assert.equal(await page.locator('.song-v2-card[data-plaque-source="art"]').count(),20)
    assert.equal(await page.locator('.song-v2-card[data-plaque-source="overlay"]').count(),14)
    assert.equal(await page.getByRole('button',{name:/传奇/}).count(),0,
      'Legendary should not appear as a visual tier in the preview')
    for(const source of ['first-batch','second-batch']) {
      const exemplar=page.locator('.song-v2-card img[src*="/'+source+'/"]').first().locator('..')
      const box=exemplar.locator('.song-v2-card-tier')
      const style=await box.evaluate(node=>{
        const cs=getComputedStyle(node)
        return {background:cs.backgroundColor,border:cs.borderTopStyle,shadow:cs.boxShadow}
      })
      assert.equal(style.background,'rgba(0, 0, 0, 0)',source+' painted frame must be reused')
      assert.equal(style.border,'none')
      assert.equal(style.shadow,'none')
    }
    await page.getByRole('button',{name:'秘藏 (6)'}).click()
    assert.equal(await cards.count(),6)
    await page.getByRole('button',{name:'全部 (34)'}).click()

    const allIds=await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.achievementId))
    assert.equal(new Set(allIds).size,34,'All IDs unique')
    const ids=['ACH_MASTERED_1000','ACH_HIDDEN_90_DIFFICULT','ACH_HIDDEN_CRAFT',
      'ACH_HIDDEN_DAWN','ACH_HIDDEN_FINISH_STRONG','ACH_HIDDEN_SMALL_STEPS']
    for(const id of ids) {
      const card=page.locator('.song-v2-card[data-achievement-id="'+id+'"]')
      assert.equal(await card.count(),1,id)
      const art=card.locator('img.song-v2-card-full-illustration')
      const src=await art.getAttribute('src')
      assert.ok(src?.endsWith('/assets/achievements/song/final-batch/'+id+'.webp'),id)
      const resp=await page.request.get(new URL(src,base).toString())
      assert.equal(resp.status(),200,id)
      assert.ok((resp.headers()['content-type']||'').includes('image/webp'),id)
    }
    const carved=page.locator('.song-v2-card[data-achievement-id="ACH_HIDDEN_CRAFT"]')
    await carved.scrollIntoViewIfNeeded()
    await carved.locator('img.song-v2-card-full-illustration').evaluate(img=>img.decode())
    await carved.click()
    await page.getByRole('dialog',{name:/如琢如磨/}).waitFor()
    await page.getByRole('button',{name:'重播钤印'}).click()
    await page.getByRole('button',{name:'收卷入藏'}).click()
    await page.getByRole('button',{name:'夜卷'}).click()
    assert.equal(await page.locator('[data-showcase-all-unlocked="true"]').getAttribute('data-song-theme'),'dark')
    await page.screenshot({path:dir+'/complete-museum-desktop.png',fullPage:false})
    const data=await page.evaluate(async()=>({
      local:localStorage.length,session:sessionStorage.length,dbs:(await indexedDB.databases()).length,
    }))
    assert.deepEqual(data,{local:0,session:0,dbs:0},'No learning data touched')
    assert.deepEqual(errors,[])
  }finally{await context.close()}
  const mobile=await browser.newPage({viewport:{width:390,height:844}})
  try{
    await mobile.goto(base+'/preview/song-complete/',{waitUntil:'domcontentloaded'})
    await mobile.locator('[data-showcase-all-unlocked="true"]').waitFor()
    assert.equal(await mobile.locator('.song-v2-card').count(),34)
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2))
    await mobile.screenshot({path:dir+'/complete-museum-mobile.png',fullPage:false})
  }finally{await mobile.close()}
}

try{
  await checkDesktop()
  await checkMobile()
  await checkCompleteMuseum()
  console.log('PASS Song portrait collection and 34/34 read-only showroom')
}finally{await browser.close()}
