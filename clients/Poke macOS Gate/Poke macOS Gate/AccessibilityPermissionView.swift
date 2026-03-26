import SwiftUI

struct AccessibilityPermissionView: View {
    @ObservedObject var service: GateService

    var body: some View {
        let granted = service.hasSystemPermissionsGranted

        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: granted ? "checkmark.seal.fill" : "exclamationmark.shield.fill")
                    .font(.headline)
                    .foregroundStyle(granted ? Color.green : Color.orange)

                VStack(alignment: .leading, spacing: 1) {
                    Text(granted ? "Accessibility granted" : "Accessibility permission needed")
                        .font(.subheadline)
                        .fontWeight(.semibold)

                    Text(granted
                        ? "Poke Gate can now use keyboard and mouse automation."
                        : "Open macOS Accessibility settings and enable Poke Gate.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }

            if granted {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Granted")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                }
            } else {
                Button {
                    service.openSystemPermission(.accessibility)
                } label: {
                    Label("Open Accessibility Settings", systemImage: "hand.raised.app")
                        .font(.subheadline)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)

                Text("After enabling it, return here and the status will update automatically.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(12)
        .macPanelStyle(granted ? .success : .warning, cornerRadius: 12)
        .animation(.easeInOut(duration: 0.2), value: granted)
    }
}
