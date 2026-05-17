import { getCollection, type CollectionEntry } from 'astro:content'
import { OGImageRoute } from 'astro-og-canvas'
import { publicationConfig, themeConfig } from '../../config'
import { stripInlineMarkdown } from '../../utils/inline-markdown'

export const prerender = true

const collectionEntries =
  publicationConfig.publishPosts || publicationConfig.previewPost ? await getCollection('posts') : []

// Map the array of content collection entries to create an object.
// Converts [{ id: 'post.md', data: { title: 'Example', pubDate: Date } }]
// to { 'post.md': { title: 'Example', pubDate: Date } }
const pages = Object.fromEntries(
  collectionEntries
    .filter((entry: CollectionEntry<'posts'>) => !entry.id.startsWith('_'))
    .filter(
      (entry: CollectionEntry<'posts'>) => !publicationConfig.previewPost || entry.id === publicationConfig.previewPost
    )
    .map((entry: CollectionEntry<'posts'>) => [entry.id.replace(/\.md$/, ''), entry.data])
)

export const { getStaticPaths, GET } = await OGImageRoute({
  param: 'route',
  pages,
  getImageOptions: (_path: string, page: CollectionEntry<'posts'>['data']) => ({
    title: stripInlineMarkdown(page.title),
    description: themeConfig.site.title,
    logo: {
      path: 'public/og/og-logo.png',
      size: [80, 80]
    },
    bgGradient: [[28, 28, 28]],
    padding: 64,
    font: {
      title: {
        color: [232, 229, 220],
        size: 64,
        weight: 'SemiBold'
      },
      description: {
        color: [168, 164, 153],
        size: 36,
        weight: 'Normal'
      }
    }
  })
})
