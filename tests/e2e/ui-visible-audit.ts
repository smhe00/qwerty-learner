import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'

const pageErrors = new WeakMap<Page, string[]>()

const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

/** Inspect painted production UI, not only DOM presence. Keep incomplete axe
 * checks in the artifact for manual review; never silently mark them passed. */
export async function auditVisibleUI(page: Page, info: TestInfo, state: string, expectedFault?: string) {
  const errors = pageErrors.get(page) ?? []
  expect.soft(expectedFault ? errors.filter((error) => error !== expectedFault) : errors, state + ' uncaught page errors').toEqual([])
  await page.addScriptTag({ content: axeSource })
  const audit = await page.evaluate(async () => {
    const result = await (window as any).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    })
    const compact = (items: any[]) =>
      items.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.map((node: any) => ({ target: node.target, summary: node.failureSummary, html: node.html })),
      }))
    const root = document.documentElement
    const geometry: string[] = []
    if (root.scrollWidth > innerWidth + 1) geometry.push(`document overflow: ${root.scrollWidth} > ${innerWidth}`)
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [role=button]:not([aria-disabled=true])',
      ),
    ]
    let visibleControls = 0
    for (const element of controls) {
      if (element.closest('[inert], [aria-hidden=true]')) continue
      // Closed details and intentionally screen-reader-only controls are not
      // painted actions. Their visible trigger is exercised by the journey.
      if (element.closest('[hidden]') || getComputedStyle(element).clip === 'rect(0px, 0px, 0px, 0px)') continue
      let collapsed = false
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element))
          collapsed = true
      }
      if (collapsed) continue
      const box = element.getBoundingClientRect(),
        css = getComputedStyle(element)
      if (!box.width || !box.height || css.visibility === 'hidden' || css.display === 'none') continue
      // Intersect with scrolling ancestors: an off-scroll form field is not a
      // covered visible action. Journey checks scroll primary actions into view.
      let left = Math.max(0, box.left),
        right = Math.min(innerWidth, box.right)
      let top = Math.max(0, box.top),
        bottom = Math.min(innerHeight, box.bottom)
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const s = getComputedStyle(parent),
          r = parent.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
          left = Math.max(left, r.left)
          right = Math.min(right, r.right)
        }
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) {
          top = Math.max(top, r.top)
          bottom = Math.min(bottom, r.bottom)
        }
      }
      if (right - left < 1 || bottom - top < 1) continue
      visibleControls++
      const label = (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 70)
      if (Number(css.opacity) === 0) geometry.push(`transparent control: ${label}`)
      // At least one point must actually receive the touch. Native controls and
      // their children count; scroll-offscreen content is tested by journeys.
      const points = [
        [0.5, 0.5],
        [0.2, 0.5],
        [0.8, 0.5],
      ]
        .map(([x, y]) => [left + (right - left) * x, top + (bottom - top) * y])
        .filter(([x, y]) => x >= 0 && x < innerWidth && y >= 0 && y < innerHeight)
      if (
        points.length &&
        !points.some(([x, y]) => {
          const hit = document.elementFromPoint(x, y)
          return hit === element || (hit !== null && element.contains(hit))
        })
      )
        geometry.push(`covered control: ${label}`)
    }
    return { violations: compact(result.violations), incomplete: compact(result.incomplete), geometry, visibleControls }
  })
  await info.attach(state + '.json', {
    body: JSON.stringify({ ...audit, pageErrors: errors, expectedFault }, null, 2),
    contentType: 'application/json',
  })
  if (
    audit.violations.length ||
    audit.geometry.length ||
    /^(pages-login|pages-register|home|learn-exposure|settings-save|circle-动态|song-gallery|song-detail|render-failure-recovery|settlement-complete)$/.test(state)
  )
    await page.screenshot({ path: info.outputPath(state + '.png'), fullPage: Boolean(audit.violations.length || audit.geometry.length) })
  expect.soft(audit.violations, state + ' accessibility').toEqual([])
  expect.soft(audit.geometry, state + ' touch/geometry').toEqual([])
  return audit
}

export async function prepareVisibleUI(page: Page, dark: boolean) {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' })
  await page.addInitScript((dark) => {
    localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(dark))
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('autoplay blocked', 'NotAllowedError'))
  }, dark)
  // No real customer account or external API is used in the UI-only matrix.
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: { ok: false, message: '界面验证：服务暂不可用，请重试' } }))
}
