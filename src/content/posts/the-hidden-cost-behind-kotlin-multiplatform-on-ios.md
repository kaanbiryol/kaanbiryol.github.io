---
title: 'The Hidden Cost Behind Kotlin Multiplatform on iOS'
description: 'A benchmark-driven look at how Kotlin Multiplatform changes the iOS development feedback loop.'
pubDate: 2026-06-14
---

## Introduction

Most Kotlin Multiplatform discussions start from a very reasonable promise: write once, deploy to multiple platforms, avoid maintaining the same code twice, and ship faster.

That promise is real, and it is easy to understand why teams are interested in it. If two teams are implementing the same business rules in Swift and Kotlin, sharing that layer sounds like an obvious win.

There are also many arguments against adopting KMP:

- platform compromises
- debugging shared code
- binary size concerns
- tooling pain
- mapping Swift idioms to Kotlin

While these are valid concerns, I had another one that seems to be forgotten in most discussions: feedback loops.

## Feedback loops

Most engineering work is iterative. You change something, build it, run it, test it, notice what broke, change it again, and repeat. Sometimes that loop is one pass. Sometimes it is ten before the feature feels right.

This matters even more now that LLMs and coding agents can write code quickly. Typing is not the bottleneck anymore. Verifying that the code works, and that it behaves the way you intended, is the part that still takes time. So the slower your feedback loop is, the slower you get to "ready to ship."

So the question I wanted to answer was:

> What does Kotlin Multiplatform do to the iOS feedback loop?

That question matters because, in a KMP setup, the iOS app does not compile the shared Kotlin source directly. The Kotlin side first has to produce a native framework, and only then can `xcodebuild` build the app against that updated artifact.

For an iOS engineer, the workflow often looks something like this:

1. Edit a Kotlin file in the shared module
2. Ask Gradle to rebuild the iOS framework
3. Wait for Kotlin/Native to compile and link the framework
4. Let `xcodebuild` consume and link the updated framework
5. Build and run the app
6. Verify the change

This is different from a Swift-only workflow, where `xcodebuild` owns the Swift sources directly. The Swift driver can recompile the affected Swift files, reuse existing outputs where possible, and continue through the rest of the build without waiting for a separate Gradle-produced framework first.

