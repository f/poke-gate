import SwiftUI
import Combine

struct AgentFile: Identifiable, Hashable {
    let id: String
    var fileName: String
    var name: String
    var agentId: String
    var description: String
    var interval: String
    var path: URL
    var envPath: URL

    var hasEnv: Bool {
        FileManager.default.fileExists(atPath: envPath.path)
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: AgentFile, rhs: AgentFile) -> Bool { lhs.id == rhs.id }
}

@MainActor
class AgentsViewModel: ObservableObject {
    @Published var agents: [AgentFile] = []
    @Published var selectedAgent: AgentFile?
    @Published var editorContent: String = ""
    @Published var showingEnv: Bool = false
    @Published var isRunning: Bool = false
    @Published var lastRunOutput: String = ""

    private var fileWatcher: DispatchSourceFileSystemObject?
    private var dirFD: Int32 = -1

    private var agentsDir: URL {
        let configDir: URL
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] {
            configDir = URL(fileURLWithPath: xdg)
        } else {
            configDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config")
        }
        return configDir
            .appendingPathComponent("poke-gate")
            .appendingPathComponent("agents")
    }

    func startWatching() {
        stopWatching()
        let dir = agentsDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        dirFD = open(dir.path, O_EVTONLY)
        guard dirFD >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: dirFD,
            eventMask: [.write, .rename, .delete, .attrib],
            queue: .main
        )

        source.setEventHandler { [weak self] in
            self?.load()
        }

        source.setCancelHandler { [weak self] in
            if let fd = self?.dirFD, fd >= 0 { close(fd) }
            self?.dirFD = -1
        }

        source.resume()
        fileWatcher = source
    }

    func stopWatching() {
        fileWatcher?.cancel()
        fileWatcher = nil
    }

    func load() {
        let dir = agentsDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter({ $0.pathExtension == "js" }) else { return }

        agents = files.compactMap { url in
            let fileName = url.lastPathComponent
            let base = fileName.replacingOccurrences(of: ".js", with: "")
            let parts = base.split(separator: ".")
            guard parts.count >= 2 else { return nil }

            let interval = String(parts.last!)
            let agentId = parts.dropLast().joined(separator: ".")
            let envPath = dir.appendingPathComponent(".env.\(agentId)")

            let content = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            let meta = parseFrontmatter(content)

            return AgentFile(
                id: fileName,
                fileName: fileName,
                name: meta["name"] ?? agentId,
                agentId: agentId,
                description: meta["description"] ?? "",
                interval: interval,
                path: url,
                envPath: envPath
            )
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func select(_ agent: AgentFile) {
        DispatchQueue.main.async {
            self.selectedAgent = agent
            self.showingEnv = false
            self.loadContent()
        }
    }

    func loadContent() {
        guard let agent = selectedAgent else { return }
        let url = showingEnv ? agent.envPath : agent.path
        let content = (try? String(contentsOf: url, encoding: .utf8)) ?? (showingEnv ? "# No .env file yet\n" : "")
        DispatchQueue.main.async {
            self.editorContent = content
        }
    }

    func save() {
        guard let agent = selectedAgent else { return }
        let url = showingEnv ? agent.envPath : agent.path
        try? editorContent.write(to: url, atomically: true, encoding: .utf8)
    }

    func changeInterval(_ agent: AgentFile, to newInterval: String) {
        let newFileName = "\(agent.agentId).\(newInterval).js"
        let newPath = agentsDir.appendingPathComponent(newFileName)
        guard newPath != agent.path else { return }

        try? FileManager.default.moveItem(at: agent.path, to: newPath)
        load()

        if let updated = agents.first(where: { $0.agentId == agent.agentId }) {
            select(updated)
        }
    }

    func addAgent() {
        let template = """
        /**
         * @agent my-agent
         * @name My Agent
         * @description Describe what this agent does.
         * @interval 1h
         */

        import { Poke, getToken } from "poke";

        const poke = new Poke({ apiKey: getToken() });
        await poke.sendMessage("Hello from my agent!");
        """

        var name = "my-agent"
        var counter = 1
        while agents.contains(where: { $0.agentId == name }) {
            name = "my-agent-\(counter)"
            counter += 1
        }

        let filePath = agentsDir.appendingPathComponent("\(name).1h.js")
        try? template.write(to: filePath, atomically: true, encoding: .utf8)
        load()

        if let newAgent = agents.first(where: { $0.agentId == name }) {
            select(newAgent)
        }
    }

    func runAgent(_ agent: AgentFile) {
        guard !isRunning else { return }
        isRunning = true
        lastRunOutput = ""

        let fullPath = GateService().shellPath()
        let proc = Process()
        let pipe = Pipe()

        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "npx -y poke-gate run-agent \(agent.agentId)"]
        proc.environment = ["HOME": NSHomeDirectory(), "PATH": fullPath]
        proc.standardOutput = pipe
        proc.standardError = pipe
        proc.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        let handle = pipe.fileHandleForReading
        handle.readabilityHandler = { [weak self] fh in
            let data = fh.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.lastRunOutput += text
            }
        }

        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.isRunning = false
            }
        }

        do {
            try proc.run()
        } catch {
            isRunning = false
            lastRunOutput = "Failed to run: \(error.localizedDescription)"
        }
    }

    func deleteAgent(_ agent: AgentFile) {
        try? FileManager.default.removeItem(at: agent.path)
        if agent.hasEnv {
            try? FileManager.default.removeItem(at: agent.envPath)
        }
        if selectedAgent?.id == agent.id {
            selectedAgent = nil
            editorContent = ""
        }
        load()
    }

    private func parseFrontmatter(_ content: String) -> [String: String] {
        guard let match = content.range(of: #"/\*\*[\s\S]*?\*/"#, options: .regularExpression) else { return [:] }
        let block = String(content[match])
        var meta: [String: String] = [:]
        for line in block.split(separator: "\n") {
            let s = String(line)
            if let tagMatch = s.range(of: #"@(\w+)\s+(.*)"#, options: .regularExpression) {
                let tagContent = String(s[tagMatch])
                let parts = tagContent.dropFirst(1).split(separator: " ", maxSplits: 1)
                if parts.count == 2 {
                    meta[String(parts[0])] = parts[1].trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "*/", with: "").trimmingCharacters(in: .whitespaces)
                }
            }
        }
        return meta
    }
}

