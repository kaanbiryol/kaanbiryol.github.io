export default {
  plugins: [
    'remark-frontmatter',
    'remark-gfm',
    'remark-math',
    'remark-directive',
    'remark-preset-lint-recommended',
    'remark-preset-lint-consistent',
    ['remark-lint-table-cell-padding', false]
  ]
}
