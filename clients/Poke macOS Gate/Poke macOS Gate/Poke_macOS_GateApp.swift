import SwiftUI

@main
struct Poke_macOS_GateApp: App {
    @StateObject private var service = GateService()

    var body: some Scene {
        MenuBarExtra {
            MenuBarContent(service: service)
                .onAppear { service.autoStartIfNeeded() }
        } label: {
            Image(systemName: menuBarIcon)
        }

        Window("Logs", id: "logs") {
            LogsView(service: service)
        }
        .defaultSize(width: 480, height: 320)

        Window("Settings", id: "settings") {
            SettingsView(service: service)
        }
        .windowResizability(.contentSize)
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

struct MenuBarContent: View {
    @ObservedObject var service: GateService
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Label(service.status.rawValue, systemImage: statusIcon)
            .foregroundStyle(statusColor)

        Divider()

        Button("View Logs…") {
            NSApp.activate(ignoringOtherApps: true)
            openWindow(id: "logs")
        }

        Button("Settings…") {
            NSApp.activate(ignoringOtherApps: true)
            openWindow(id: "settings")
        }

        Divider()

        if service.status == .connected || service.status == .starting || service.status == .disconnected {
            Button("Restart") {
                service.restart()
            }
        } else {
            Button("Start") {
                service.start()
            }
        }

        Divider()

        Button("Quit Poke Gate") {
            service.stop()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                NSApp.terminate(nil)
            }
        }
        .keyboardShortcut("q")

        Divider()

        Text("Poke Gate v0.0.3")
            .font(.caption)
            .foregroundStyle(.secondary)
        Text("Community project — not affiliated with Poke")
            .font(.caption2)
            .foregroundStyle(.secondary)
        Button("GitHub") {
            NSWorkspace.shared.open(URL(string: "https://github.com/f/poke-gate")!)
        }
        .font(.caption)
    }

    private var statusIcon: String {
        switch service.status {
        case .connected: "circle.fill"
        case .starting, .disconnected: "circle.dotted"
        case .error: "exclamationmark.circle.fill"
        case .stopped: "circle"
        }
    }

    private var statusColor: Color {
        switch service.status {
        case .connected: .green
        case .starting, .disconnected: .yellow
        case .error: .red
        case .stopped: .secondary
        }
    }
}
