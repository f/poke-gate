import SwiftUI
import ServiceManagement

class AppDelegate: NSObject, NSApplicationDelegate {
    var service: GateService?

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard url.scheme == "poke-gate" else { continue }
            if url.host == "screenshot" {
                service?.captureAndSend()
            }
        }
    }
}

@main
struct Poke_macOS_GateApp: App {
    @StateObject private var service = GateService()
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    var body: some Scene {
        MenuBarExtra {
            PopoverContent(service: service)
                .onAppear {
                    service.autoStartIfNeeded()
                    appDelegate.service = service
                    service.startPermissionPolling()
                }
                .onDisappear {
                    service.stopPermissionPolling()
                }
        } label: {
            Image(systemName: menuBarIcon)
        }
        .menuBarExtraStyle(.window)

        Window("Logs", id: "logs") {
            LogsView(service: service)
        }
        .defaultSize(width: 560, height: 400)

        Window("Setup", id: "setup") {
            SetupView(service: service)
        }
        .windowResizability(.contentSize)

        Window("Settings", id: "settings") {
            SettingsView(service: service)
        }
        .windowResizability(.contentSize)

        Window("Agents", id: "agents") {
            AgentsView()
        }
        .defaultSize(width: 700, height: 480)

        Window("About", id: "about") {
            AboutView()
        }
        .windowResizability(.contentSize)
    }

    private func checkLoginItemPrompt() {
        let dismissed = UserDefaults.standard.bool(forKey: "loginItemPromptDismissed")
        let alreadyEnabled = SMAppService.mainApp.status == .enabled
        if dismissed || alreadyEnabled { return }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            let alert = NSAlert()
            alert.messageText = "Start on login?"
            alert.informativeText = "Would you like Poke Gate to start automatically when you log in?"
            alert.addButton(withTitle: "Enable")
            alert.addButton(withTitle: "Not now")
            alert.addButton(withTitle: "Don't ask again")
            alert.alertStyle = .informational

            NSApp.activate(ignoringOtherApps: true)
            let response = alert.runModal()

            switch response {
            case .alertFirstButtonReturn:
                try? SMAppService.mainApp.register()
                UserDefaults.standard.set(true, forKey: "loginItemPromptDismissed")
            case .alertSecondButtonReturn:
                break
            case .alertThirdButtonReturn:
                UserDefaults.standard.set(true, forKey: "loginItemPromptDismissed")
            default:
                break
            }
        }
    }

    private var menuBarIcon: String {
        switch service.status {
        case .connected: "door.left.hand.open"
        case .starting, .disconnected: "door.left.hand.closed"
        case .error: "exclamationmark.triangle"
        case .stopped: "door.left.hand.closed"
        }
    }
}

struct PopoverContent: View {
    @ObservedObject var service: GateService
    @Environment(\.openWindow) private var openWindow
    @State private var pendingFullMode = false

    var body: some View {
        if !service.hasCompletedSetup {
            SetupView(service: service)
        } else {
            VStack(spacing: 10) {
                statusSection
                recentActivitySection
                accessModeSection
                actionsSection
                footerSection
            }
            .frame(width: 320)
            .padding(10)
            .onChange(of: service.hasSystemPermissionsGranted) { _, granted in
                if granted && pendingFullMode {
                    pendingFullMode = false
                    service.setPermissionMode(.full)
                }
            }
        }
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 10, height: 10)

                Text(statusText)
                    .font(.system(.body, weight: .medium))

