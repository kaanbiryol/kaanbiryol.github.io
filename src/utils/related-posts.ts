import type { CollectionEntry } from 'astro:content'
import type { RelatedPost } from '@/types'
import { normalizeTopic } from '@/utils/topics'

export function getRelatedPosts(
  currentPost: CollectionEntry<'posts'>,
  posts: CollectionEntry<'posts'>[],
  limit = 3,
  excludedPostIds: string[] = []
): RelatedPost[] {
  const currentTopics = new Set(currentPost.data.topics.map(normalizeTopic))
  const excludedIds = new Set([currentPost.id, ...excludedPostIds])

  return posts
    .filter((post) => !excludedIds.has(post.id))
    .map((post) => {
      const sharedTopics = post.data.topics.filter((topic: string) => currentTopics.has(normalizeTopic(topic)))

      return {
        id: post.id,
        title: post.data.title,
        pubDate: post.data.pubDate,
        sharedTopics
      }
    })
    .filter((post) => post.sharedTopics.length > 0)
    .sort((a, b) => b.sharedTopics.length - a.sharedTopics.length || b.pubDate.valueOf() - a.pubDate.valueOf())
    .slice(0, limit)
}
