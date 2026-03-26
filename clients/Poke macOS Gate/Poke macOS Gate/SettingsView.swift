import SwiftUI
import ServiceManagement

struct SettingsView: View {
    @ObservedObject var service: GateService
    @Environment(\.dismiss) private var dismiss
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            authenticationSection
            accessModeSection
            connectionSection

            VStack(alignment: .leading, spacing: 8) {
                Text("GENERAL")
                    .font(.caption2)
                    .foregroundStyle(MacVisualStyle.sectionTitleColor)
                    .textCase(.uppercase)
                    .tracking(0.5)

                Toggle("Start Poke Gate on login", isOn: $launchAtLogin)
                    .font(.subheadline)
                    .onChange(of: launchAtLogin) { _, newValue in
                        do {
                            if newValue {
                                try SMAppService.mainApp.register()
                            } else {
                                try SMAppService.mainApp.unregister()
                            }
                        } catch {
                            launchAtLogin = !newValue
                        }
                    }
            }

            HStack {
                Spacer()
                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 430)
    }

    private var authenticationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("AUTHENTICATION")

            HStack(spacing: 8) {
                Image(systemName: service.hasPokeLoginCredentials ? "checkmark.shield.fill" : "shield.slash")
                    .foregroundStyle(service.hasPokeLoginCredentials ? .green : .orange)
                    .font(.title3)

                VStack(alignment: .leading, spacing: 2) {
                    Text(service.hasPokeLoginCredentials ? "Signed in via Poke" : "Not signed in")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Text(service.hasPokeLoginCredentials ? "Your Poke session is active." : "Run this command in Terminal to sign in:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .macPanelStyle(.neutral, cornerRadius: 8)

            if !service.hasPokeLoginCredentials {
                Button {
                    service.runPokeLogin()
                } label: {
                    Label("Sign in with Poke", systemImage: "person.crop.circle.badge.plus")
                }
                .controlSize(.large)

                Text("Opens a browser window to sign in.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var accessModeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("ACCESS MODE")

            VStack(spacing: 8) {
                ForEach(GateService.PermissionMode.allCases) { mode in
                    permissionModeRow(mode)
                }
            }

            if service.permissionMode == .full {
                AccessibilityPermissionView(service: service)
            }
        }
    }

    private func permissionModeRow(_ mode: GateService.PermissionMode) -> some View {
        Button {
            service.setPermissionMode(mode)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: service.permissionMode == mode ? "checkmark.circle.fill" : "circle")
                    .font(.headline)
                    .foregroundStyle(service.permissionMode == mode ? .green : .secondary)

                VStack(alignment: .leading, spacing: 2) {
                    Text(mode.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(.primary)

                    Text(mode.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .macPanelStyle(service.permissionMode == mode ? .selected : .neutral)
        }
        .buttonStyle(.plain)
    }

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("CONNECTION")

            HStack(spacing: 8) {
                Circle()
                    .fill(connectionColor)
                    .frame(width: 8, height: 8)

                Text(service.status.rawValue)
                    .font(.subheadline)

                Spacer()

                Button {
                    service.restart()
                } label: {
                    Label("Reconnect", systemImage: "arrow.counterclockwise")
                        .font(.caption)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .macPanelStyle(.neutral, cornerRadius: 8)
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(MacVisualStyle.sectionTitleColor)
            .textCase(.uppercase)
            .tracking(0.5)
    }

    private var connectionColor: Color {
        switch service.status {
        case .connected: .green
        case .starting, .disconnected: .yellow
        case .error: .red
        case .stopped: .gray
        }
    }
}
