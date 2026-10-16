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
    assert.equal(await cards.count(),19,'P0 card count preserved')
    const gallery = page.locator('.song-v2-grid')
    const columns=await gallery.evaluate(x=>getComputedStyle(x).gridTemplateColumns.split(' ').filter(Boolean).length)
    assert.equal(columns,3,'desktop must be three-column gallery')
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
    await page.locator('.song-v2-card').first().click()
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
    assert.equal(n,2,'390px phone two-column collector')
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
try{
  await checkDesktop()
  await checkMobile()
  console.log('PASS song collector portrait gallery: desktop + mobile')
}finally{await browser.close()}
