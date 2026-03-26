import SwiftUI

enum MacPanelTone {
    case neutral
    case selected
    case success
    case warning
}

fileprivate struct MacPanelColors {
    let fill: Color
    let stroke: Color
}

enum MacVisualStyle {
    static var usesNativeFirstChrome: Bool {
        if #available(macOS 26, *) {
            return true
        }

        return false
    }

    static var sectionTitleColor: Color {
        Color.secondary.opacity(usesNativeFirstChrome ? 0.9 : 0.7)
    }

    static var progressTrackColor: Color {
        Color.secondary.opacity(usesNativeFirstChrome ? 0.16 : 0.22)
    }

    static var chipActiveFill: Color {
        usesNativeFirstChrome ? Color.accentColor.opacity(0.9) : Color.accentColor
    }

    static var chipInactiveFill: Color {
        Color.secondary.opacity(usesNativeFirstChrome ? 0.1 : 0.14)
    }

    fileprivate static func panelColors(for tone: MacPanelTone) -> MacPanelColors {
        switch tone {
        case .neutral:
            return MacPanelColors(
                fill: Color.primary.opacity(usesNativeFirstChrome ? 0.02 : 0.05),
                stroke: Color.primary.opacity(usesNativeFirstChrome ? 0.05 : 0.08)
            )
        case .selected:
            return MacPanelColors(
                fill: Color.accentColor.opacity(usesNativeFirstChrome ? 0.08 : 0.12),
                stroke: Color.accentColor.opacity(usesNativeFirstChrome ? 0.2 : 0.35)
            )
        case .success:
            return MacPanelColors(
                fill: Color.green.opacity(usesNativeFirstChrome ? 0.05 : 0.06),
                stroke: Color.green.opacity(usesNativeFirstChrome ? 0.18 : 0.3)
            )
        case .warning:
            return MacPanelColors(
                fill: Color.orange.opacity(usesNativeFirstChrome ? 0.05 : 0.06),
                stroke: Color.orange.opacity(usesNativeFirstChrome ? 0.18 : 0.28)
            )
        }
    }
}

private struct MacPanelModifier: ViewModifier {
    let tone: MacPanelTone
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let colors = MacVisualStyle.panelColors(for: tone)

        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(colors.fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(colors.stroke, lineWidth: 1)
            )
    }
}

extension View {
    func macPanelStyle(_ tone: MacPanelTone, cornerRadius: CGFloat = 10) -> some View {
        modifier(MacPanelModifier(tone: tone, cornerRadius: cornerRadius))
    }
}
