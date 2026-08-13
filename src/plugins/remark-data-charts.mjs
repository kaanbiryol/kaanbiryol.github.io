import { visit } from 'unist-util-visit'

const supportedChartTypes = new Set(['grouped-bar', 'line', 'stacked-bar'])

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const textContent = (node) => {
  if (!node) return ''
  if (typeof node.value === 'string') return node.value
  if (!Array.isArray(node.children)) return ''
  return node.children.map(textContent).join('')
}

const tableData = (node) => {
  const rows = node.children
    .filter((child) => child.type === 'tableRow')
    .map((row) => row.children.map((cell) => textContent(cell).trim()))

  if (rows.length < 2 || rows[0].length < 2) return null

  return {
    headers: rows[0],
    rows: rows.slice(1)
  }
}

const renderTable = ({ headers, rows }, title) => {
  const head = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) =>
            index === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`
          )
          .join('')}</tr>`
    )
    .join('')

  return `<div class="data-chart__table-wrap"><table class="data-chart__source" aria-label="${escapeHtml(title)}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

export default function remarkDataCharts() {
  return (tree, file) => {
    visit(tree, 'containerDirective', (node) => {
      if (node.name !== 'chart') return

      const table = node.children.find((child) => child.type === 'table')
      const data = table ? tableData(table) : null
      const attributes = node.attributes ?? {}
      const type = attributes.type ?? 'grouped-bar'
      const title = attributes.title?.trim()

      if (!data) {
        file.message('Chart directives require a Markdown table with a header and at least one data row', node)
        return
      }

      if (!title) {
        file.message('Chart directives require a title attribute', node)
        return
      }

      if (!supportedChartTypes.has(type)) {
        file.message(`Unsupported chart type: ${type}`, node)
        return
      }

      const properties = [
        ['data-chart-type', type],
        ['data-chart-unit', attributes.unit],
        ['data-chart-axis-label', attributes['axis-label']],
        ['data-chart-x-label', attributes['x-label']],
        ['data-chart-precision', attributes.precision],
        ['data-chart-exclude', attributes.exclude]
      ]
        .filter(([, value]) => value !== undefined)
        .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
        .join(' ')

      node.type = 'html'
      node.value = `<figure class="data-chart" data-chart ${properties}>
  <figcaption class="data-chart__title">${escapeHtml(title)}</figcaption>
  <div class="data-chart__legend" aria-hidden="true"></div>
  <div class="data-chart__canvas" aria-hidden="true"></div>
  ${renderTable(data, title)}
</figure>`
      delete node.name
      delete node.attributes
      delete node.children
    })
  }
}
