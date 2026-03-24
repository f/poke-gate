import Foundation
import Combine

@MainActor
class GateService: ObservableObject {
    enum Status: String {
        case stopped = "Stopped"
        case starting = "Starting…"
        case connected = "Connected"
        case disconnected = "Disconnected"
        case error = "Error"
    }

    @Published var status: Status = .stopped
    @Published var logs: [String] = []
    @Published var userName: String? = nil

    private var hasAutoStarted = false
    private var process: Process?
    private var outputPipe: Pipe?
    private var shouldRestart = true
    private let maxLogs = 200

    var apiKey: String {
        get { loadAPIKey() ?? "" }
        set { saveAPIKey(newValue) }
    }

    var hasAPIKey: Bool {
        resolveToken() != nil
    }

    func runPokeLogin() {
        let fullPath = shellPath()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "npx -y poke@latest login"]
        proc.environment = ["HOME": NSHomeDirectory(), "PATH": fullPath]
        try? proc.run()
        appendLog("Launched poke login — check your browser.")
    }

    func autoStartIfNeeded() {
        guard !hasAutoStarted else { return }
        hasAutoStarted = true
        if hasAPIKey {
            start()
        }
    }

    func start() {
        guard hasAPIKey else {
            status = .error
            appendLog("No API key configured.")
            return
        }
        shouldRestart = true
        fetchUserName()
        launchProcess()
    }

    private func fetchUserName() {
        guard let key = loadAPIKey() else { return }
        Task {
            let url = URL(string: "https://poke.com/api/v1/user/profile")!
            var request = URLRequest(url: url)
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 else { return }
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let fullName = json["name"] as? String ?? json["email"] as? String {
                    let firstName = fullName.components(separatedBy: CharacterSet.whitespaces.union(CharacterSet(charactersIn: "@"))).first ?? fullName
                    self.userName = firstName
                }
            } catch {}
        }
    }

    func stop() {
        shouldRestart = false
        killProcess()
        status = .stopped
    }

    func restart() {
        stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.start()
        }
    }

    private func shellPath() -> String {
        let loginShell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let pathProc = Process()
        let pathPipe = Pipe()
        pathProc.executableURL = URL(fileURLWithPath: loginShell)
        pathProc.arguments = ["-ilc", "echo $PATH"]
        pathProc.standardOutput = pathPipe
        pathProc.standardError = FileHandle.nullDevice
        pathProc.environment = ["HOME": NSHomeDirectory()]
        try? pathProc.run()
        pathProc.waitUntilExit()
        let data = pathPipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    }

    private func launchProcess() {
        killProcess()

        status = .starting
        appendLog("Starting poke-gate…")

        let fullPath = shellPath()

        let proc = Process()
        let pipe = Pipe()

        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "npx -y poke-gate --verbose"]
        proc.environment = ProcessInfo.processInfo.environment.merging(
            [
                "POKE_API_KEY": resolveToken() ?? "",
                "PATH": fullPath,
            ],
            uniquingKeysWith: { _, new in new }
        )
        proc.standardOutput = pipe
        proc.standardError = pipe
        proc.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        let handle = pipe.fileHandleForReading
        handle.readabilityHandler = { [weak self] fh in
            let data = fh.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.handleOutput(line)
            }
        }

        proc.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                self?.handleTermination(exitCode: proc.terminationStatus)
            }
        }

        do {
            try proc.run()
            self.process = proc
            self.outputPipe = pipe
        } catch {
            status = .error
            appendLog("Failed to start: \(error.localizedDescription)")
        }
    }

    private func killProcess() {
        if let proc = process, proc.isRunning {
            proc.terminate()
        }
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        process = nil
        outputPipe = nil
    }

    private func handleOutput(_ raw: String) {
        for line in raw.components(separatedBy: .newlines) where !line.isEmpty {
            appendLog(line)

            if line.contains("Tunnel connected") || line.contains("Ready") {
                status = .connected
            } else if line.contains("Tunnel disconnected") || line.contains("Reconnecting") {
                status = .disconnected
            } else if line.contains("Failed to connect") || line.contains("error") {
                if status != .connected {
                    status = .error
                }
            }
        }
    }

    private func handleTermination(exitCode: Int32) {
        appendLog("Process exited with code \(exitCode)")
        if shouldRestart {
            status = .disconnected
            appendLog("Restarting in 2 seconds…")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                if self.shouldRestart {
                    self.launchProcess()
                }
            }
        } else {
            status = .stopped
        }
    }

    private func appendLog(_ line: String) {
        let ts = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logs.append("[\(ts)] \(line)")
        if logs.count > maxLogs {
            logs.removeFirst(logs.count - maxLogs)
        }
    }

    // MARK: - Config

    private var configURL: URL {
        let configDir: URL
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] {
            configDir = URL(fileURLWithPath: xdg)
        } else {
            configDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config")
        }
        return configDir
            .appendingPathComponent("poke-gate")
            .appendingPathComponent("config.json")
    }

    private func loadAPIKey() -> String? {
        guard let data = try? Data(contentsOf: configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = json["apiKey"] as? String else {
            return nil
        }
        return key
    }

    private func saveAPIKey(_ key: String) {
        let dir = configURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let json: [String: Any] = ["apiKey": key]
        if let data = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted]) {
            try? data.write(to: configURL)
        }
        objectWillChange.send()
    }

    // MARK: - Poke Login Credentials

    private var pokeCredentialsURL: URL {
        let configDir: URL
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] {
            configDir = URL(fileURLWithPath: xdg)
        } else {
            configDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config")
        }
        return configDir
            .appendingPathComponent("poke")
            .appendingPathComponent("credentials.json")
    }

    var hasPokeLoginCredentials: Bool {
        loadPokeLoginToken() != nil
    }

    func loadPokeLoginToken() -> String? {
        guard let data = try? Data(contentsOf: pokeCredentialsURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["token"] as? String else {
            return nil
        }
        return token
    }

    var authSource: AuthSource {
        get {
            let config = (try? Data(contentsOf: configURL))
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            if let source = config?["authSource"] as? String, source == "pokeLogin" {
                return .pokeLogin
            }
            if loadAPIKey() != nil {
                return .apiKey
            }
            if hasPokeLoginCredentials {
                return .pokeLogin
            }
            return .none
        }
        set {
            let dir = configURL.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var json: [String: Any] = [:]
            if let data = try? Data(contentsOf: configURL),
               let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                json = existing
            }
            json["authSource"] = newValue == .pokeLogin ? "pokeLogin" : "apiKey"
            if let data = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted]) {
                try? data.write(to: configURL)
            }
            objectWillChange.send()
        }
    }

    func resolveToken() -> String? {
        switch authSource {
        case .pokeLogin:
            return loadPokeLoginToken()
        case .apiKey:
            return loadAPIKey()
        case .none:
            return loadAPIKey() ?? loadPokeLoginToken()
        }
    }

    enum AuthSource {
        case pokeLogin
        case apiKey
        case none
    }
}
