// Regenerate the article previews:
// xcrun swiftc -parse-as-library scripts/render-design-system-button-preview.swift -o /tmp/render-design-system-button-preview
// /tmp/render-design-system-button-preview light src/content/posts/_assets/swiftui-design-system-button-variants-light.png
// /tmp/render-design-system-button-preview dark src/content/posts/_assets/swiftui-design-system-button-variants-dark.png

import AppKit
import SwiftUI

private struct DSButton: View {
    enum Size {
        case small
        case large
    }

    enum Variant: String, CaseIterable {
        case filled
        case outlined
        case plain
    }

    private let title: String
    private let image: Image?
    private let action: () -> Void

    private var size: Size = .large
    private var variant: Variant = .filled

    init(
        _ title: String,
        image: Image? = nil,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.image = image
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: contentSpacing) {
                if let image {
                    image
                        .imageScale(imageScale)
                }

                Text(title)
                    .font(font)
            }
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .background(backgroundColor, in: Capsule())
            .overlay {
                Capsule()
                    .stroke(
                        borderColor,
                        lineWidth: variant == .outlined ? 1 : 0
                    )
            }
        }
        .buttonStyle(.plain)
    }

    func dsSize(_ size: Size) -> Self {
        var copy = self
        copy.size = size
        return copy
    }

    func dsVariant(_ variant: Variant) -> Self {
        var copy = self
        copy.variant = variant
        return copy
    }

    private var contentSpacing: CGFloat {
        switch size {
        case .small: 6
        case .large: 12
        }
    }

    private var font: Font {
        switch size {
        case .small: .subheadline.weight(.semibold)
        case .large: .body.weight(.semibold)
        }
    }

    private var imageScale: Image.Scale {
        switch size {
        case .small: .small
        case .large: .medium
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .small: 12
        case .large: 16
        }
    }

    private var verticalPadding: CGFloat {
        switch size {
        case .small: 8
        case .large: 12
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .filled: .white
        case .outlined, .plain: .accentColor
        }
    }

    private var backgroundColor: Color {
        switch variant {
        case .filled: .accentColor
        case .outlined, .plain: .clear
        }
    }

    private var borderColor: Color {
        switch variant {
        case .outlined: .accentColor
        case .filled, .plain: .clear
        }
    }
}

private enum PreviewTheme: String {
    case light
    case dark

    var colorScheme: ColorScheme {
        switch self {
        case .light: .light
        case .dark: .dark
        }
    }

    var accent: Color {
        switch self {
        case .light: Color(red: 0.29, green: 0.29, blue: 0.78)
        case .dark: Color(red: 0.52, green: 0.52, blue: 1)
        }
    }

    var canvas: Color {
        switch self {
        case .light: Color(red: 0.965, green: 0.965, blue: 0.95)
        case .dark: Color(red: 0.11, green: 0.11, blue: 0.11)
        }
    }

    var secondaryText: Color {
        switch self {
        case .light: Color.black.opacity(0.48)
        case .dark: Color.white.opacity(0.48)
        }
    }

    var primaryText: Color {
        switch self {
        case .light: Color.black.opacity(0.85)
        case .dark: Color.white.opacity(0.9)
        }
    }
}

private struct ButtonVariantPreview: View {
    let theme: PreviewTheme

    private let columnWidth: CGFloat = 123

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("One component, six presentations")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.primaryText)

            HStack(spacing: 10) {
                Color.clear
                    .frame(width: 76, height: 1)

                columnLabel(".small", width: columnWidth)
                columnLabel(".large", width: columnWidth)
            }

            ForEach(DSButton.Variant.allCases, id: \.self) { variant in
                HStack(spacing: 10) {
                    Text(".\(variant.rawValue)")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(theme.secondaryText)
                        .frame(width: 76, alignment: .leading)

                    DSButton(
                        "Continue",
                        image: Image(systemName: "arrow.right")
                    ) {}
                        .dsSize(.small)
                        .dsVariant(variant)
                        .frame(width: columnWidth)

                    DSButton(
                        "Continue",
                        image: Image(systemName: "arrow.right")
                    ) {}
                        .dsSize(.large)
                        .dsVariant(variant)
                        .frame(width: columnWidth)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(28)
        .frame(width: 400, height: 336, alignment: .topLeading)
        .background(theme.canvas)
        .accentColor(theme.accent)
        .preferredColorScheme(theme.colorScheme)
    }

    private func columnLabel(_ text: String, width: CGFloat) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(theme.secondaryText)
            .frame(width: width)
    }
}

@main
@MainActor
private struct PreviewRenderer {
    static func main() throws {
        guard
            CommandLine.arguments.count == 3,
            let theme = PreviewTheme(rawValue: CommandLine.arguments[1])
        else {
            fputs("Usage: render-design-system-button-preview.swift <light|dark> <output.png>\n", stderr)
            Foundation.exit(64)
        }

        _ = NSApplication.shared

        let renderer = ImageRenderer(content: ButtonVariantPreview(theme: theme))
        renderer.scale = 2

        guard
            let image = renderer.nsImage,
            let tiffData = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiffData),
            let pngData = bitmap.representation(using: .png, properties: [:])
        else {
            fputs("Unable to render the SwiftUI preview.\n", stderr)
            Foundation.exit(1)
        }

        let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
        try pngData.write(to: outputURL, options: .atomic)
    }
}
