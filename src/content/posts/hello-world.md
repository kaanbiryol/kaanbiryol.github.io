---
title: 'Markdown Style Test'
pubDate: 2026-03-28
---

This is a test post to preview how different markdown features render.

## Headings

### Third level

#### Fourth level

## Text formatting

This is a paragraph with **bold text**, *italic text*, and `inline code`. Here's a [link to GitHub](https://github.com) and some ~~strikethrough text~~.

> This is a blockquote. It can span multiple lines and is useful for highlighting important information or quoting someone.

## Code blocks

```swift
@attached(peer, names: arbitrary)
public macro Modifier() = #externalMacro(
    module: "ModifierMacroMacros",
    type: "ModifierMacro"
)

public struct ModifierMacro: PeerMacro {
    public static func expansion(
        of node: AttributeSyntax,
        providingPeersOf declaration: some DeclSyntaxProtocol,
        in context: some MacroExpansionContext
    ) throws -> [DeclSyntax] {
        guard let varDecl = declaration.as(VariableDeclSyntax.self) else {
            return []
        }
        return [DeclSyntax(stringLiteral: "// generated")]
    }
}
```

```python
def generate_large_macro(num_modifiers: int):
    content = "import ModifierMacro\n\nstruct Button {\n"
    for i in range(num_modifiers):
        content += f"    @Modifier private var modifier{i}: Double = 0.0\n"
    content += "}\n"
    return content
```

## Lists

Unordered:

- First item
- Second item with a longer description that wraps to the next line
- Third item
  - Nested item
  - Another nested item

Ordered:

1. Clone the repo
2. Run `swift build -c release`
3. Execute the benchmark
4. Check `results.json`

## Table

| Scenario | Files | Modifiers | Time |
|---|---|---|---|
| Default | 1 | 1 | 0.42s |
| Macro | 1 | 1 | 0.89s |
| Large Default | 1 | 2000 | 3.21s |
| Large Macro | 1 | 2000 | 4.67s |
| Multi-file | 100 | 20 each | 5.12s |
| Multi-file Macro | 100 | 20 each | 7.34s |

## Horizontal rule

---

## Image

![Placeholder](https://placehold.co/800x400/111/333?text=Sample+Image)

## Task list

- [x] Set up blog
- [x] Customize theme
- [ ] Write first real post
- [ ] Cross-post to Medium

## Footnote

Swift macros expand at compile time[^1], which means their cost is paid on every build.

[^1]: See the Swift Evolution proposal SE-0389 for details on the macro system.
