import type { APIContext } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'
import { publicationConfig, themeConfig } from '../../config'
import { generatePostOpenGraphImage } from '../../utils/og-image'

export const prerender = true
type PostData = CollectionEntry<'posts'>['data']

const collectionEntries =
  publicationConfig.publishPosts || publicationConfig.previewPost ? await getCollection('posts') : []

// Map the array of content collection entries to create an object.
// Converts [{ id: 'post.md', data: { title: 'Example', pubDate: Date } }]
// to { 'post.md': { title: 'Example', pubDate: Date } }
const pages: Record<string, PostData> = Object.fromEntries(
  collectionEntries
    .filter((entry: CollectionEntry<'posts'>) => !entry.id.startsWith('_'))
    .filter(
      (entry: CollectionEntry<'posts'>) => !publicationConfig.previewPost || entry.id === publicationConfig.previewPost
    )
    .map((entry: CollectionEntry<'posts'>) => [entry.id.replace(/\.md$/, ''), entry.data])
)

export function getStaticPaths() {
  return Object.entries(pages).map(([route, page]) => ({
    params: { route: `${route}.png` },
    props: { page }
  }))
}

export async function GET({ props }: APIContext<{ page: PostData }>) {
  const image = await generatePostOpenGraphImage({
    title: props.page.title,
    description: themeConfig.site.title
  })

  return new Response(image, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  })
}
