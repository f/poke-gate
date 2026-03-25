import Foundation
import Combine
import ScreenCaptureKit

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
    private var restartAttempts = 0
    private var healthCheckTimer: Timer?

    var apiKey: String {
        get { loadAPIKey() ?? "" }
        set { saveAPIKey(newValue) }
    }

    var hasAPIKey: Bool {
        resolveToken() != nil
    }

    func runPokeLogin() {
        let fullPath = shellPath()
        let npxBin = findNpx()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "\(npxBin) -y poke@latest login"]
        proc.environment = ["HOME": NSHomeDirectory(), "PATH": fullPath]
        try? proc.run()
        appendLog("Launched poke login (npx: \(npxBin)) — check your browser.")
    }

    func captureAndSend() {
        appendLog("Screenshot requested via deeplink.")

        Task {
            do {
                let content = try await SCShareableContent.current
                guard let display = content.displays.first else {
                    appendLog("No display found for screenshot.")
                    return
                }

                let filter = SCContentFilter(display: display, excludingWindows: [])
                let config = SCStreamConfiguration()
                config.width = display.width * 2
                config.height = display.height * 2
                config.capturesAudio = false

                let image = try await SCScreenshotManager.captureImage(
                    contentFilter: filter,
                    configuration: config
                )

                let rep = NSBitmapImageRep(cgImage: image)
                guard let pngData = rep.representation(using: .png, properties: [:]) else {
                    appendLog("Failed to encode screenshot as PNG.")
                    return
                }

                let tempPath = NSTemporaryDirectory() + "poke-gate-screenshot.png"
                let tempURL = URL(fileURLWithPath: tempPath)
                try pngData.write(to: tempURL)
                appendLog("Screenshot saved to \(tempPath) (\(pngData.count) bytes)")

                let base64 = pngData.base64EncodedString()

                guard let token = loadPokeLoginToken() else {
                    appendLog("Cannot send screenshot: not signed in to Poke.")
                    return
                }

                let url = URL(string: "https://poke.com/api/v1/inbound/api-message")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")

                let message = "Here's a screenshot of my screen right now. [Image attached as base64 PNG, \(pngData.count) bytes, \(display.width)x\(display.height)]"
                let body: [String: Any] = ["message": message]
                request.httpBody = try JSONSerialization.data(withJSONObject: body)

                let (_, response) = try await URLSession.shared.data(for: request)
                if let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 {
                    appendLog("Screenshot sent to Poke.")
                } else {
                    appendLog("Failed to send screenshot to Poke.")
                }
            } catch {
                appendLog("Screenshot error: \(error.localizedDescription)")
            }
        }
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
        stopHealthCheck()
        killProcess()
        restartAttempts = 0
        status = .stopped
    }

    func restart() {
        stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.start()
        }
    }

    func shellPath() -> String {
        let home = NSHomeDirectory()
        let fallback = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"

        // Try multiple shells/strategies to get PATH
        let strategies: [(String, [String])] = [
            ("/bin/zsh", ["-ilc", "echo $PATH"]),
            ("/bin/zsh", ["-lc", "echo $PATH"]),
            ("/bin/bash", ["-lc", "echo $PATH"]),
        ]

        for (shell, args) in strategies {
            let proc = Process()
            let pipe = Pipe()
            proc.executableURL = URL(fileURLWithPath: shell)
            proc.arguments = args
            proc.standardOutput = pipe
            proc.standardError = FileHandle.nullDevice
            proc.environment = ["HOME": home]
            do {
                try proc.run()
                proc.waitUntilExit()
                if proc.terminationStatus == 0 {
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    if let path = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines),
                       !path.isEmpty {
                        return path
                    }
                }
            } catch {
                continue
            }
        }

        // Fallback: build PATH from common locations
        var paths = fallback.split(separator: ":").map(String.init)

        let commonDirs = [
            "\(home)/.nvm/versions/node",
            "\(home)/.volta/bin",
            "\(home)/.fnm/aliases/default/bin",
            "\(home)/.local/bin",
            "\(home)/.cargo/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ]

        for dir in commonDirs {
            if FileManager.default.fileExists(atPath: dir) {
                if dir.contains(".nvm") {
                    // Find the latest node version in nvm
                    if let versions = try? FileManager.default.contentsOfDirectory(atPath: dir) {
                        if let latest = versions.sorted().last {
                            let binPath = "\(dir)/\(latest)/bin"
                            if !paths.contains(binPath) { paths.insert(binPath, at: 0) }
                        }
                    }
                } else if !paths.contains(dir) {
                    paths.insert(dir, at: 0)
                }
            }
        }

        return paths.joined(separator: ":")
    }

    private func findNpx() -> String {
        let path = shellPath()
        for dir in path.split(separator: ":") {
            let npxPath = "\(dir)/npx"
            if FileManager.default.isExecutableFile(atPath: npxPath) {
                return npxPath
            }
        }
        return "npx"
    }

    private func launchProcess() {
        killProcess()

        status = .starting
        appendLog("Starting poke-gate…")

        let fullPath = shellPath()
        let npxBin = findNpx()

        appendLog("Using npx at: \(npxBin)")

        let proc = Process()
        let pipe = Pipe()

        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "\(npxBin) -y poke-gate@latest --verbose"]
        proc.environment = ProcessInfo.processInfo.environment.merging(
            [
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
                restartAttempts = 0
                startHealthCheck()
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
        stopHealthCheck()

        if shouldRestart {
            restartAttempts += 1
            let delay = min(Double(2 * (1 << min(restartAttempts - 1, 5))), 60.0)
            status = .disconnected
            appendLog("Restarting in \(Int(delay))s (attempt \(restartAttempts))…")
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if self.shouldRestart {
                    self.launchProcess()
                }
            }
        } else {
            status = .stopped
        }
    }

    private func startHealthCheck() {
        stopHealthCheck()
        healthCheckTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                if let proc = self.process, !proc.isRunning {
                    self.appendLog("Health check: process died, restarting.")
                    self.handleTermination(exitCode: -1)
                }
            }
        }
    }

    private func stopHealthCheck() {
        healthCheckTimer?.invalidate()
        healthCheckTimer = nil
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
