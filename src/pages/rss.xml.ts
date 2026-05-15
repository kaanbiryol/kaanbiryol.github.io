import type { APIContext } from 'astro'
import rss from '@astrojs/rss'
import { themeConfig } from '@/config'
import { getSortedFilteredPosts } from '@/utils/draft'

export async function GET(context: APIContext) {
  const posts = await getSortedFilteredPosts()

  return rss({
    title: themeConfig.site.title,
    description: themeConfig.site.description,
    site: context.site ?? themeConfig.site.website,
    stylesheet: '/feeds/rss-style.xsl',
    customData: `<language>${themeConfig.site.language}</language>`,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/${post.id.replace(/\.md$/, '')}/`
    }))
  })
}
