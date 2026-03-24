import SwiftUI

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 80, height: 80)

            Text("Poke Gate")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Version 0.0.8")
                .font(.caption)
                .foregroundStyle(.secondary)

            Text("Let your Poke AI assistant access your machine.\nRun commands, read files, take screenshots — from anywhere.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            VStack(spacing: 4) {
                Text("A community project — not affiliated with Poke")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Text("or The Interaction Company of California.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            HStack(spacing: 16) {
                Link("GitHub", destination: URL(string: "https://github.com/f/poke-gate")!)
                    .font(.caption)

                Link("poke.com", destination: URL(string: "https://poke.com")!)
                    .font(.caption)
            }

            Button("Close") {
                dismiss()
            }
            .keyboardShortcut(.cancelAction)
        }
        .padding(24)
        .frame(width: 300)
    }
}