                Spacer()
            }

            statusMessage
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .macPanelStyle(.neutral, cornerRadius: 12)
    }

    @ViewBuilder
    private var statusMessage: some View {
        switch service.status {
        case .connected:
            Text("This machine is accessible via Poke. Ask your Poke to run commands or read files.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        case .starting:
            Text("Establishing connection…")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .error:
            Text("Check Logs for details.")
                .font(.caption)
                .foregroundStyle(.red.opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
        case .disconnected, .stopped:
            EmptyView()
        }
    }

    private var recentActivitySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Recent activity")

            if service.terminalPreviews.isEmpty {
                Text("No activity yet")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(service.terminalPreviews.suffix(4).enumerated()), id: \.element.id) { _, entry in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(entry.exitCode == 0 ? Color.green : (entry.exitCode == nil ? Color.gray : Color.red))
                            .frame(width: 5, height: 5)
                        Text("$ \(entry.command)")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .macPanelStyle(.neutral, cornerRadius: 12)
    }

    private var accessModeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionTitle("Access mode")
                Spacer()
                Text(service.permissionMode.title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 6) {
                ForEach(GateService.PermissionMode.allCases) { mode in
                    let isActive = service.permissionMode == mode || (mode == .full && pendingFullMode)
                    Button {
                        handleModeSelection(mode)
                    } label: {
                        Text(modeChipTitle(mode))
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(isActive ? .white : .secondary)
                            .padding(.vertical, 5)
                            .padding(.horizontal, 8)
                            .background(isActive ? MacVisualStyle.chipActiveFill : MacVisualStyle.chipInactiveFill)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }

            if service.permissionMode == .full || pendingFullMode {
                AccessibilityPermissionView(service: service)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .macPanelStyle(.neutral, cornerRadius: 12)
    }

    private var actionsSection: some View {
        HStack(spacing: 12) {
            ActionButton(icon: "text.alignleft", label: "Logs") {
                NSApp.activate(ignoringOtherApps: true)
                openWindow(id: "logs")
            }

            ActionButton(icon: "bolt.fill", label: "Agents") {
                NSApp.activate(ignoringOtherApps: true)
                openWindow(id: "agents")
            }

            ActionButton(icon: "gearshape", label: "Settings") {
                NSApp.activate(ignoringOtherApps: true)
                openWindow(id: "settings")
            }

            if service.status == .connected || service.status == .starting || service.status == .disconnected {
                ActionButton(icon: "arrow.counterclockwise", label: "Restart") {
                    service.restart()
                }
            } else {
                ActionButton(icon: "play.fill", label: "Start") {
                    service.start()
                }
            }

            Spacer()

            ActionButton(icon: "xmark.circle", label: "Quit", tint: .secondary) {
                service.stop()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    NSApp.terminate(nil)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .macPanelStyle(.neutral, cornerRadius: 12)
    }

    private var footerSection: some View {
        HStack {
            Button {
                NSApp.activate(ignoringOtherApps: true)
                openWindow(id: "about")
            } label: {
                Text(appVersionText)
                    .font(.caption2)
                    .foregroundStyle(MacVisualStyle.sectionTitleColor)
            }
            .buttonStyle(.plain)

            Spacer()

            Text("Not affiliated with Poke")
                .font(.caption2)
                .foregroundStyle(MacVisualStyle.sectionTitleColor.opacity(0.7))
        }
        .padding(.horizontal, 6)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(MacVisualStyle.sectionTitleColor)
            .textCase(.uppercase)
            .tracking(0.5)
    }

    private var statusText: String {
        switch service.status {
        case .connected:
            if let name = service.userName {
                return "Connected to your Poke, \(name)"
            }
            return "Connected to your Poke"
        case .starting: return "Connecting…"
        case .disconnected: return "Reconnecting…"
        case .error: return "Connection error"
        case .stopped: return "Stopped"
        }
    }

    private var statusColor: Color {
        switch service.status {
        case .connected: .green
        case .starting, .disconnected: .yellow
        case .error: .red
        case .stopped: .gray.opacity(0.5)
        }
    }

    private func modeChipTitle(_ mode: GateService.PermissionMode) -> String {
        switch mode {
        case .full: return "Full"
        case .limited: return "Limited"
        case .sandbox: return "Sandbox"
        }
    }

    private func handleModeSelection(_ mode: GateService.PermissionMode) {
        guard mode != service.permissionMode else { return }

        if mode == .full && !service.hasSystemPermissionsGranted {
            pendingFullMode = true
            service.openSystemPermission(.accessibility)
        } else {
            pendingFullMode = false
            service.setPermissionMode(mode)
        }
    }

    private var appVersionText: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String

        if let build, !build.isEmpty, build != short {
            return "Poke Gate v\(short) (\(build))"
        }

        return "Poke Gate v\(short)"
    }
}

struct ActionButton: View {
    let icon: String
    let label: String
    var tint: Color = .primary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                Text(label)
                    .font(.system(size: 9))
            }
            .foregroundStyle(tint)
            .frame(width: 44, height: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
