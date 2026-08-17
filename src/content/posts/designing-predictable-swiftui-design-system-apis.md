---
title: 'Designing Predictable SwiftUI Design System APIs'
description: 'How to build predictable SwiftUI design system APIs by separating what a component is from how it is presented.'
pubDate: 2026-08-17
topics: ['Swift', 'design systems', 'API design']
---

## Introduction

A lot of companies publish their design systems and explain concepts like tokens, components, variants, and patterns. They mostly focus on how components should look, behave, and fit together.

A design system is meant to bring consistency and speed to product development. At the product level, this usually works well. Buttons look like other buttons, spacing follows a shared scale, and colors and typography stay consistent across features.

Developers interact with the design system through code every day. For them, the design system is also an API, and that API is often less consistent than the visual system it represents.

SwiftUI gives us several ways to shape a component API. Configuration can live in an initializer, a `ViewModifier`, a style protocol such as `ButtonStyle`, a static factory method, the environment, or some combination of them.

One component might put all of its configuration in the initializer:

```swift
DSButton(
    "Continue",
    image: Image(systemName: "arrow.right"),
    size: .small,
    variant: .filled
) {
    submit()
}
```

Another might use `ViewModifier`s:

```swift
DSButton("Continue") {
    submit()
}
.dsSize(.small)
.dsVariant(.outlined)
```

Another might expose static factory methods:

```swift
DSButton.filled("Continue") {
    submit()
}

DSButton.outlined("Cancel") {
    cancel()
}
```

Another might combine the approaches:

```swift
DSButton.outlined(
    "Continue",
    size: .small
) {
    submit()
}
.image(Image(systemName: "arrow.right"))
```

## The problem

These APIs are not **predictable**.

If I were to show you `DSButton`'s API surface, would you be able to tell how to add an `Image` to the `Chip`? How do you make the text in your `Banner` centered? Some components set their properties via the initializer, while others take it through a `ViewModifier` or perhaps an environment value.

And how do you handle **discoverability** in these approaches? How do you know what properties are supported and how to use them?

In such cases, what happens is that you find yourself peeking into the codebase to find existing usages of the component, or even look into the component implementation to figure out what it supports and how to use it properly.

A design system should reduce those questions, not introduce another set of conventions developers have to memorize.

Ideally, once you understand how one component is constructed and configured, you should have a good idea of how the next one works. The API should feel predictable enough that developers rarely need to inspect the implementation just to use a component correctly. The developer-facing API should be as consistent as the visual system itself.

## Design the call site first

The goal is to design a SwiftUI design system API with a clear and predictable shape, so developers could build consistent interfaces quickly and understand how unfamiliar components should be configured based on the ones they already know.

This requires us to separate responsibilities between the initializer, component-specific configuration methods, generic `ViewModifier`s, styles, and environment values.

For a button, this is the call site I imagine:

```swift
DSButton(
    "Continue",
    image: Image(systemName: "arrow.right")
) {
    submit()
}
.dsSize(.small)
.dsVariant(.outlined)
```

In this example, the initializer describes the component's **content and behavior** (the **what**):

- title
- optional image
- action

The configuration methods describe separate presentation dimensions supported by the design system (the **how**):

- size
- visual variant

Together, these two choices produce a small, predictable set of presentations:

![Six presentations produced by DSButton.Size and DSButton.Variant](./_assets/swiftui-design-system-button-variants-light.png 'theme-preview-light')

![Six presentations produced by DSButton.Size and DSButton.Variant](./_assets/swiftui-design-system-button-variants-dark.png 'theme-preview-dark')

SwiftUI gives us several ways to implement this API. Before comparing them, let's look at `size`. It affects the button's internal layout, including the spacing between its icon and title. Any approach we choose therefore needs a way to influence that private layout.

```swift
public enum Size {
    case small
    case large

    var contentSpacing: CGFloat {
        switch self {
        case .small:
            Spacing.small
        case .large:
            Spacing.medium
        }
    }
}


public var body: some View {
    Button(action: action) {
        HStack(spacing: size.contentSpacing) {
            if let image {
                DSImage(image)
            }

            DSLabel(title)
        }
    }
}
```

## The `ViewModifier`

`ViewModifier` looks like the obvious choice. It gives us familiar dot syntax and is designed for reusable view transformations.

```swift
struct ButtonSizeModifier: ViewModifier {
    let size: DSButton.Size

    func body(content: Content) -> some View {
        content // There is no access to DSButton's internal HStack here
    }
}

extension View {
    func dsSize(_ size: DSButton.Size) -> some View {
        modifier(ButtonSizeModifier(size: size))
    }
}
```

