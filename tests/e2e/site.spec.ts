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
  await expect(page.getByRole('link', { name: 'Writing', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('main').getByRole('link')).not.toHaveCount(0)
  await expect(page.locator('[data-topic-list]').first()).toBeVisible()

  const swiftTopic = page.getByRole('link', { name: 'swift', exact: true }).first()
  await expect(swiftTopic).toHaveAttribute('href', '/writing/topics/swift/')
  await swiftTopic.click()
  await expect(page).toHaveURL(/\/writing\/topics\/swift\/$/)
  await expect(page.getByRole('heading', { level: 1, name: 'swift' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Writing', exact: true })).toHaveAttribute('aria-current', 'location')
  await expect(page.getByRole('link', { name: 'swift', exact: true }).first()).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText(/^\d+ posts$/)).toBeVisible()
})

test('work links to each project showcase', async ({ page }) => {
  const projects = [
    { link: 'harbor', path: 'harbor', heading: 'Harbor' },
    { link: 'swift_unused_deps', path: 'swift-unused-deps', heading: 'swift_unused_deps' },
    { link: 'obsidian-crate', path: 'obsidian-crate', heading: 'Crate' },
    { link: 'init-revise-cli', path: 'init-revise-cli', heading: 'init-revise-cli' },
    { link: 'tuist-to-bazel', path: 'tuist-to-bazel', heading: 'tuist-to-bazel' }
  ]

  for (const project of projects) {
    await page.goto('/work/')
    await page.getByRole('link', { name: project.link, exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/work/${project.path}/$`))
    await expect(page.getByRole('heading', { level: 1, name: project.heading })).toBeVisible()
    await expect(page.getByRole('figure')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Work', exact: true })).toHaveAttribute('aria-current', 'location')

    const pageWidth = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: innerWidth
    }))
    expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport)
  }
})

test('swift_unused_deps tells the check, fix, and verification story', async ({ page }) => {
  await page.goto('/work/swift-unused-deps/')

  await expect(page.getByLabel('swift_unused_deps check, fix, and verification demo')).toContainText(
    'MISSING_DIRECT_DEP'
  )
  await expect(page.getByLabel('swift_unused_deps check, fix, and verification demo')).toContainText('0 issues found.')
  await expect(page.getByRole('link', { name: 'Setup ↗' })).toHaveAttribute(
    'href',
    'https://github.com/kaanbiryol/swift_unused_deps#setup'
  )
  await expect(page.getByRole('heading', { level: 3, name: 'What it catches' })).toBeVisible()
})

test('article charts and controls initialize', async ({ page }, testInfo) => {
  await page.goto(chartArticle)

  const charts = page.locator('[data-chart][data-chart-ready="true"]')
  await expect(charts).toHaveCount(4)
  await expect(charts.locator('.data-chart__svg')).toHaveCount(4)
  await expect(page.locator('.reading-time')).toContainText(/\d+ min read/)
  await expect(page.getByRole('list', { name: 'Topics', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Topics', exact: true }).getByRole('link')).toHaveCount(3)
  await expect(page.locator('meta[name="keywords"]')).toHaveAttribute(
    'content',
    'ios, build performance, kotlin multiplatform'
  )
  await expect(page.locator('meta[property="article:tag"]')).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Related writing' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Shared topics' }).first()).toContainText('build performance')
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

test('RSS exposes post topics as categories', async ({ request }) => {
  const response = await request.get('/rss.xml')
  expect(response.ok()).toBe(true)

  const xml = await response.text()
  expect(xml).toContain('<category>build performance</category>')
  expect(xml).toContain('<category>kotlin multiplatform</category>')
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
