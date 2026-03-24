import SwiftUI

@main
struct Poke_macOS_GateApp: App {
    @StateObject private var service = GateService()

    var body: some Scene {
        MenuBarExtra {
            PopoverContent(service: service)
                .onAppear { service.autoStartIfNeeded() }
        } label: {
            Image(systemName: menuBarIcon)
        }
        .menuBarExtraStyle(.window)

        Window("Logs", id: "logs") {
            LogsView(service: service)
        }
        .defaultSize(width: 560, height: 400)

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

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 10, height: 10)

                    Text(statusText)
                        .font(.system(.body, weight: .medium))

                    Spacer()
                }

                if service.status == .connected {
                    Text("This machine is accessible via Poke. Ask your Poke to run commands or read files.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                } else if service.status == .starting {
                    Text("Establishing connection…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if service.status == .error {
                    Text("Check Logs for details.")
                        .font(.caption)
                        .foregroundStyle(.red.opacity(0.8))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(12)

            Divider()

            VStack(alignment: .leading, spacing: 4) {
                Text("Recent activity")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .textCase(.uppercase)

                if service.logs.isEmpty {
                    Text("No activity yet")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(service.logs.suffix(4).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)

            Divider()

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

            Divider()

            HStack {
                Button {
                    NSApp.activate(ignoringOtherApps: true)
                    openWindow(id: "about")
                } label: {
                    Text("Poke Gate v0.0.8")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)

                Spacer()

                Text("Not affiliated with Poke")
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .frame(width: 320)
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
