import type { CollectionEntry } from 'astro:content'

export const normalizeTopic = (topic: string) => topic.trim().toLowerCase()

export const getTopicSlug = (topic: string) =>
  normalizeTopic(topic)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const getTopicHref = (topic: string) => `/writing/topics/${getTopicSlug(topic)}/`

export const postHasTopic = (post: CollectionEntry<'posts'>, topic: string) => {
  const normalizedTopic = normalizeTopic(topic)
  return post.data.topics.some((postTopic) => normalizeTopic(postTopic) === normalizedTopic)
}
