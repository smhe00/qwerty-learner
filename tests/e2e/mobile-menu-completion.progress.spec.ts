import { expect, test } from '@playwright/test'

test('menu completion: concise daily summary preserves real counts, pending consolidation and error retry', async ({ page }) => {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
  // Render only the production presentation component with explicit inputs.
  // Do not alter the scheduler, current session, IndexedDB or live account.
  await page.addScriptTag({ type: 'module', content: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import Daily from '/src/pages/Mobile/MobileDailyProgress.tsx';
    const host = document.createElement('div');
    host.dataset.progressCopyFixture = '';
    document.body.append(host);
    const root = ReactDOM.createRoot(host);
    const progress = {completedNewWords:3,newTargetWords:5,completedReviewWords:2,
      reviewTargetWords:4,carryOverTargetWords:0,completedCarryOverWords:0,
      completedWords:5,targetWords:9,percent:500/9,remainingWords:4,complete:false,
      independentReviewWords:1,reviewWordsToConsolidate:1};
    window.__renderProgressCopy = mode => root.render(React.createElement(Daily, {
      summary:{progress: mode === 'error' ? null : {...progress,reviewWordsToConsolidate:mode === 'zero' ? 0 : 1},
        error:mode === 'error',retry:()=>{window.__progressCopyRetried=true;}}
    }));
    window.__renderProgressCopy('pending');
  ` })
  const fixture = page.locator('[data-progress-copy-fixture]')
  await expect(fixture.locator('[data-review-mastery]')).toHaveText('复习待巩固 1 词')
  await expect(fixture.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5')
  await expect(fixture.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '9')
  await expect(fixture).toContainText('今日已完成 5 词，还需练习 4 词')
  await expect(fixture).not.toContainText('系统会继续安排复习')
  await page.evaluate(() => (window as any).__renderProgressCopy('zero'))
  await expect(fixture.locator('[data-review-mastery]')).toHaveCount(0)
  await page.evaluate(() => (window as any).__renderProgressCopy('error'))
  await expect(fixture.getByRole('alert')).toContainText('暂时无法加载今日计划')
  await fixture.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__progressCopyRetried))).toBe(true)
})
