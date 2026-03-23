import SwiftUI

struct SettingsView: View {
    @ObservedObject var service: GateService
    @State private var apiKeyInput: String = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Poke Gate Settings")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                Text("API Key")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                SecureField("Paste your API key", text: $apiKeyInput)
                    .textFieldStyle(.roundedBorder)

                Link("Get your key at poke.com/kitchen/api-keys",
                     destination: URL(string: "https://poke.com/kitchen/api-keys")!)
                    .font(.caption)
                    .foregroundStyle(.blue)
            }

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Save") {
                    service.apiKey = apiKeyInput
                    dismiss()
                    service.restart()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(apiKeyInput.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
        .onAppear {
            apiKeyInput = service.apiKey
        }
    }
}
