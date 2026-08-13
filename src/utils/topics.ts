import type { CollectionEntry } from 'astro:content'

export const normalizeTopic = (topic: string) => topic.trim().toLowerCase()

export const getTopicSlug = (topic: string) =>
  normalizeTopic(topic)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const getTopicHref = (topic: string) => `/writing/topics/${getTopicSlug(topic)}/`

export const getTopicsBySlug = (topics: Iterable<string>) => {
  const topicsBySlug = new Map<string, string>()

  for (const topic of topics) {
    const normalizedTopic = normalizeTopic(topic)
    const slug = getTopicSlug(normalizedTopic)

    if (!slug) {
      throw new Error(`Topic "${normalizedTopic}" does not produce a valid URL slug`)
    }

    const existingTopic = topicsBySlug.get(slug)
    if (existingTopic && existingTopic !== normalizedTopic) {
      throw new Error(`Topics "${existingTopic}" and "${normalizedTopic}" produce the same URL slug "${slug}"`)
    }

    topicsBySlug.set(slug, normalizedTopic)
  }

  return topicsBySlug
}

export const postHasTopic = (post: CollectionEntry<'posts'>, topic: string) => {
  const normalizedTopic = normalizeTopic(topic)
  return post.data.topics.some((postTopic: string) => normalizeTopic(postTopic) === normalizedTopic)
}
