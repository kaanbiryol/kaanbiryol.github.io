import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'

const inlineMarkdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false
})

export const renderInlineMarkdown = (value: string) =>
  sanitizeHtml(inlineMarkdown.renderInline(value), {
    allowedTags: ['a', 'br', 'code', 'em', 'strong'],
    allowedAttributes: {
      a: ['href', 'title']
    }
  })

export const stripInlineMarkdown = (value: string) =>
  sanitizeHtml(inlineMarkdown.renderInline(value), {
    allowedTags: [],
    allowedAttributes: {}
  })
