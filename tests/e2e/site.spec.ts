import { expect, test } from '@playwright/test'

const chartArticle = '/the-hidden-cost-behind-kotlin-multiplatform-on-ios/'
const diagramArticle = '/when-swifts-init-shorthand-gets-expensive/'

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('core pages load with their primary content', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kaan Biryol')
  await expect(page.getByRole('link', { name: 'All writing' })).toBeVisible()

  await page.goto('/writing/')
  await expect(page.getByRole('heading', { level: 1, name: 'Writing' })).toBeVisible()
  await expect(page.locator('main').getByRole('link')).not.toHaveCount(0)
})

test('article charts and controls initialize', async ({ page }, testInfo) => {
  await page.goto(chartArticle)

  const charts = page.locator('[data-chart][data-chart-ready="true"]')
  await expect(charts).toHaveCount(4)
  await expect(charts.locator('.data-chart__svg')).toHaveCount(4)
  await expect(page.locator('.reading-time')).toContainText(/\d+ min read/)
  await expect(page.getByRole('navigation', { name: 'More articles' })).toBeVisible()

  const mobileTableOfContents = page.locator('.mobile-toc')
  if (testInfo.project.name === 'mobile-webkit') {
    await expect(mobileTableOfContents).toBeVisible()
    await expect(mobileTableOfContents).not.toHaveAttribute('open', '')
    await mobileTableOfContents.locator('summary').click()
    await expect(mobileTableOfContents).toHaveAttribute('open', '')
    await expect(mobileTableOfContents.getByRole('link')).not.toHaveCount(0)
  } else {
    await expect(mobileTableOfContents).toBeHidden()
  }

  const pageWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport)
})

test('Mermaid diagrams render from the local bundle', async ({ page }) => {
  await page.goto(diagramArticle)

  const diagrams = page.locator('.mermaid')
  await expect(diagrams).toHaveCount(2)
  await expect(diagrams.locator('svg').first()).toBeVisible()

  const externalMermaidRequests = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.includes('cdn.jsdelivr.net/npm/mermaid'))
  )
  expect(externalMermaidRequests).toEqual([])
})
