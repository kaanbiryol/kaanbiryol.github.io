import { expect, test } from '@playwright/test'

const article = '/when-swifts-init-shorthand-gets-expensive/'

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('article section titles expose GitHub-style permalinks', async ({ page }) => {
  await page.goto(article)

  const heading = page.getByRole('heading', { level: 2, name: 'The problem', exact: true })
  const permalink = heading.getByRole('link', { name: 'The problem', exact: true })
  const hash = permalink.locator('.heading-link-symbol')

  await expect(permalink).toHaveAttribute('href', '#the-problem')
  await expect(hash).toHaveText('#')
  await expect(hash).toHaveCSS('opacity', '0')

  await permalink.click()

  await expect(page).toHaveURL(`${article}#the-problem`)
  await expect(hash).toHaveCSS('opacity', '1')
})

test('permalink text and symbols scale with each heading level', async ({ page }) => {
  await page.goto(article)

  for (const selector of ['h2#the-problem', 'h3#the-edge-cases']) {
    const heading = page.locator(selector)
    const typography = await heading.evaluate((element) => {
      const link = element.querySelector('.heading-link')
      const symbol = element.querySelector('.heading-link-symbol')

      return {
        heading: getComputedStyle(element).fontSize,
        link: link ? getComputedStyle(link).fontSize : null,
        symbol: symbol ? getComputedStyle(symbol).fontSize : null
      }
    })

    expect(typography.link).toBe(typography.heading)
    expect(typography.symbol).toBe(typography.heading)
  }
})
