"""Fix the synthetic phonetic test's phase; never changes application behavior."""
from pathlib import Path

file = Path('tests/e2e/mobile-menu-completion.spec.ts')
source = file.read_text()
old = """  await seedAcquisitionSession(page, [reviewWords[2]], 981024)
  await page.goto('/mobile/settings')
  await page.getByLabel('发音', { exact: true }).selectOption('us')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存在本机')
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-phonetic]')).toHaveAttribute('data-phonetic-voice', 'us', { timeout: 30_000 })
  await expect(page.locator('[data-mobile-phonetic]')).toContainText('/numərəs/')"""
new = """  // The default fixture is an independent recall probe, where showing an
  // answer phonetic would be wrong. Explicitly test the exposure stage.
  await seedAcquisitionSession(page, [reviewWords[2]], 981024, 'exposure')
  await page.goto('/mobile/settings')
  // Stay inside the router so init-script seeding cannot reset the voice
  // between Settings and Practice and mask a real persistence problem.
  for (const [voice, phonetic] of [['uk', '/njuːmərəs/'], ['us', '/numərəs/']]) {
    await page.getByLabel('发音', { exact: true }).selectOption(voice)
    await page.getByRole('button', { name: '保存设置' }).click()
    await expect(page.getByRole('status')).toContainText('设置已保存在本机')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pronunciation') || '{}').type)).toBe(voice)
    await page.getByRole('link', { name: '返回首页' }).click()
    await page.getByRole('link', { name: /^(开始手机学习|继续手机学习)$/ }).click()
    await expect(page.locator('[data-mobile-word-practice]')).toHaveAttribute('data-mobile-task', 'exposure')
    await expect(page.locator('[data-mobile-phonetic]')).toHaveAttribute('data-phonetic-voice', voice)
    await expect(page.locator('[data-mobile-phonetic]')).toContainText(phonetic)
    await page.getByRole('button', { name: '返回主菜单' }).click()
    await page.getByRole('link', { name: /^设置/ }).click()
  }"""
if old in source:
    file.write_text(source.replace(old, new, 1))
elif new not in source:
    raise RuntimeError('Phonetic test context changed')