The `ViewModifier` receives an opaque `content` parameter, which it can use to wrap the button as a whole. However, it has no access to the private `HStack` where `contentSpacing` must be applied.

### `ViewModifier` Scope and Discoverability

Another issue is scope. Custom modifiers are often exposed through extensions on `View`, which makes them available even on views where they have no meaningful effect.

As a design system grows, this can make autocomplete noisy and make it harder to distinguish component-specific configuration from modifiers intended for the rest of the system.

SwiftUI's own modifiers have the same broad scope. For example, all of these calls compile:

```swift
Button("Continue")
    .textFieldStyle(.roundedBorder)

Text("Welcome")
    .buttonStyle(.borderedProminent)

Image(systemName: "bell")
    .toggleStyle(.switch)

Button("Submit") {}
    .pickerStyle(.segmented)
```

Why does a `Button` offer a `textFieldStyle` modifier even though it does not contain a `TextField`? The API surface for each component should be minimal and have only what is required.

Protocols can narrow this API surface to the components you own, but they do not change the underlying boundary: a `ViewModifier` still cannot inspect private component state or configure internal layout.

## `ButtonStyle`

Since the component is a button, `ButtonStyle` is another option. SwiftUI uses it to switch between built-in button presentations:

```swift
Button("Sign In") {}
    .buttonStyle(.bordered)
```

A custom style can also use state that SwiftUI owns, such as whether the button is pressed:

```swift
struct PressFeedbackStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}
```

