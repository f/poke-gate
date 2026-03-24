import SwiftUI

struct LogsView: View {
    @ObservedObject var service: GateService

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(service.logs.count) entries")
                    .font(.caption)
                    .foregroundStyle(.tertiary)

                Spacer()

                Button {
                    let text = service.logs.joined(separator: "\n")
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Copy all logs")

                Button {
                    service.logs.removeAll()
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Clear logs")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(Array(service.logs.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(lineColor(line))
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(index % 2 == 0 ? Color.clear : Color.primary.opacity(0.02))
                                .id(index)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .onChange(of: service.logs.count) { _, _ in
                    if let last = service.logs.indices.last {
                        withAnimation(.easeOut(duration: 0.15)) {
                            proxy.scrollTo(last, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .frame(minWidth: 480, minHeight: 300)
    }

    private func lineColor(_ line: String) -> Color {
        if line.contains("error") || line.contains("Error") || line.contains("failed") {
            return .red
        }
        if line.contains("tool:") || line.contains("$") {
            return .primary
        }
        return .secondary
    }
}
