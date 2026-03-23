import SwiftUI

struct LogsView: View {
    @ObservedObject var service: GateService

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Logs")
                    .font(.headline)
                Spacer()
                Button("Clear") {
                    service.logs.removeAll()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .font(.caption)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(service.logs.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .id(index)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .onChange(of: service.logs.count) { _, _ in
                    if let last = service.logs.indices.last {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
            }
        }
        .frame(width: 480, height: 320)
    }
}
