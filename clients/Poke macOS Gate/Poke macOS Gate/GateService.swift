import Foundation
import Combine
import ScreenCaptureKit
import AppKit
import CoreGraphics
import ApplicationServices

@MainActor
class GateService: ObservableObject {
    enum Status: String {
        case stopped = "Stopped"
        case starting = "Starting…"
        case connected = "Connected"
        case disconnected = "Disconnected"
        case error = "Error"
    }

    enum PermissionMode: String, CaseIterable, Identifiable {
        case full
        case limited
        case sandbox

        var id: String { rawValue }

        var title: String {
            switch self {
            case .full: return "Full System Access"
            case .limited: return "Limited Permissions"
            case .sandbox: return "Run in Sandbox"
            }
        }

        var subtitle: String {
            switch self {
            case .full: return "All tools enabled. Risky actions require chat approval."
            case .limited: return "Read-only tools and safe commands (ls, cat, grep, curl…). File writes and screenshots disabled."
            case .sandbox: return "Commands like brew, node, python, ffmpeg allowed. Writes restricted to ~/Downloads and /tmp."
            }
        }
    }

    enum SystemPermission: String, CaseIterable, Identifiable {
        case accessibility

        var id: String { rawValue }

        var title: String {
            switch self {
            case .accessibility: return "Accessibility"
            }
        }

        var subtitle: String {
            switch self {
            case .accessibility: return "Needed for keyboard, mouse, and automation-style control."
            }
        }

        var settingsURL: String {
            switch self {
            case .accessibility: return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
        }

        var systemImageName: String {
            switch self {
            case .accessibility: return "figure.wave"
            }
        }
    }

    struct SystemPermissionStatus: Identifiable, Equatable {
        let permission: SystemPermission
        let isGranted: Bool

        var id: SystemPermission { permission }
    }

    struct TerminalPreview: Identifiable, Equatable {
        let id: UUID
        let timestamp: Date
        var command: String
        var cwd: String?
        var exitCode: Int?
        var durationMs: Int?
        var timedOut: Bool
        var sandboxMode: String?
        var stdoutPreview: String?
        var stderrPreview: String?
    }

    @Published var status: Status = .stopped
    @Published var logs: [String] = []
    @Published var processLogs: [String] = []
    @Published var terminalPreviews: [TerminalPreview] = []
    @Published var userName: String? = nil
    @Published var permissionMode: PermissionMode
    @Published var hasCompletedSetup: Bool
    @Published var systemPermissionStatuses: [SystemPermissionStatus] = []
    @Published var availableUpdate: String? = nil
    @Published var isUpdating = false
    @Published var isCheckingForUpdate = false
    @Published var updateCheckResult: String? = nil

    private var hasAutoStarted = false
    private var process: Process?
    private var outputPipe: Pipe?
    private var shouldRestart = true
    private let maxLogs = 200
    private let maxTerminalPreviews = 100
    private var restartAttempts = 0
    private var healthCheckTimer: Timer?
    private var activeTerminalPreviewId: UUID?
    private var permissionPollingTimer: Timer?

    private var appActiveObserver: NSObjectProtocol?

