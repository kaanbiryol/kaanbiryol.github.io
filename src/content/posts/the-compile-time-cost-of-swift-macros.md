---
title: 'The Compile-Time Cost of Swift Macros'
pubDate: 2026-05-31
---

## Introduction

Swift macros are attractive because the call site looks clean. You can achieve much more by writing as little as possible. You add an attribute, delete a few lines of boilerplate, and move on.

Most build-time discussions around macros focus on two obvious costs:

- fetching and building `swift-syntax`
- building the macro target itself

Those costs are real. But that is not the whole story.

There is another cost that is easier to miss: the frontend work paid by the source files that use the macro.

Every macro usage has to be expanded while compiling the file that contains it. Even if the macro implementation is already built, the source file still pays for macro-related frontend work.

At scale, the question of "what does macro expansion add to compilation?" matters. A macro can look harmless in isolation, then become expensive once it turns into a convention and is used in many places.

> Previously, using macros often meant fetching and building `swift-syntax` through SPM. Recent toolchain improvements help with that first-build cost by making `swift-syntax` available in [prebuilt](https://forums.swift.org/t/preview-swift-syntax-prebuilts-for-macros/80202) form when a matching prebuilt is available.

## The macro

The macro I tested is intentionally small. It attaches to a property and generates a builder-style modifier method:

```swift
@Modifier private var isOutlined: Bool = false
```

In this toy implementation, it expands into code shaped like this:

```swift
public func isOutlined(_ isOutlined: Bool) -> Self {
    var copy = self
    copy.isOutlined = isOutlined
    return copy
}
```

## The benchmark

There are at least three separate costs around Swift macros:

- resolving and building `swift-syntax`
- building the macro target itself
- compiling source files that use macros

This post focuses on the third cost.

This is not a perfect "macro expansion only" measurement. Swift has lower-level compiler statistics, such as [`-stats-output-dir`](https://github.com/swiftlang/swift/blob/main/docs/CompilerPerformance.md#unified-stats-reporter), that can expose some macro-related compiler work. But those numbers are compiler-internal details, not a stable high-level metric that says "this many milliseconds were spent expanding macros."

For this benchmark, I used `swiftc -typecheck` wall-clock time as a practical approximation. It stays in the frontend and avoids optimization, code generation, object-file emission, and linking. It still measures more than macro expansion, parsing, type checking, imports, diagnostics, and type-checking the expanded code are all included, but that is also the cost you usually feel while developing.

> If you want to dig deeper, you can pass `-stats-output-dir /tmp/stats` to your `swiftc` invocation to collect compiler statistics and inspect the generated JSON files.

### Benchmark input

To compare the cost, I used two versions of the same source code: one hand-written version and one macro version.

The hand-written file looks like this:

```swift
struct Button {
    private var title: String
    private var isOutlined: Bool = false

    public init(
        title: String
    ) {
        self.title = title
    }

    public func isOutlined(_ isOutlined: Bool) -> Self {
        var copy = self
        copy.isOutlined = isOutlined
        return copy
    }
}
```

The macro version imports the macro package and lets the attribute generate roughly the same code:

```swift
import ModifierMacro

struct Button {
    private var title: String
    @Modifier private var isOutlined: Bool = false

    public init(
        title: String
    ) {
        self.title = title
    }
}
```

The benchmark generates these two shapes at different sizes and compares the results.

### Benchmark setup

The macro package has two targets:

- `ModifierMacro`, the library target imported by the benchmark files
- `ModifierMacroMacros`, the macro target that implements the macro

In an actual project, you do not think about how macros are compiled or loaded. SPM builds the macro target, finds the compiled module, finds the macro plugin executable, and passes the right arguments to the compiler, and everything works.

For this benchmark, I intentionally bypass SPM for the measured command and call `swiftc` directly. That keeps the measured command focused on the source files that use the macro, instead of mixing the result with package resolution, dependency fetching, or building the macro target.

First, build the macro package once:

```sh
swift build -c release --target ModifierMacro
```

This produces two build products the benchmark needs:

1. the compiled Swift module for `ModifierMacro`
2. the macro plugin executable for `ModifierMacroMacros`

The compiled **Swift module** makes this import work in the benchmark files:

```swift
import ModifierMacro
```

It contains the module interface that `swiftc` needs to type-check code that imports the macro package.

The **macro plugin executable** is the separate program the compiler launches when it needs to expand a macro. The macro declaration tells Swift which plugin module contains the implementation, but when calling `swiftc` directly, the compiler still needs the path to the executable.

Because the benchmark calls `swiftc` manually, I need to find those build products and pass them to the compiler myself.

### Preparing compiler flags

Once the macro package is built, the next step is preparing the compiler flags for `swiftc`.

First, ask SPM where it placed the release build products:

```sh
export BUILD_PATH=$(swift build -c release --show-bin-path)
```

`BUILD_PATH` is the release build output directory reported by SPM. I do not hard-code this path because it can change depending on the machine, architecture, Swift version, and build configuration. It usually points somewhere under `.build/.../release`.

From that directory, I derive the module path:

```sh
export MOD_PATH=$BUILD_PATH/Modules
```

When SPM builds a package, it automatically tells the compiler where to find imported modules. Here I am calling `swiftc` directly, so I need to pass that module search path myself:

```sh
-I "$MOD_PATH"
```

Without this, `swiftc` would not know where to find the already-built `ModifierMacro` module.

The benchmark also needs the macro plugin executable:

```sh
export PLUGIN_PATH=$BUILD_PATH/ModifierMacroMacros-tool#ModifierMacroMacros
```

This value is passed to `swiftc` with `-load-plugin-executable`. It has this shape:

```text
/path/to/plugin-executable#PluginModuleName
```

For this benchmark, the value is:

```text
ModifierMacroMacros-tool#ModifierMacroMacros
```

The part before `#` is the executable the compiler launches when it needs to expand the macro:

```text
$BUILD_PATH/ModifierMacroMacros-tool
```

The part after `#` is the plugin module name:

```text
ModifierMacroMacros
```

That module name matches the module referenced by the macro declaration through `#externalMacro(module:type:)`.

Finally, I fix the compiler thread count so benchmark runs use the same amount of parallelism:

```sh
export CORES=8
```

The full setup becomes:

```sh
export CORES=8
export BUILD_PATH=$(swift build -c release --show-bin-path)
export MOD_PATH=$BUILD_PATH/Modules
export PLUGIN_PATH=$BUILD_PATH/ModifierMacroMacros-tool#ModifierMacroMacros
```

In short:

- `BUILD_PATH` finds SPM's release build output directory
- `MOD_PATH` lets direct `swiftc` resolve `import ModifierMacro`
- `PLUGIN_PATH` tells direct `swiftc` which macro plugin executable to launch
- `CORES` keeps compiler parallelism consistent across runs

With those paths available, the typecheck benchmark can call `swiftc` directly:

```sh
swiftc \
  -load-plugin-executable "$PLUGIN_PATH" \
  -I "$MOD_PATH" \
  -typecheck \
  -num-threads "$CORES" \
  benchmark/large_macro/*.swift
```

This command parses the input files, resolves imports, loads the macro plugin, expands macro usages, and type-checks the expanded source. Then it stops. It does not optimize, emit object files, or link an executable.

That makes it useful for answering "what did macro usage add to frontend work?"

The full compile comparison uses the same setup, but continues through optimized compilation and executable emission (you can pass `-Onone` for debug builds):

```sh
swiftc \
  -load-plugin-executable "$PLUGIN_PATH" \
  -I "$MOD_PATH" \
  -O \
  -num-threads "$CORES" \
  benchmark/large_macro/*.swift \
  -o .build/large_macro_test
```

I treat this as the practical build-time comparison. It includes the macro overhead plus the normal cost of compiling, optimizing, and emitting the resulting program.

The hand-written baseline commands do not pass `-load-plugin-executable` or `-I "$MOD_PATH"`, because those files do not import the macro package. So the comparison is:

- hand-written Swift source compiled directly with `swiftc`
- macro-using Swift source compiled directly with `swiftc`, with the already-built macro plugin made available

### Results

You can see all results in the [swift-macro-benchmark](https://github.com/kaanbiryol/swift-macro-benchmark) repository.

| Benchmark                             |   Time |
| ------------------------------------- | -----: |
| Default, 1 file, 1 function           | 121 ms |
| Macro, 1 file, 1 macro                | 154 ms |
| Default, 1 file, 2000 functions       | 378 ms |
| Macro, 1 file, 2000 macros            | 9.48 s |
| Default, 100 files, 20 functions each | 5.18 s |
| Macro, 100 files, 20 macros each      | 8.32 s |

The single-macro case is mostly fixed overhead and noise. I would not draw a strong conclusion from a small difference in one local benchmark.

The larger cases are more useful. The single-file benchmark is the worst shape: 2000 macro usages in one file made typechecking much slower than the equivalent hand-written code. That is not surprising, but it is the kind of shape that can appear in generated-looking configuration files, analytics definitions, feature flags, or large declaration-heavy modules.

The multi-file case is more representative of normal app code. It is still slower, but much less extreme. The same total number of macro usages behaves differently when spread across many files.

That is the main takeaway for me: macro cost is not only about how many times a macro is used. File shape matters too. A few macro usages in many files and thousands of macro usages in one file do not have the same compile-time profile.

> These numbers will change with the macro implementation and the code shape around it. Before using a macro heavily in a large project, it is worth measuring what that specific macro costs at the scale you expect.

## Conclusion

Macros are not just syntax sugar. They are compiler plugins, and their cost is paid during compilation.

Once a macro is used hundreds or thousands of times, it can start to affect your compile times in a way that is no longer invisible. And as the benchmark shows, the cost is not only about how many macro calls you have, but also where they are.

So my rule of thumb is simple: use macros when they bring real value, but measure before turning them into a convention. The benefit should be worth the extra cost.

## References

- [swift-macro-benchmark](https://github.com/kaanbiryol/swift-macro-benchmark)
- [Swift compiler performance: Unified Stats Reporter](https://github.com/swiftlang/swift/blob/main/docs/CompilerPerformance.md#unified-stats-reporter)
- [Swift Forums: Preview swift-syntax prebuilts for macros](https://forums.swift.org/t/preview-swift-syntax-prebuilts-for-macros/80202)
- [Swift Evolution: SE-0382 Expression Macros](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0382-expression-macros.md)
- [Swift Evolution: SE-0389 Attached Macros](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0389-attached-macros.md)