struct AgentsView: View {
    @StateObject private var viewModel = AgentsViewModel()

    var body: some View {
        NavigationSplitView {
            List(viewModel.agents, selection: Binding(
                get: { viewModel.selectedAgent },
                set: { if let a = $0 { viewModel.select(a) } }
            )) { agent in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(agent.name)
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Spacer()

                        Text(agent.interval)
                            .font(.caption2)
                            .fontWeight(.medium)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.quaternary)
                            .cornerRadius(4)
                    }

                    if !agent.description.isEmpty {
                        Text(agent.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(.vertical, 2)
                .tag(agent)
                .contextMenu {
                    Button("Delete", role: .destructive) {
                        viewModel.deleteAgent(agent)
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 220)
            .safeAreaInset(edge: .bottom) {
                Button {
                    viewModel.addAgent()
                } label: {
                    Label("New Agent", systemImage: "plus")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } detail: {
            if let agent = viewModel.selectedAgent {
                AgentDetailView(viewModel: viewModel, agent: agent)
            } else {
                Text("Select an agent")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear {
            viewModel.load()
            viewModel.startWatching()
        }
        .onDisappear {
            viewModel.stopWatching()
        }
    }
}

struct AgentDetailView: View {
    @ObservedObject var viewModel: AgentsViewModel
    let agent: AgentFile
    @State private var intervalInput: String = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(agent.fileName)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)

                Spacer()

                HStack(spacing: 4) {
                    Text("every")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    TextField("1h", text: $intervalInput)
                        .font(.system(.caption, design: .monospaced))
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 50)
                        .onSubmit {
                            if !intervalInput.isEmpty && intervalInput != agent.interval {
                                viewModel.changeInterval(agent, to: intervalInput)
                            }
                        }
                }

                Button {
                    viewModel.runAgent(agent)
                } label: {
                    Label(viewModel.isRunning ? "Running…" : "Run", systemImage: "play.fill")
                        .font(.caption)
                }
                .disabled(viewModel.isRunning)
                .padding(.leading, 4)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            HStack(spacing: 0) {
                Button {
                    viewModel.showingEnv = false
                    viewModel.loadContent()
                } label: {
                    Text(agent.fileName)
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(viewModel.showingEnv ? Color.clear : Color.accentColor.opacity(0.15))
                }
                .buttonStyle(.plain)

                Button {
                    viewModel.showingEnv = true
                    viewModel.loadContent()
                } label: {
                    Text(".env.\(agent.agentId)")
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(viewModel.showingEnv ? Color.accentColor.opacity(0.15) : Color.clear)
                }
                .buttonStyle(.plain)

                Spacer()

                Button {
                    viewModel.save()
                } label: {
                    Label("Save", systemImage: "square.and.arrow.down")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .keyboardShortcut("s")
            }
            .padding(.vertical, 2)
            .background(.quaternary.opacity(0.3))

            Divider()

            HighlightedCodeEditor(
                text: $viewModel.editorContent,
                language: viewModel.showingEnv ? "env" : "javascript"
            )
        }
        .onAppear {
            intervalInput = agent.interval
        }
        .onChange(of: agent.id) { _, _ in
            intervalInput = agent.interval
        }
    }
}

// MARK: - Syntax Highlighting Editor

struct HighlightedCodeEditor: NSViewRepresentable {
    @Binding var text: String
    var language: String

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        let textView = scrollView.documentView as! NSTextView

        textView.isEditable = true
        textView.isSelectable = true
        textView.allowsUndo = true
        textView.isRichText = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.backgroundColor = .textBackgroundColor
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.delegate = context.coordinator
        textView.textContainerInset = NSSize(width: 8, height: 8)

        return scrollView
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {
        let textView = nsView.documentView as! NSTextView
        if textView.string != text {
            let selectedRanges = textView.selectedRanges
            textView.string = text
            SyntaxHighlighter.highlight(textView: textView, language: language)
            textView.selectedRanges = selectedRanges
        }
    }

    class Coordinator: NSObject, NSTextViewDelegate {
        var parent: HighlightedCodeEditor
        init(_ parent: HighlightedCodeEditor) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
            SyntaxHighlighter.highlight(textView: textView, language: parent.language)
        }
    }
}

enum SyntaxHighlighter {
    static func highlight(textView: NSTextView, language: String) {
        let storage = textView.textStorage!
        let source = storage.string
        let fullRange = NSRange(location: 0, length: (source as NSString).length)
        let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)

        storage.beginEditing()
        storage.addAttribute(.font, value: font, range: fullRange)
        storage.addAttribute(.foregroundColor, value: NSColor.labelColor, range: fullRange)

        if language == "env" {
            highlightEnv(storage: storage, source: source)
        } else {
            highlightJS(storage: storage, source: source)
        }

        storage.endEditing()
    }

    private static func apply(_ storage: NSTextStorage, pattern: String, color: NSColor, source: String, options: NSRegularExpression.Options = []) {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
        let fullRange = NSRange(location: 0, length: (source as NSString).length)
        for match in regex.matches(in: source, range: fullRange) {
            storage.addAttribute(.foregroundColor, value: color, range: match.range)
        }
    }

    private static func highlightJS(storage: NSTextStorage, source: String) {
        let keyword = NSColor.systemPink
        let string = NSColor.systemGreen
        let comment = NSColor.systemGray
        let number = NSColor.systemOrange
        let tag = NSColor.systemCyan
        let builtIn = NSColor.systemPurple

        // Comments (block and line)
        apply(storage, pattern: #"/\*[\s\S]*?\*/"#, color: comment, source: source, options: .dotMatchesLineSeparators)
        apply(storage, pattern: #"//.*$"#, color: comment, source: source, options: .anchorsMatchLines)

        // Strings
        apply(storage, pattern: #"\"(?:[^\"\\]|\\.)*\""#, color: string, source: source)
        apply(storage, pattern: #"'(?:[^'\\]|\\.)*'"#, color: string, source: source)
        apply(storage, pattern: #"`(?:[^`\\]|\\.)*`"#, color: string, source: source)

        // Numbers
        apply(storage, pattern: #"\b\d+\.?\d*\b"#, color: number, source: source)

        // Keywords
        apply(storage, pattern: #"\b(import|export|from|const|let|var|function|async|await|return|if|else|for|while|do|switch|case|break|continue|new|class|try|catch|throw|finally|default|typeof|instanceof|in|of|void|null|undefined|true|false|this|super)\b"#, color: keyword, source: source)

        // Built-ins
        apply(storage, pattern: #"\b(console|process|require|module|exports|Promise|Array|Object|String|Number|JSON|Math|Date|Error|Map|Set|Buffer|URL|fetch|setTimeout|setInterval)\b"#, color: builtIn, source: source)

        // JSDoc tags
        apply(storage, pattern: #"@\w+"#, color: tag, source: source)
    }

    private static func highlightEnv(storage: NSTextStorage, source: String) {
        // Comments
        apply(storage, pattern: #"^\s*#.*$"#, color: .systemGray, source: source, options: .anchorsMatchLines)

        // Keys
        apply(storage, pattern: #"^[A-Z_][A-Z0-9_]*(?==)"#, color: .systemCyan, source: source, options: .anchorsMatchLines)

        // Values (after =)
        apply(storage, pattern: #"(?<==).+$"#, color: .systemGreen, source: source, options: .anchorsMatchLines)
    }
}

