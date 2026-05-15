---
title: 'When Swift’s `.init` Shorthand Gets Expensive'
description: 'A practical refactoring story about Swift type inference, slow .init shorthand, SourceKit expression types, and SwiftSyntax rewrites.'
pubDate: 2026-05-14
---

## Introduction

Swift’s `.init(...)` shorthand is handy. It keeps call sites short, avoids repeating type names that already feel obvious, and often makes Swift code nicer to read.

But the convenience is not always free.

In large Swift codebases, `.init(...)` can show up thousands of times. Most of those call sites are harmless. Some are not.

## Type inference

Swift’s [diagnostic architecture overview](https://www.swift.org/blog/new-diagnostic-arch-overview/#type-inference-overview) explains the constraint-based type checker well, so I will not repeat the full model here.

In short, type inference is how a compiler figures out the type of an expression from context.

```swift
struct ViewModel {
    let value: String
}

func render(_ model: ViewModel) {}

render(.init(value: "Hello")) // .init(value:) is inferred as ViewModel
```

There is no `ViewModel` written at the call site. A human can still read this and understand that `.init(value:)` means `ViewModel(value:)`, because `render` takes a `ViewModel`.

The compiler has to prove the same thing.

Swift’s type inference is one of the things that makes the language pleasant to use. But inference has a cost. That cost depends on the surrounding expression, overload sets, generic constraints, and how early the type checker gets useful information.

## The problem

In the project I was working on, one specific `.init(...)` pattern appeared thousands of times, and the compiler was spending a lot of time inferring its type.

The goal was simple: make those initializer calls explicit where inference was costing us time.

```swift
// Simplified example of what we want to achieve
// Before
doSomething(model: .init(value: "1"))

// After
doSomething(model: Test.ViewModel(value: "1"))
```

A plain search and replace would not work. Each `.init(...)` call can resolve to a different type, and that type is not written anywhere at the call site.

But the compiler already knows the answer.

If we could somehow ask the compiler for the resolved type, we could match that information back to the `.init(...)` call in the source file and rewrite the call explicitly.

## A small benchmark

Before spending more time on tooling, I wanted to benchmark different expression shapes to understand which ones get slower and which ones do not.

I created a small benchmark repo, [swift-type-checking-benchmarks](https://github.com/kaanbiryol/swift-type-checking-benchmarks), where different expression shapes can be generated and measured. The benchmark creates repeated Swift files and runs `xcrun swiftc -typecheck` through [`hyperfine`](https://github.com/sharkdp/hyperfine).

The goal was not to prove that `.init(...)` is always slow. It was to understand which expression shapes get slower and which ones do not.

One useful example is a small overloaded analytics-style API:

```swift
struct PurchaseEvent {
    let id: Int
    let name: String
}

struct ScreenEvent {
    let id: Int
    let name: String
}

struct ErrorEvent {
    let id: Int
    let name: String
}

func score(_ event: PurchaseEvent) -> Int {
    event.id
}

func score(_ event: ScreenEvent) -> Int16 {
    Int16(event.id)
}

func score(_ event: ErrorEvent) -> Double {
    Double(event.id)
}
```

Then compare this:

```swift
let total =
    score(.init(id: 1, name: "checkout"))
    + score(.init(id: 2, name: "pay"))
    + 1
```

With this:

```swift
let total =
    score(PurchaseEvent(id: 1, name: "checkout"))
    + score(PurchaseEvent(id: 2, name: "pay"))
    + 1
```

Both snippets compile. The difference is how much work the compiler has to do.

In the `.init(...)` version, each initializer starts without a concrete target type. The compiler has to resolve the overloaded `score` calls and the surrounding `+` expression together before it can settle on `PurchaseEvent`.

In the explicit version, `PurchaseEvent(...)` gives the solver the argument type immediately. That lets it discard the `ScreenEvent` and `ErrorEvent` overloads much earlier.

In one local run with 300 repeated calls on Swift 6.3, the explicit version was faster:

```text
explicit PurchaseEvent(...): 320.7 ms
shorthand .init(...):        1.468 s
```

That is about `4.58x` faster in that run. The benchmark is intentionally small, but it captures the shape of the issue.

This does not mean explicit initializers are always `4.58x` faster. There are cases where `.init(...)` is harmless, or even faster. The useful takeaway is to measure your own expression shapes.

## The solution

At a high level, the tool has to do three things:

1. Collect the compiler arguments the project uses.
2. Pass those arguments and Swift files to SourceKit, then ask for expression type information.
3. Rewrite `.init(...)` call sites with the resolved type using SwiftSyntax.

```mermaid
flowchart LR
    A["Collect Swift file and compiler arguments"]
    B["Ask SourceKit for inferred types of .init(...) calls"]
    C["SourceKit returns inferred type plus offset and length"]
    D["Use SwiftSyntax to locate each .init(...) by source range"]
    E["Rewrite .init(...) as InferredType(...)"]

    A --> B --> C --> D --> E
```

[SourceKit](https://github.com/swiftlang/swift/blob/main/tools/SourceKit/docs/Protocol.md) is the service behind many Swift editor features. Tools can use it to ask questions like “what is the type of this expression?”, “where is this symbol defined?”, or “what completions are available here?”.

That makes it useful for this kind of refactoring.

### 1. Grabbing compiler arguments

SourceKit needs the same compiler context as the project, otherwise it won't be able to infer the implicit expressions.

That means the right SDK, architecture, build configuration, search paths, module maps, package products, generated sources, and target-specific settings. Without that context, SourceKit may not be able to resolve the expression type.

In an Xcode project, the most practical source of those arguments was the indexing build settings:

```sh
xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -arch arm64 \
  -sdk iphonesimulator \
  -showBuildSettingsForIndex \
  -json
```

From that JSON, the tool reads `swiftASTCommandArguments` for each file and passes them to SourceKit as `key.compilerargs`.

### 2. Asking SourceKit for expression types

SourceKit has an [expression type request](https://github.com/swiftlang/swift/blob/main/tools/SourceKit/docs/Protocol.md#expression-type). You give it the source file path, the compiler arguments for that file, and the request kind.

The response includes expression offsets, lengths, and resolved types.

For example, for this source:

```swift
...
doSomething(model: .init(value: "1"))
...
```

A simplified response looks like this:

```yaml
<key.expression_offset>: 128
<key.expression_length>: 24
<key.expression_type>: Test.ViewModel
```

This is great, because it doesn't only tell us the resolved type; it also tells us where that type information applies in the source file.

### 3. Rewriting with SwiftSyntax

[SwiftSyntax](https://github.com/swiftlang/swift-syntax) handles the source editing step. SourceKit gives us resolved expression types at byte offsets, but it does not tell us to replace text blindly. We still need to verify that the code at that position is the syntax pattern we want to rewrite.

The tool parses the Swift file, walks the syntax tree, and looks for prefix-dot initializer calls: `.init(...)`.

For each match, it checks whether SourceKit resolved a concrete type at that position. If it did, the tool rewrites the initializer from inferred form to explicit form:

```swift
// Before
doSomething(model: .init(value: "1"))

// After
doSomething(model: Test.ViewModel(value: "1"))
```

That split is what makes the approach safe enough to run over a larger codebase. SourceKit provides compiler-derived type information. SwiftSyntax makes sure the edit lands on the right Swift syntax instead of treating the file as plain text.

If the tool cannot confidently match a SourceKit result to a `.init(...)` syntax node, it skips that call site instead of guessing.

### The edge cases

SourceKit does not always return types in the form you would write in source code.

For example, this call site looks straightforward:

```swift
func doSomethingOptional(model: Test.ViewModel?) {}

doSomethingOptional(model: .init(value: "2"))
```

The type you want to insert is `Test.ViewModel`:

```swift
doSomethingOptional(model: Test.ViewModel(value: "2"))
```

But the surrounding expression is optional. In my cases, SourceKit commonly returned this as:

```swift
Test.ViewModel?
```

That is useful information, but `Test.ViewModel?` is not what you want to put before an initializer call. The tool strips the optional marker before rewriting the code. A more complete normalizer should also handle forms like `Optional<Test.ViewModel>`.

Arrays have a similar problem. In array literals, SourceKit can return something like:

```swift
Array<Test.ViewModel>.ArrayLiteralElement
```

Again, that means something to the compiler, but it is not a type name you would write at the call site. Therefore, we need to detect this array-literal form and turn it back into `Test.ViewModel`.

For example, the sample project in [`init-revise-cli`](https://github.com/kaanbiryol/init-revise-cli) has cases like this:

```swift
doSomethingArrayOptional(model: [
    .init(value: "6"),
    .init(value: "7"),
    nil
])
```

The output should be explicit, but still look like normal Swift:

```swift
doSomethingArrayOptional(model: [
    Test.ViewModel(value: "6"),
    Test.ViewModel(value: "7"),
    nil
])
```

I am sure there are more edge cases. Optionals and arrays were just the first ones I ran into.

## Not just initializers

I focused on `.init(...)` in this post because that was the repeated pattern in front of me. The underlying problem is not specific to initializers.

Any expression that leaves the compiler with too much ambiguity can create similar work.

The same approach still applies to those cases:

1. Measure slow expression shapes.
2. Find the repeated pattern.
3. Use SourceKit to grab explicit type information.
4. Replace.
5. Profit at scale.

## The example project

The [init-revise-cli repo](https://github.com/kaanbiryol/init-revise-cli) includes an [`Example/`](https://github.com/kaanbiryol/init-revise-cli/tree/main/Example) project, that you can see how everything comes together.

The public version is intentionally small. It shows the idea without trying to cover every shape from a production codebase.

## Was it worth it?

In the project I was working on, this gave us around a 5% improvement on the measured build path, roughly 30 seconds.

That is not enough to make this a universal recommendation. But for a repeated source-level pattern that was already visible in slow type-checking diagnostics, it was enough to justify the tooling.

## Tips

Before rewriting anything, measure where the compiler is spending time. The slow type-checking flags are still practical tools for this; they are not just old compiler trivia.

Swift compiler has [frontend flags](https://github.com/swiftlang/swift/blob/main/include/swift/Option/FrontendOptions.td) for slow type-checking diagnostics:

```sh
-Xfrontend -warn-long-expression-type-checking=100
-Xfrontend -warn-long-function-bodies=100
```

After enabling the warnings, run your build and look for repeated slow expression shapes. If the same pattern appears many times, that is when targeted tooling starts to make sense.

## References

- [Swift.org: New Diagnostic Architecture Overview](https://www.swift.org/blog/new-diagnostic-arch-overview/#type-inference-overview)
- [Swift language reference: Type Inference](https://github.com/swiftlang/swift-book/blob/main/TSPL.docc/ReferenceManual/Types.md#type-inference)
- [Swift compiler frontend options](https://github.com/swiftlang/swift/blob/main/include/swift/Option/FrontendOptions.td)
- [SourceKit protocol: Expression Type](https://github.com/swiftlang/swift/blob/main/tools/SourceKit/docs/Protocol.md#expression-type)
- [SwiftSyntax](https://github.com/swiftlang/swift-syntax)
- [swift-type-checking-benchmarks](https://github.com/kaanbiryol/swift-type-checking-benchmarks)
- [init-revise-cli](https://github.com/kaanbiryol/init-revise-cli)
