import SwiftUI

struct SettingsView: View {
    @ObservedObject var service: GateService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Poke Gate Settings")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                Label("Authentication uses Poke OAuth", systemImage: "checkmark.shield")
                    .font(.subheadline)

                Text("Poke Gate signs in automatically when needed.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("If you're not signed in yet, a browser window will open during connection.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if service.hasPokeLoginCredentials {
                    Label("Existing Poke session detected", systemImage: "person.crop.circle.badge.checkmark")
                        .foregroundStyle(.green)
                        .font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack {
                Button("Close") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Reconnect") {
                    dismiss()
                    service.restart()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 380)
    }
}
