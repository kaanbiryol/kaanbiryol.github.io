import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const representativePages = [
  { name: 'home page', path: '/' },
  { name: 'writing index', path: '/writing/' },
  { name: 'topic page', path: '/writing/topics/swift/' },
  { name: 'Harbor work showcase', path: '/work/harbor/' },
  { name: 'Swift dependency work showcase', path: '/work/swift-unused-deps/' },
  { name: 'Crate work showcase', path: '/work/obsidian-crate/' },
  { name: 'initializer work showcase', path: '/work/init-revise-cli/' },
  { name: 'Bazel migration work showcase', path: '/work/tuist-to-bazel/' },
  { name: 'article with charts', path: '/the-hidden-cost-behind-kotlin-multiplatform-on-ios/' }
]

test.describe('accessibility', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One engine is sufficient for axe DOM analysis')

  for (const pageUnderTest of representativePages) {
    test(`${pageUnderTest.name} has no detectable WCAG A or AA violations`, async ({ page }) => {
      await page.goto(pageUnderTest.path)

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()

      expect(results.violations).toEqual([])
    })
  }
})
