import { visit } from 'unist-util-visit'

const LINKED_HEADING_TAGS = new Set(['h1', 'h2', 'h3'])

export default function rehypeHeadingLinks() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      const id = node.properties?.id

      if (!LINKED_HEADING_TAGS.has(node.tagName) || typeof id !== 'string' || !id) return

      const headingText = extractText(node).trim()
      const symbol = {
        type: 'element',
        tagName: 'span',
        properties: {
          className: ['heading-link-symbol'],
          'aria-hidden': 'true'
        },
        children: [{ type: 'text', value: '#' }]
      }
      const permalink = {
        type: 'element',
        tagName: 'a',
        properties: {
          className: ['heading-link'],
          href: `#${id}`
        },
        children: [...node.children, symbol]
      }

      const existingClassNames = Array.isArray(node.properties.className)
        ? node.properties.className
        : node.properties.className
          ? [node.properties.className]
          : []
      node.properties.className = [...existingClassNames, 'linked-heading']

      if (containsLink(node)) {
        permalink.properties['aria-label'] = `Permalink to ${headingText}`
        permalink.children = [symbol]
        node.children.push(permalink)
      } else {
        node.children = [permalink]
      }
    })
  }
}

function containsLink(node) {
  return node.children.some((child) => {
    if (child.type !== 'element') return false
    if (child.tagName === 'a') return true
    return containsLink(child)
  })
}

function extractText(node) {
  if (node.type === 'text') return node.value
  if (!node.children) return ''
  return node.children.map(extractText).join('')
}