So I built a small benchmark harness: [kmp-ios-benchmark](https://github.com/kaanbiryol/kmp-ios-benchmark). It compares a Swift-only iOS setup with a Kotlin Multiplatform setup across clean builds, incremental builds, public API changes, release builds, and multi-module cascades.

## Setup

The benchmark uses generated source code so the projects are large enough to put some pressure on the build systems. The generated code includes structs, services, enums, protocols, and Kotlin equivalents.

Both sides use source toggles. Each incremental scenario flips a known source file from one state to another, so every trial measures the same kind of change.

The benchmark reports the median of three trials.

For the KMP path, the benchmark asks Gradle to build a Kotlin framework for the iOS simulator:

```text
:kmp:shared:linkDebugFrameworkIosSimulatorArm64
```

Requesting that task also runs the required Kotlin/Native compilation work, including `compileKotlinIosSimulatorArm64`, before linking the simulator framework. Then `xcodebuild` consumes that framework and builds the iOS app.

> KMP can also produce XCFrameworks. This benchmark measures the tighter local debug loop: a single-architecture simulator `.framework`, not full multi-architecture XCFramework packaging. That makes the numbers more relevant to day-to-day simulator iteration, and it avoids charging KMP for extra packaging work that was not part of the loop I wanted to measure.

For the Swift-only path, the benchmark builds a Swift framework target and the iOS app in one `xcodebuild` invocation.

## Clean builds

| Scenario                        |  Swift |    KMP | Overhead |
| ------------------------------- | -----: | -----: | -------: |
| Clean Debug                     |  9.18s | 13.96s |     +52% |
| Clean Release                   | 15.48s | 40.54s |    +162% |
| Clean Debug, cold Gradle daemon |  9.18s | 22.54s |    +146% |

The debug clean build was slower with KMP: 13.96s compared with 9.18s for Swift. That is not surprising as Gradle has to build the Kotlin framework before `xcodebuild` can build the app.

The release result hurts more. The KMP release build took 40.54s, compared with 15.48s for Swift. Kotlin/Native has to produce an optimized native framework, so the extra time is expected, but it is still a cost your release pipeline pays.

The cold Gradle daemon number is worth calling out too. With a cold daemon, the KMP debug clean build went up to 22.54s. If your CI often uses fresh machines, that startup cost can become part of the normal build cost.

> Gradle keeps a background process running between builds so it can reuse caches, avoid JVM startup costs, and keep build state warm. When that daemon is already running, builds are noticeably faster. When it is not, such as on a fresh CI machine or after a restart, you pay an additional startup penalty before any actual compilation work begins.

Clean builds are useful to compare, but they are not the loop I care about most. Daily development is smaller and more repetitive: change one line, build, run, check, repeat.

## Incremental builds

There are three scenarios I measured for incremental changes.

### Internal change

The incremental scenarios do not use arbitrary edits. Each project has a small benchmark toggle file with two deterministic states.

For the single internal change, the benchmark changes only a private implementation value.

In Kotlin, the change is effectively:

```kotlin
private const val benchInternalConstant = 42
```

to:

```kotlin
private const val benchInternalConstant = <unique value for this run>
```

The Swift benchmark does the same thing to Swift source files.

### Public API

For the public API scenario, the benchmark adds a new public function:

```kotlin
fun benchPublicFunctionV2(extra: String = ""): Int
```

### 3-module cascade

The 3-module cascade changes the public API of the leaf module, `ModuleC`. `ModuleB` depends on `ModuleC`, and `ModuleA` depends on `ModuleB`, so this is the case where a small API change at the bottom of the dependency chain forces work above it.

The benchmark also injects a fresh value into the toggled line for each run. That prevents identical-input cache hits from making the incremental result look better than a real edit would.

Here are the incremental results:

| Scenario               | Swift |    KMP | Overhead |
| ---------------------- | ----: | -----: | -------: |
| Single internal change | 3.19s | 10.36s |    +225% |
| Public API change      | 3.27s |  9.40s |    +187% |
| 3-module cascade       | 7.88s | 19.00s |    +141% |

A single internal change in Swift rebuilt in 3.19s. The same kind of change in KMP took 10.36s.

That result changed how I saw the tradeoff. This was not a public API change. It was not the kind of edit that should conceptually invalidate a lot of work. It was just an internal Kotlin implementation change.

But from the iOS side, the changed Kotlin code still has to become a new framework before `xcodebuild` can use it.

Breaking down the KMP build makes that clearer:

| Pipeline   | Step                                                              |   Time |
| ---------- | ----------------------------------------------------------------- | -----: |
| KMP        | Build and link updated Kotlin framework with Gradle/Kotlin Native |  8.13s |
| KMP        | Build the iOS app in `xcodebuild` after the framework is updated  |  2.05s |
| KMP        | Total incremental loop                                            | 10.36s |
| Swift-only | Build Swift module and iOS app with `xcodebuild`                  |  3.19s |

The expensive phase is the Gradle/Kotlin Native framework build.

That is the boundary that matters. In the Swift-only setup, the changed Swift source is part of the same `xcodebuild` pipeline. In the KMP setup, the changed Kotlin source first has to become an updated framework artifact, and only then can the iOS app build against it.

So the feedback loop is not just “compile the changed code.” It is “compile the changed shared code, produce a framework, then build the app that consumes it.”

## The incremental flag helps

Kotlin has an experimental native incremental compilation flag:

```properties
kotlin.incremental.native=true
```

Kotlin/Native debug compilation has two broad stages. First, Kotlin source is compiled into `klib` artifacts. Then those `klib` artifacts, together with dependencies, are compiled into a native binary.

This flag makes the second stage more incremental. If only part of the project `klib` changes, Kotlin/Native can recompile only part of that `klib` into the final binary instead of treating the whole project artifact as changed.

In this benchmark, enabling the flag reduced the single-module KMP incremental build from 10.36s to 7.40s. That is a real improvement, around 29%.

The Kotlin side still has to produce an updated framework before `xcodebuild` can build the iOS app against it. The expensive part gets smaller. It does not disappear.

So if you are using KMP, I would enable this.

## The cost grows with module size

The next question was whether this cost stays roughly fixed or gets worse as the shared module grows.

So I ran the same single-module internal-change benchmark with different module sizes.

| Files per module | Swift internal change | KMP internal change | Slowdown |
| ---------------: | --------------------: | ------------------: | -------: |
|              100 |                 2.84s |               6.92s |     2.4x |
|              200 |                 3.19s |               9.32s |     2.9x |
|              400 |                 4.90s |              15.68s |     3.2x |

I also ran the size sweep for the public API change and 3-module cascade scenarios. Those tables are in the benchmark repo's [size sweep results](https://github.com/kaanbiryol/kmp-ios-benchmark/tree/master/bench/results/sweep). The direction was the same: as modules get larger, the KMP path gets expensive faster than the Swift-only path. The slowdown factor is not constant. It grows with the shared module.

The regression from the benchmark gives roughly:

| Pipeline | Added time per 100 files |
| -------- | -----------------------: |
| Swift    |                   +0.71s |
| KMP      |                   +2.96s |

In this benchmark, KMP's marginal cost per 100 files was about 4.2x higher than Swift's. A small shared module with 100 files might feel fine. A larger one with 400 files already turns a small internal change into a 15.68s rebuild.

If the shared Kotlin module becomes a large "common business logic" bucket, iOS feedback loops will get worse.

## The actual tradeoff

A stable, well-bounded shared layer is very different from a large shared module that changes every day as part of the iOS feature loop.

Seven extra seconds per build does not sound dramatic, but development is made of small loops. Across a team of 50 engineers, that cost adds up quickly.

More importantly, slow feedback changes how development feels. It makes every change heavier, for humans and for agents.

## Practical takeaways

- Keep shared modules small. In this benchmark, KMP incremental time grew faster than Swift as module size increased.
- Try `kotlin.incremental.native=true`, but do not expect it to solve the whole problem. It improved incremental builds in this benchmark, but framework linking remained the ceiling.

## Conclusion

KMP can reduce the duplicated business logic you maintain across Android and iOS. That benefit is real. But duplicated code is not the only cost in a software development lifecycle. Feedback-loop time is also a cost, and it directly affects how quickly developers and agents can iterate.

As code generation gets cheaper, writing code matters less than verifying it repeatedly. Verification, testing, and iteration become the dominant costs.

If you are considering KMP for large scale mobile applications (and fine with the obvious tradeoffs), I would think about the build shape before adopting it.

- How many engineers will work on the project at the same time?
- How many incremental builds does a developer run on an average day?
- How often will iOS developers need to edit that shared code?
- How large will the shared modules become?
- Is the shared layer mostly stable business logic, or is it part of the daily feature loop?
