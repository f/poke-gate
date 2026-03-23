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
        let key = loadAPIKey()
        return key != nil && !key!.isEmpty
    }

    func autoStartIfNeeded() {
        guard !hasAutoStarted else { return }
        hasAutoStarted = true
        requestScreenCapturePermission()
        if hasAPIKey {
            start()
        }
    }

    private func requestScreenCapturePermission() {
        Task {
            do {
                _ = try await SCShareableContent.current
            } catch {
                appendLog("Screen capture permission not granted yet.")
            }
        }
    }

    func start() {
        guard hasAPIKey else {
            status = .error
            appendLog("No API key configured.")
            return
        }
        shouldRestart = true
        launchProcess()
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
                "POKE_API_KEY": loadAPIKey() ?? "",
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
}