    init() {
        self.permissionMode = Self.loadPermissionModeStatic()
        self.hasCompletedSetup = Self.loadHasCompletedSetupStatic()
        refreshSystemPermissions()

        appActiveObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshSystemPermissions()
            }
        }
    }

    deinit {
        if let observer = appActiveObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    var hasSystemPermissionsGranted: Bool {
        !systemPermissionStatuses.isEmpty && systemPermissionStatuses.allSatisfy { $0.isGranted }
    }

    var missingSystemPermissions: [SystemPermission] {
        systemPermissionStatuses.filter { !$0.isGranted }.map { $0.permission }
    }

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

    func setPermissionMode(_ mode: PermissionMode) {
        guard permissionMode != mode else { return }
        permissionMode = mode
        savePermissionMode(mode)
        appendLog("Access mode changed to: \(mode.title)")

        if process?.isRunning == true {
            appendLog("Restarting gate to apply access mode.")
            restart()
        }
    }

    func completeFirstRunSetup(selectedMode: PermissionMode, requestPermissions: Bool) {
        setPermissionMode(selectedMode)
        if requestPermissions {
            requestSystemPermissions()
        }
        hasCompletedSetup = true
        saveHasCompletedSetup(true)
        appendLog("Initial setup complete.")
    }

    func requestSystemPermissions() {
        openMissingSystemPermissions()
    }

    func openMissingSystemPermissions() {
        refreshSystemPermissions()

        guard !missingSystemPermissions.isEmpty else {
            appendLog("All required macOS permissions are already granted.")
            return
        }

        let requested = missingSystemPermissions.map { $0.title }.joined(separator: ", ")
        appendLog("Requesting macOS permissions: \(requested).")

        for permission in missingSystemPermissions {
            openSystemPermission(permission)
        }
    }

    func refreshSystemPermissions() {
        let previous = systemPermissionStatuses
        systemPermissionStatuses = SystemPermission.allCases.map { permission in
            SystemPermissionStatus(permission: permission, isGranted: isPermissionGranted(permission))
        }
        for status in systemPermissionStatuses {
            let was = previous.first(where: { $0.permission == status.permission })
            if was == nil || was?.isGranted != status.isGranted {
                appendLog("\(status.permission.title): \(status.isGranted ? "granted" : "not granted")")
            }
        }
    }

    func startPermissionPolling() {
        stopPermissionPolling()
        permissionPollingTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.refreshSystemPermissions()
            }
        }
    }

    func stopPermissionPolling() {
        permissionPollingTimer?.invalidate()
        permissionPollingTimer = nil
    }

    func openSystemPermission(_ permission: SystemPermission) {
        switch permission {
        case .accessibility:
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
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
        checkForUpdate(silent: true)
    }

    func checkForUpdate(silent: Bool = false) {
        let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        isCheckingForUpdate = true
        updateCheckResult = nil

        Task.detached {
            let start = ContinuousClock.now
            var found = false

            defer {
                Task { @MainActor in
                    self.isCheckingForUpdate = false
                    if !found && !silent {
                        self.updateCheckResult = "You're on the latest version."
                    }
                }
            }

            guard let url = URL(string: "https://registry.npmjs.org/poke-gate/latest") else { return }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let latestVersion = json["version"] as? String else { return }

                let elapsed = ContinuousClock.now - start
                if elapsed < .seconds(1) {
                    try await Task.sleep(for: .seconds(1) - elapsed)
                }

                if Self.isNewer(latestVersion, than: currentVersion) {
                    found = true
                    await MainActor.run {
                        self.availableUpdate = latestVersion
                        self.appendLog("Update available: v\(latestVersion) (current: v\(currentVersion))")
                    }
                }
            } catch {}
        }
    }

    private nonisolated static func isNewer(_ remote: String, than local: String) -> Bool {
        let r = remote.split(separator: ".").compactMap { Int($0) }
        let l = local.split(separator: ".").compactMap { Int($0) }
        for i in 0..<max(r.count, l.count) {
            let rv = i < r.count ? r[i] : 0
            let lv = i < l.count ? l[i] : 0
            if rv > lv { return true }
            if rv < lv { return false }
        }
        return false
    }

    func performUpdate() {
        guard let version = availableUpdate else { return }
        isUpdating = true
        appendLog("Updating to v\(version)...")

        stop()

        let fullPath = shellPath()
        let npxBin = findNpx()

        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "\(npxBin) -y poke-gate@\(version) download-macos"]
        proc.environment = ProcessInfo.processInfo.environment.merging(
            ["PATH": fullPath],
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
                for l in line.components(separatedBy: .newlines) where !l.isEmpty {
                    self?.appendLog(l)
                }
            }
        }

        proc.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                self?.isUpdating = false
                if proc.terminationStatus == 0 {
                    self?.appendLog("Update complete. The app will relaunch.")
                    self?.availableUpdate = nil
                } else {
                    self?.appendLog("Update failed (exit \(proc.terminationStatus)).")
                }
            }
        }

        do {
            try proc.run()
        } catch {
            isUpdating = false
            appendLog("Failed to start update: \(error.localizedDescription)")
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

    func clearLogs() {
        logs = []
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

    func findNpx() -> String {
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
        appendLog("Access mode: \(permissionMode.title)")

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
                "POKE_GATE_PERMISSION_MODE": permissionMode.rawValue,
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
        killOrphanedProcesses()
    }

    private func killOrphanedProcesses() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-f", "poke-gate"]
        try? task.run()
        task.waitUntilExit()
    }

    private func handleOutput(_ raw: String) {
        for line in raw.components(separatedBy: .newlines) where !line.isEmpty {
            appendLog(line)
            appendProcessLog(line)
            parseTerminalPreviewLine(line)

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

    private func appendProcessLog(_ line: String) {
        let stripped = stripToolTimestamp(from: line)
        guard !stripped.isEmpty else { return }
        processLogs.append(stripped)
        if processLogs.count > maxLogs {
            processLogs.removeFirst(processLogs.count - maxLogs)
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

    private static func loadPermissionModeStatic() -> PermissionMode {
        let configDir: URL
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] {
            configDir = URL(fileURLWithPath: xdg)
        } else {
            configDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config")
        }

        let configURL = configDir
            .appendingPathComponent("poke-gate")
            .appendingPathComponent("config.json")

        guard let data = try? Data(contentsOf: configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = json["permissionMode"] as? String,
              let mode = PermissionMode(rawValue: value) else {
            return .full
        }

        return mode
    }

    private static func loadHasCompletedSetupStatic() -> Bool {
        let configDir: URL
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] {
            configDir = URL(fileURLWithPath: xdg)
        } else {
            configDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config")
        }

        let configURL = configDir
            .appendingPathComponent("poke-gate")
            .appendingPathComponent("config.json")

        guard let data = try? Data(contentsOf: configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }

        if let value = json["setupCompleted"] as? Bool {
            return value
        }

        return false
    }

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

    private func readConfig() -> [String: Any] {
        guard let data = try? Data(contentsOf: configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return json
    }

    private func writeConfig(_ json: [String: Any]) {
        let dir = configURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted]) {
            try? data.write(to: configURL)
        }
        objectWillChange.send()
    }

    private func loadAPIKey() -> String? {
        readConfig()["apiKey"] as? String
    }

    private func saveAPIKey(_ key: String) {
        var json = readConfig()
        json["apiKey"] = key
        writeConfig(json)
    }

    private func savePermissionMode(_ mode: PermissionMode) {
        var json = readConfig()
        json["permissionMode"] = mode.rawValue
        writeConfig(json)
    }

    private func saveHasCompletedSetup(_ value: Bool) {
        var json = readConfig()
        json["setupCompleted"] = value
        writeConfig(json)
    }

    private func isPermissionGranted(_ permission: SystemPermission) -> Bool {
        switch permission {
        case .accessibility:
            if AXIsProcessTrusted() { return true }
            // AXIsProcessTrusted() can return false despite the toggle being ON
            // in System Settings when the TCC entry's code signature doesn't match
            // the running binary (ad-hoc signing, rebuild from Xcode, etc.).
            // Probe the API directly as a fallback.
            let systemWide = AXUIElementCreateSystemWide()
            var value: AnyObject?
            let result = AXUIElementCopyAttributeValue(
                systemWide,
                kAXFocusedApplicationAttribute as CFString,
                &value
            )
            return result == .success || result == .noValue || result == .attributeUnsupported
        }
    }

    private func parseTerminalPreviewLine(_ line: String) {
        let body = stripToolTimestamp(from: line)

        if body == "terminal preview:" {
            activeTerminalPreviewId = nil
            return
        }

        if body.hasPrefix("$ ") {
            let (command, cwd) = parseCommandAndCwd(body)
            let preview = TerminalPreview(
                id: UUID(),
                timestamp: Date(),
                command: command,
                cwd: cwd,
                exitCode: nil,
                durationMs: nil,
                timedOut: false,
                sandboxMode: nil,
                stdoutPreview: nil,
                stderrPreview: nil
            )
            terminalPreviews.append(preview)
            if terminalPreviews.count > maxTerminalPreviews {
                terminalPreviews.removeFirst(terminalPreviews.count - maxTerminalPreviews)
            }
            activeTerminalPreviewId = preview.id
            return
        }

        guard let id = activeTerminalPreviewId,
              let index = terminalPreviews.firstIndex(where: { $0.id == id }) else {
            return
        }

        if body.hasPrefix("process: ") {
            var updated = terminalPreviews[index]
            updated.exitCode = parseInt(body, key: "exit=")
            updated.durationMs = parseInt(body, key: "duration=")
            updated.timedOut = body.contains(" timeout")
            if body.contains("sandbox=os") {
                updated.sandboxMode = "os"
            } else if body.contains("sandbox=none") {
                updated.sandboxMode = "none"
            }
            terminalPreviews[index] = updated
            return
        }

        if body.hasPrefix("stdout: ") {
            var updated = terminalPreviews[index]
            updated.stdoutPreview = String(body.dropFirst("stdout: ".count))
            terminalPreviews[index] = updated
            return
        }

        if body.hasPrefix("stderr: ") {
            var updated = terminalPreviews[index]
            updated.stderrPreview = String(body.dropFirst("stderr: ".count))
            terminalPreviews[index] = updated
        }
    }

    private func stripToolTimestamp(from line: String) -> String {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("["), let end = trimmed.firstIndex(of: "]") else {
            return trimmed
        }
        let after = trimmed.index(after: end)
        return String(trimmed[after...]).trimmingCharacters(in: .whitespaces)
    }

    private func parseCommandAndCwd(_ body: String) -> (String, String?) {
        let text = String(body.dropFirst(2))
        let marker = " (in "
        guard let range = text.range(of: marker), text.hasSuffix(")") else {
            return (text, nil)
        }

        let command = String(text[..<range.lowerBound])
        let cwdStart = range.upperBound
        let cwdEnd = text.index(before: text.endIndex)
        let cwd = String(text[cwdStart..<cwdEnd])
        return (command, cwd)
    }

    private func parseInt(_ text: String, key: String) -> Int? {
        guard let range = text.range(of: key) else { return nil }
        let suffix = text[range.upperBound...]
        let digits = suffix.prefix { $0.isNumber }
        return Int(digits)
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
            let config = readConfig()
            if let source = config["authSource"] as? String, source == "pokeLogin" {
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
            var json = readConfig()
            json["authSource"] = newValue == .pokeLogin ? "pokeLogin" : "apiKey"
            writeConfig(json)
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
