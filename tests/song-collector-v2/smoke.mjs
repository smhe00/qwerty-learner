import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const base = process.env.SONG_COLLECTOR_URL || 'http://127.0.0.1:4321'
const dir = 'tests/song-collector-v2/artifacts'
await mkdir(dir, {recursive:true})
const browser = await chromium.launch({headless:true})

async function checkDesktop() {
  const page = await browser.newPage({ viewport:{width:1440,height:900},reducedMotion:'no-preference' })
  const errors = []
  page.on('pageerror',e=>errors.push(e.message))
  try {
    await page.goto(base+'/learn', {waitUntil:'domcontentloaded'})
    await page.getByRole('button', { name: '查看成就' }).click()
    await page.locator('[data-song-achievement-gallery]').waitFor({timeout:20000})
    assert.equal(await page.locator('[data-navigation-dialog="achievements"]').count(), 1)
    assert.equal(await page.locator('[data-navigation-dialog="achievements"] .focus-overlay-header').count(),0,'No redundant achievement header')
    const cards=page.locator('.song-v2-card')
    assert.equal(await cards.count(),34,'Full 34-achievement catalogue should be visible')
    // Museum rank is the 10/10/8/6 ART batch, not the FSRS achievement rarity.
    const visualGroups=[['ink',10,'素笺墨印'],['celadon',10,'汝窑天青'],
      ['cinnabar',8,'泥金朱砂'],['hidden',6,'云中秘藏']]
    for(const [key,count,label] of visualGroups) {
      const group=page.locator('.song-v2-card[data-tier="'+key+'"]')
      assert.equal(await group.count(),count,'Visual tier '+label)
      assert.equal(await group.first().locator('.song-v2-card-tier').innerText(),label)
    }
    assert.equal(await page.locator('.song-v2-card[data-plaque-source="art"]').count(),20)
    assert.equal(await page.locator('.song-v2-card[data-plaque-source="overlay"]').count(),14)
    for(const source of ['first-batch','second-batch']) {
      const plaque=page.locator('.song-v2-card[data-art-source="'+source+'"] .song-v2-card-tier').first()
      const style=await plaque.evaluate(node=>{
        const css=getComputedStyle(node)
        return {background:css.backgroundColor,border:css.borderTopStyle,shadow:css.boxShadow,position:css.position}
      })
      assert.equal(style.background,'rgba(0, 0, 0, 0)',source+' must NOT draw a second oval')
      assert.equal(style.border,'none',source+' must NOT draw a second border')
      assert.equal(style.shadow,'none',source+' must NOT draw a second shadow')
      assert.equal(style.position,'absolute',source+' must align words to painted cartouche')
    }
    for(const [key,count,label] of visualGroups) {
      await page.getByRole('button',{name:(key==='hidden'?'秘藏':label.slice(0,2))+' ('+count+')'}).click()
      assert.equal(await cards.count(),count,'Filter '+label)
    }
    await page.getByRole('button',{name:'全部 (34)'}).click()
    assert.equal(await cards.count(),34)
    const illustrated=page.locator('.song-v2-card[data-art-source="first-batch"]')
    assert.equal(await illustrated.count(),10,
      'Ten first-batch art pieces are visible, including P1 catalogue items')
    for(const id of ['ACH_FIRST_DECODE','ACH_WARMING_UP','ACH_NEW_UNIT','ACH_DAILY_GOAL',
                     'ACH_7_OF_10','ACH_RECOVER_1','ACH_AUDIO_10','ACH_NO_HINT_10','ACH_7_DAY']){
      const card=page.locator('.song-v2-card[data-achievement-id="'+id+'"]')
      assert.equal(await card.getAttribute('data-art-source'),'first-batch',id)
      const art=card.locator('img.song-v2-card-full-illustration')
      const src=await art.getAttribute('src')
      assert.ok(src?.endsWith('/assets/achievements/song/first-batch/'+id+'.webp'),id)
      const response=await page.request.get(new URL(src,base).toString())
      assert.equal(response.status(),200,id+' bespoke artwork must return HTTP 200')
      assert.match(response.headers()['content-type']||'',/image\/webp/,id)
    }
    const batch2Ids=['ACH_20_OF_30','ACH_CONTINUE','ACH_HINT_REDUCTION',
      'ACH_AUDIO_50','ACH_RECOVER_3','ACH_SPACED_20','ACH_CHAPTER_80',
      'ACH_30_DAY','ACH_TRUE_MEMORY','ACH_OLD_RIVAL']
    assert.equal(await page.locator('.song-v2-card[data-art-source="second-batch"]').count(),10)
    for(const id of batch2Ids){
      const card=page.locator('.song-v2-card[data-achievement-id="'+id+'"]')
      assert.equal(await card.getAttribute('data-art-source'),'second-batch',id)
      const src=await card.locator('.song-v2-card-full-illustration').getAttribute('src')
      assert.ok(src?.endsWith('/assets/achievements/song/second-batch/'+id+'.webp'),id)
      const response=await page.request.get(new URL(src,base).toString())
      assert.equal(response.status(),200,id)
      assert.ok((response.headers()['content-type']||'').includes('image/webp'),id)
    }
    const batch3Ids=['ACH_NO_HINT_25','ACH_ERROR_POSITION_FIXED',
      'ACH_FAILURE_RECOVERY_SESSION','ACH_WEEKLY_GAIN','ACH_MASTERED_100',
      'ACH_MASTERED_500','ACH_RECOVER_5_STABLE','ACH_90_DAY']
    assert.equal(await page.locator('.song-v2-card[data-art-source="third-batch"]').count(),8,
      'Third generation must contain exactly 8 real artwork cards')
    for(const id of batch3Ids) {
      const card=page.locator('.song-v2-card[data-achievement-id="'+id+'"]')
      assert.equal(await card.getAttribute('data-art-source'),'third-batch',id)
      const url=await card.locator('img.song-v2-card-full-illustration').getAttribute('src')
      assert.ok(url?.endsWith('/assets/achievements/song/third-batch/'+id+'.webp'),id)
      const response=await page.request.get(new URL(url,base).toString())
      assert.equal(response.status(),200,'third-batch asset '+id)
      assert.ok((response.headers()['content-type']||'').includes('image/webp'),id)
    }
    assert.equal(await page.locator('.song-v2-card[data-art-source="final-batch"]').count(),1,
      'Only the non-hidden final-batch award may load bespoke art in an unearned profile')
    const realHidden=['ACH_HIDDEN_90_DIFFICULT','ACH_HIDDEN_CRAFT','ACH_HIDDEN_DAWN',
      'ACH_HIDDEN_FINISH_STRONG','ACH_HIDDEN_SMALL_STEPS']
    for(const id of realHidden)
      assert.equal(await page.locator('img[src*="final-batch/'+id+'.webp"]').count(),0,
        'Never request real hidden artwork in a locked account: '+id)
    assert.equal(await page.locator('.song-v2-card[data-art-source="sprite"]').count(),5)
    const thirdArt=page.locator('.song-v2-card[data-art-source="third-batch"]').first().locator('img.song-v2-card-full-illustration')
    await thirdArt.scrollIntoViewIfNeeded()
    await thirdArt.evaluate(img=>img.decode())
    assert.deepEqual(await thirdArt.evaluate(img=>[img.naturalWidth,img.naturalHeight]),[640,928],
      'Third-batch PNG-derived WebP decoded at expected size')
    const secondArt=page.locator('.song-v2-card[data-art-source="second-batch"]').first().locator('img.song-v2-card-full-illustration')
    await secondArt.scrollIntoViewIfNeeded()
    await secondArt.evaluate(img=>img.decode())
    assert.deepEqual(await secondArt.evaluate(img=>[img.naturalWidth,img.naturalHeight]),[640,928],
      'Second-batch real WebP resolution')
    const firstArt=illustrated.first().locator('.song-v2-card-full-illustration')
    await firstArt.scrollIntoViewIfNeeded()
    await firstArt.evaluate(img=>img.decode())
    assert.deepEqual(await firstArt.evaluate(img=>[img.naturalWidth,img.naturalHeight]),[960,1391],
      'Bespoke first-batch WebP decodes at portrait aspect ratio')
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
    assert.ok(await lockedCards.count()>0,'At least one locked card is present')
    assert.equal(await page.locator('.song-v2-card[data-unlocked="true"] .song-v2-card-lock-mist').count(),0,
      'Unlocked awards never receive a cloud veil')
    assert.equal(await page.locator('.song-v2-card-lock-mist').count(),await lockedCards.count(),
      'Every locked card has a full-card mist overlay')
    const geometry = await lockedCards.first().evaluate(card => {
      const cardBox = card.getBoundingClientRect()
      const overlayBox = card.querySelector('.song-v2-card-lock-mist').getBoundingClientRect()
      return {
        width:overlayBox.width/cardBox.width,
        height:overlayBox.height/cardBox.height,
        left:overlayBox.left-cardBox.left,
        top:overlayBox.top-cardBox.top,
      }
    })
    assert.ok(geometry.width>.97 && geometry.height>.97,
      'Cloud veil must cover full card, not only illustration: '+JSON.stringify(geometry))
    assert.equal(Math.abs(geometry.left)<2 && Math.abs(geometry.top)<2,true,
      'Fog layer aligned to card edges')
    const mistImage=page.locator('.song-v2-card-lock-mist .song-picture-mist-near').first()
    await mistImage.evaluate(image => image.decode())
    assert.equal(await mistImage.evaluate(image => image.naturalWidth>0),true,
      'Real WebP fog decoded (not a gradient-only fallback)')
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
    const darkTiers=await page.locator('.song-v2-card-tier').evaluateAll(nodes => {
      const luminance = color => {
        const channels=(color.match(/[0-9.]+/g)||[]).slice(0,3).map(Number)
        const linear=channels.map(channel=>{
          const c=channel/255
          return c<=.04045 ? c/12.92 : Math.pow((c+.055)/1.055,2.4)
        })
        return .2126*linear[0]+.7152*linear[1]+.0722*linear[2]
      }
      return nodes.map(node=>{
        const css=getComputedStyle(node)
        const a=luminance(css.color),b=luminance(css.backgroundColor)
        return {text:node.textContent.trim(),ink:css.color,paper:css.backgroundColor,
          contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
      })
    })
    assert.ok(darkTiers.length>0 && darkTiers.every(item=>item.text && item.contrast>=4.5),
      'All dark rarity labels must be readable: '+JSON.stringify(darkTiers))
    await page.locator('.song-v2-card-lock-mist .song-picture-mist-near').first().evaluate(img=>img.decode())
    await page.screenshot({path:dir+'/desktop-dark-locked.png',fullPage:false})
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
    await page.locator('[data-song-achievement-gallery]').waitFor({timeout:20000})
    const n=await page.locator('.song-v2-grid').evaluate(x=>getComputedStyle(x).gridTemplateColumns.split(' ').filter(Boolean).length)
    assert.equal(n,2,'390px phone naturally fits two portrait cards')
    assert.equal(await page.locator('.song-v2-card').count(),34)
    assert.equal(await page.locator('.song-v2-card[data-art-source="third-batch"]').count(),8)
    assert.equal(await page.locator('.song-v2-card:disabled').count(),34,
      'Fresh local profile has no unlocked cards; all must be inert')
    const customArt=page.locator('.song-v2-card[data-art-source="first-batch"]')
    assert.equal(await customArt.count(),10)
    await customArt.first().scrollIntoViewIfNeeded()
    await customArt.first().locator('.song-v2-card-full-illustration').evaluate(img=>img.decode())
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
    assert.equal(await page.locator('.song-v2-card-lock-mist').count(),await mobileLocked.count())
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
    await carved.locator('img').evaluate(img=>img.decode())
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
