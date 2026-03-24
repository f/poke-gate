import SwiftUI

struct SettingsView: View {
    @ObservedObject var service: GateService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("AUTHENTICATION")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .textCase(.uppercase)
                    .tracking(0.5)

                HStack(spacing: 8) {
                    Image(systemName: service.hasPokeLoginCredentials
                          ? "checkmark.shield.fill" : "shield.slash")
                        .foregroundStyle(service.hasPokeLoginCredentials ? .green : .orange)
                        .font(.title3)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(service.hasPokeLoginCredentials
                             ? "Signed in via Poke"
                             : "Not signed in")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        if service.hasPokeLoginCredentials {
                            Text("Your Poke session is active.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Run this command in Terminal to sign in:")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.5))
                .cornerRadius(8)

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

            VStack(alignment: .leading, spacing: 8) {
                Text("CONNECTION")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .textCase(.uppercase)
                    .tracking(0.5)

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
                .background(.quaternary.opacity(0.5))
                .cornerRadius(8)
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
        .frame(width: 380)
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