This is exactly what `ButtonStyle` is good at. The limitation is that [`ButtonStyle.Configuration`](https://developer.apple.com/documentation/swiftui/buttonstyleconfiguration) exposes the label as an opaque view, along with state known by SwiftUI such as `isPressed` and `role`. It does not expose the label's internal `HStack`, icon, or text as independently configurable views, which is the access we need to change `contentSpacing`.

## Custom styles

Another option is to define our own configuration and style protocol, similar to SwiftUI's `ButtonStyle`:

```swift
public struct DSButtonStyleConfiguration {
    public let title: String
    public let image: Image?
}

public protocol DSButtonStyle {
    associatedtype Body: View

    @ViewBuilder
    func makeBody(
        configuration: DSButtonStyleConfiguration
    ) -> Body
}
```

A style can then build the button's presentation from that configuration:

```swift
struct DefaultDSButtonStyle: DSButtonStyle {
    let size: DSButton.Size

    func makeBody(
        configuration: DSButtonStyleConfiguration
    ) -> some View {
        HStack(spacing: size.contentSpacing) {
            if let image = configuration.image {
                DSImage(image)
            }

            DSLabel(configuration.title)
        }
    }
}
```

Custom styles make more sense when we want to support very different versions of the same component. For example, a regular button, an icon-only button, and a floating action button could have completely different layouts while still representing the same kind of action.

That's not really what we need here. `size` and `variant` are just a few supported ways to configure `DSButton`. We don't want callers to replace how the button is built. We only want them to choose between the options the component already supports.

A custom style would give us more flexibility than we actually need.

## Environment values

The environment is another way to make configuration available inside a component. It works well when the value is meant to cascade through a hierarchy. SwiftUI uses it for things such as locale, layout direction, tint, control size, and styles.

```swift
VStack {
    Button("Save") {}
    Button("Delete", role: .destructive) {}
}
.buttonStyle(.borderedProminent)
```

That same behavior makes the environment risky for local presentation choices:

```swift
VStack {
    DSButton("Continue") {
        submit()
    }

    DetailsView()
}
.environment(\.dsButtonSize, .large)
```

Every descendant that reads `dsButtonSize` now inherits `.large`, including buttons buried inside `DetailsView`. Sometimes that is exactly what we want. But in general, this is a loss of local reasoning. Looking at the button's call site is no longer enough to understand its configuration; you may need to walk up the view hierarchy to find the environment value that affected it.

However, themes are a good fit for this model because they apply across many components. Instead of passing the current theme into every initializer, we can set it once at the boundary where it applies:

```swift
DetailsView()
    .environment(\.dsTheme, .primary)
```

Components inside that view can read the theme directly:

```swift
public struct DSButton: View {
    @Environment(\.dsTheme) private var theme

    // Use theme for colors
}
```

Since the environment passes the theme to every descendant automatically, a design system component does not need a `theme` parameter at every call site. This is useful because the theme is contextual. It describes how an entire part of the user interface should look, rather than a local choice made for one component.

I reserve environment values for configuration that really is contextual or inherited:

- themes
- product or brand surfaces
- styles intentionally shared by all matching descendants

## The approach I settled on

The simplest option turned out to be a copy-and-return method. The component stores its presentation properties. Each method creates a copy, changes one property, and returns the copy.

```swift
public struct DSButton: View {

    public enum Size {
        case small
        case large

        var contentSpacing: CGFloat {
            switch self {
            case .small:
                Spacing.small
            case .large:
                Spacing.medium
            }
        }
    }

    // This has no effect in this implementation, just an example
    public enum Variant {
        case filled
        case outlined
        case plain
    }

    // MARK: - What the component is

    private let title: String
    private let image: Image?
    private let action: () -> Void

    // MARK: - Presentation of the component

    private var size: Size = .large
    private var variant: Variant = .filled

    public init(
        _ title: String,
        image: Image? = nil,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.image = image
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: size.contentSpacing) {
                if let image {
                    DSImage(image)
                }

                DSLabel(title)
            }
        }
    }

    // MARK: - Private helpers
    // ...

    // MARK: - Copy-and-return functions

    public func dsSize(_ size: Size) -> Self {
        var copy = self
        copy.size = size
        return copy
    }

    public func dsVariant(_ variant: Variant) -> Self {
        var copy = self
        copy.variant = variant
        return copy
    }
}
```

The component's `body` now uses its stored `size` while constructing the internal `HStack`. The call site still deals only with the supported `size` and `variant` presentation choices.

One consequence of defining these methods directly on `DSButton` is that they need to come before generic SwiftUI modifiers that change the resulting view type:

```swift
DSButton("Continue") {
    submit()
}
.dsSize(.small)
.frame(maxWidth: .infinity)
```

> These methods are intentionally non-mutating. A mutating method cannot be called on the temporary value produced by DSButton(...), while copying and returning Self gives us the chainable value-transforming API we want.

## Discoverability

Prefixing design system methods with `.ds` helps discoverability by narrowing autocomplete to the design system options. Without the prefix, names such as `.size` and `.variant` appear beside a large number of unrelated SwiftUI modifiers.

By keeping the `.ds` prefix, typing those characters narrows autocomplete to the design system options available for that component:

```swift
DSButton("Save") {
    save()
}
.dsSize(.small)
.dsVariant(.outlined)
```

## A practical rule of thumb

These patterns are not competing solutions to the same problem. They operate at different layers and are often most useful together.

For a typical design system button, that can mean using several mechanisms together:

- a native `Button` for behavior and accessibility
- copy-and-return methods for component-specific choices such as `size` and `variant`
- an internal `ButtonStyle` for interaction states such as `isPressed`
- environment values for contextual values such as themes

The goal is not to pick one abstraction and use it everywhere. It is to put each decision in the layer that already has the information needed to make it.

The pattern I now use for components is:

**The initializer describes what the component is.** Required content and behavior belong here:

```swift
DSButton(
    "Continue",
    image: Image(systemName: "arrow.right"),
    action: submit
)
```

**Component-specific methods describe the supported presentation.** These are presentation choices owned by the component:

```swift
.dsSize(.small)
.dsVariant(.outlined)
```

**Generic SwiftUI modifiers stay generic.**

```swift
.frame(maxWidth: .infinity)
.disabled(isSubmitting)
.accessibilityHint("Submits the current form")
```

### Choosing the right approach

| Approach               | Best Used When                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Initializer**        | Required content and behavior that define what the component is                                               |
| **ViewModifier**       | Transformations that do not need direct access to component-owned state or internal layout                    |
| **ButtonStyle**        | Styling the button's content and reacting to state such as `isPressed`                                        |
| **Custom Style**       | Supporting substantially different implementations of the same component                                      |
| **Copy-and-return**    | Closed, component-specific presentation choices, especially when they affect private state or internal layout |
| **Environment Values** | Contextual values, such as themes, that should be inherited by descendants                                    |

## Conclusion

There are other ways to configure SwiftUI components (see [1](https://movingparts.io/styling-components-in-swiftui#dynamic-property), [2](https://hop.ie/blog/design-system-swift/)), each with different tradeoffs around type safety, scope, and implementation complexity. In this case, copy-and-return methods gave me the simplest way to keep component-specific configuration local while leaving internal layout decisions inside the component.

Predictability does not come from forcing every configuration option through the same SwiftUI mechanism. It comes from giving each decision a consistent place: content and behavior in the initializer, component-owned presentation in component-specific methods, interaction state in styles, and inherited context in the environment.

Once that boundary is consistent across the design system, learning one component helps you understand the next. The API becomes easier to discover, harder to misuse, and as consistent in code as the design system is on screen.
