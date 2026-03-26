import SwiftUI

struct SetupView: View {
    @ObservedObject var service: GateService
    @State private var selectedMode: GateService.PermissionMode
    @State private var step: Step = .accessMode

    enum Step { case accessMode, permissions }

    init(service: GateService) {
        self.service = service
        _selectedMode = State(initialValue: service.permissionMode)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            stepIndicator
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 12)

            Divider()

            switch step {
            case .accessMode: accessModeStep
            case .permissions: permissionsStep
            }
        }
        .frame(width: 380)
        .onAppear { service.startPermissionPolling() }
        .onDisappear { service.stopPermissionPolling() }
    }

    private var stepIndicator: some View {
        HStack(spacing: 6) {
            ForEach(Array(Step.allCases.enumerated()), id: \.offset) { index, s in
                HStack(spacing: 4) {
                    Circle()
                        .fill(s == step ? MacVisualStyle.chipActiveFill : (isCompleted(s) ? Color.accentColor.opacity(0.5) : MacVisualStyle.chipInactiveFill))
                        .frame(width: 6, height: 6)
                    Text(s.label)
                        .font(.caption2)
                        .foregroundStyle(s == step ? .primary : .secondary)
                }
                if index < Step.allCases.count - 1 {
                    Rectangle()
                        .fill(MacVisualStyle.progressTrackColor)
                        .frame(height: 1)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private var accessModeStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Choose access mode")
                    .font(.headline)
                Text("Controls which tools Poke can use on this machine.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 8) {
                ForEach(GateService.PermissionMode.allCases) { mode in
                    modeRow(mode)
                }
            }

            HStack {
                Spacer()
                Button("Continue") { step = .permissions }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
    }

    private var permissionsStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Grant permissions")
                    .font(.headline)
                Text("These allow Poke to control your Mac. You can grant them now or later from the menu bar.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 10) {
                ForEach(GateService.SystemPermission.allCases) { permission in
                    let status = service.systemPermissionStatuses.first(where: { $0.permission == permission })
                    PermissionRowView(
                        permission: permission,
                        isGranted: status?.isGranted ?? false,
                        onGrant: { service.openSystemPermission(permission) }
                    )
                }
            }

            HStack {
                Button("Back") { step = .accessMode }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)

                Spacer()

                Button("Finish Setup") {
                    service.completeFirstRunSetup(selectedMode: selectedMode, requestPermissions: false)
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
    }

    private func modeRow(_ mode: GateService.PermissionMode) -> some View {
        Button { selectedMode = mode } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: selectedMode == mode ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selectedMode == mode ? Color.accentColor : Color.secondary)

                VStack(alignment: .leading, spacing: 2) {
                    Text(mode.title)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                    Text(mode.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(10)
            .macPanelStyle(selectedMode == mode ? .selected : .neutral)
        }
        .buttonStyle(.plain)
    }

    private func isCompleted(_ s: Step) -> Bool {
        switch s {
        case .accessMode: return step == .permissions
        case .permissions: return false
        }
    }
}

extension SetupView.Step: CaseIterable {
    static var allCases: [SetupView.Step] { [.accessMode, .permissions] }

    var label: String {
        switch self {
        case .accessMode: return "Access Mode"
        case .permissions: return "Permissions"
        }
    }
}
