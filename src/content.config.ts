import { glob } from 'astro/loaders'
import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { publicationConfig } from './config'
import { normalizeTopic } from './utils/topics'

const postPattern = publicationConfig.previewPost
  ? `${publicationConfig.previewPost}.md`
  : publicationConfig.publishPosts
    ? ['**/*.md', '!**/_*.md']
    : '_*.md'

const posts = defineCollection({
  // Load Markdown and MDX files in the `src/content/posts/` directory.
  loader: glob({
    base: './src/content/posts',
    pattern: postPattern
  }),
  // Type-check frontmatter using a schema
  schema: () =>
    z.object({
      title: z.string(),
      description: z.string(),
      // Transform string to Date object
      pubDate: z.coerce.date(),
      topics: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .transform((topic) => normalizeTopic(topic))
        )
        .min(1, 'Add at least one topic')
        .max(3, 'Use no more than three topics')
        .refine((topics) => new Set(topics).size === topics.length, 'Topics must be unique'),
      image: z.string().optional()
    })
})

const about = defineCollection({
  // Load Markdown files in the `src/content/about/` directory.
  loader: glob({ base: './src/content/about', pattern: '**/*.md' }),
  // Type-check frontmatter using a schema
  schema: z.object({})
})

export const collections = { posts, about }
