import http from "node:http";
import { randomBytes } from "node:crypto";
import { exec } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, symlinkSync, lstatSync } from "node:fs";
import { hostname, platform, arch, uptime, totalmem, freemem, homedir } from "node:os";
import { join, resolve, extname } from "node:path";
import { PermissionService } from "./permission-service.js";

const SERVER_INFO = { name: "poke-gate", version: "0.0.1" };

const COMMAND_TIMEOUT = 30_000;
const RUN_COMMAND_LOOP_SUPPRESSION_MS = 60_000;
const PERMISSION_MODE = normalizePermissionMode(process.env.POKE_GATE_PERMISSION_MODE);
const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

let logEnabled = false;

const permissionSecret = process.env.POKE_GATE_HMAC_SECRET || randomBytes(32).toString("hex");
const permissionService = new PermissionService({ secret: permissionSecret });
const sessionAutoApproveAllRisky = new Set();
const runCommandLoopState = new Map();

const SAFE_TOOL_NAMES = new Set(["read_file", "read_image", "list_directory", "system_info", "network_speed"]);

const LIMITED_RUN_COMMANDS = new Set([
  "curl", "yt-dlp", "youtube-dl",
  "ls", "pwd", "cat", "grep", "find", "head", "tail", "wc", "sed", "awk",
  "which", "command", "echo", "stat", "du", "df", "ps", "uname", "sw_vers", "whoami",
  "jq", "diff",
]);

const SANDBOX_RUN_COMMANDS = new Set([
  "yt-dlp", "youtube-dl",
  "ffmpeg", "ffprobe",
  "brew", "node", "python", "python3",
  "curl", "dd", "rm", "mktemp", "mkdir", "cp", "mv", "touch", "jq", "diff",
  "ls", "pwd", "cat", "grep", "find", "head", "tail", "wc", "sed", "awk",
  "which", "command", "echo", "stat", "du", "df", "ps", "uname", "sw_vers", "whoami",
]);

const DANGEROUS_COMMAND_PATTERNS = [
  /(^|\s)sudo(\s|$)/i,
  /rm\s+-rf\b/i,
  /rm\s+-fr\b/i,
  /rm\s+-r\s+-f\b/i,
  /diskutil\s+erase/i,
  /mkfs(\.|\s|$)/i,
  /shutdown(\s|$)/i,
  /reboot(\s|$)/i,
  /launchctl\s+bootout/i,
  /chmod\s+777/i,
  /curl\s+[^\n]*\|\s*(sh|bash|zsh)/i,
];

function normalizePermissionMode(value) {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (mode === "limited" || mode === "sandbox") return mode;
  return "full";
}

export function getPermissionMode() {
  return PERMISSION_MODE;
}

export function enableLogging(enabled) {
  logEnabled = enabled;
}

function logTool(name, args, result) {
  if (!logEnabled) return;
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] tool: ${name}`);
  if (name === "run_command") console.log(`[${ts}]   $ ${args.command}${args.cwd ? ` (in ${args.cwd})` : ""}`);
  else if (name === "read_file") console.log(`[${ts}]   read: ${args.path}`);
  else if (name === "write_file") console.log(`[${ts}]   write: ${args.path}`);
  else if (name === "list_directory") console.log(`[${ts}]   ls: ${args.path || "~"}`);
  if (result?.isError) console.log(`[${ts}]   error`);
}

const TOOLS = [
  {
    name: "run_command",
    description:
      "Execute a shell command on the user's machine and return stdout, stderr, and exit code. " +
      "Use this to run any CLI command (ls, cat, git, brew, python, curl, etc.). " +
      "Commands run in a shell with a 30-second timeout.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory (optional, defaults to home)" },
        approval_token: { type: "string", description: "Approval token returned by a previous AWAITING_APPROVAL response" },
        approve: { type: "boolean", description: "Set true after user approves in chat" },
        remember_in_session: { type: "boolean", description: "If true, remember this command for this session" },
        remember_all_risky: { type: "boolean", description: "If true, auto-approve all risky tools for this session" },
      },
      required: ["command"],
    },
  },
  {
    name: "network_speed",
    description:
      "Run a built-in internet speed test and return download/upload Mbps. " +
      "Uses Cloudflare speed endpoints internally without requiring shell pipelines.",
    inputSchema: {
      type: "object",
      properties: {
        tests: {
          type: "string",
          description: "Which direction to test",
          enum: ["download", "upload", "both"],
        },
      },
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file on the user's machine.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file on the user's machine. Creates the file if it doesn't exist, overwrites if it does.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        content: { type: "string", description: "Content to write" },
        approval_token: { type: "string", description: "Approval token returned by a previous AWAITING_APPROVAL response" },
        approve: { type: "boolean", description: "Set true after user approves in chat" },
        remember_all_risky: { type: "boolean", description: "If true, auto-approve all risky tools for this session" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories at a given path on the user's machine.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (defaults to home)" },
      },
    },
  },
  {
    name: "system_info",
    description: "Get system information: OS, hostname, architecture, uptime, memory, and home directory.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_image",
    description:
      "Read an image or binary file and return it as base64-encoded data. " +
      "Supports png, jpg, jpeg, gif, webp, pdf, and any other binary file. " +
      "Returns the base64 string and MIME type.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the image/binary file" },
      },
      required: ["path"],
    },
  },
  {
    name: "run_agent",
    description:
      "Run a Poke Gate agent by name. Agents are scheduled scripts in ~/.config/poke-gate/agents/. " +
      "Use this to manually trigger an agent — it will execute and send its results to you.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name (e.g. 'beeper', 'battery', 'context')" },
      },
      required: ["name"],
    },
  },
  {
    name: "take_screenshot",
    description: "Take a screenshot of the user's screen and save it to a file. Returns the file path. Requires screen recording permission on macOS.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to save the screenshot (optional, defaults to ~/Desktop/screenshot-<timestamp>.png)" },
        approval_token: { type: "string", description: "Approval token returned by a previous AWAITING_APPROVAL response" },
        approve: { type: "boolean", description: "Set true after user approves in chat" },
        remember_all_risky: { type: "boolean", description: "If true, auto-approve all risky tools for this session" },
      },
    },
  },
];

function sanitizeToolArgs(args = {}) {
  const {
    approval_token: _approvalToken,
    approve: _approve,
    remember_in_session: _rememberInSession,
    remember_all_risky: _rememberAllRisky,
    ...cleanArgs
  } = args;
  return cleanArgs;
}

function extractSessionId(req) {
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    return sessionId.trim();
  }
  return "default";
}

function buildApprovalResponse(name, cleanArgs, approval) {
  const summary = name === "run_command"
    ? `Run command: ${cleanArgs.command}`
    : name === "write_file"
      ? `Write file: ${cleanArgs.path}`
      : "Take screenshot";

  return {
    content: [{
      type: "text",
      text:
        "AWAITING_APPROVAL: Ask the user in chat to approve this action. " +
        "Re-call the same tool with approve=true and approval_token from structuredContent. " +
        "Optional: remember_in_session=true (same command) or remember_all_risky=true (all risky tools for this session).",
    }],
    structuredContent: {
      status: "AWAITING_APPROVAL",
      approvalRequestId: approval.approvalRequestId,
      approvalToken: approval.token,
      expiresAt: new Date(approval.expiresAt).toISOString(),
      toolName: name,
      summary,
    },
    isError: true,
  };
}

function buildPolicyDeniedResponse(message) {
  return {
    content: [{ type: "text", text: `Blocked by access mode policy: ${message}` }],
    isError: true,
  };
}

function splitCommandSegments(commandText) {
  return commandText
    .split(/&&|\|\||;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function extractExecutable(segment) {
  const withoutParens = segment.replace(/^[()\s]+/, "");
  const withoutSudo = withoutParens.replace(/^sudo\s+/, "");
  const match = withoutSudo.match(/^([A-Za-z0-9_./-]+)/);
  if (!match) return "";
  const raw = match[1];
  const parts = raw.split("/");
  return parts[parts.length - 1];
}

function hasDangerousPattern(commandText) {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(commandText));
}

function validateRunCommandAgainstAllowlist(commandText, allowlist) {
  if (typeof commandText !== "string" || commandText.trim().length === 0) {
    return "Command is empty.";
  }

  if (hasDangerousPattern(commandText)) {
    return "Command matches a dangerous pattern.";
  }

  const segments = splitCommandSegments(commandText);
  for (const segment of segments) {
    const executable = extractExecutable(segment);
    if (!executable || !allowlist.has(executable)) {
      return `Command '${executable || "unknown"}' is not permitted in this mode.`;
    }
  }

  return null;
}

export function evaluateAccessPolicy(toolName, cleanArgs, mode = PERMISSION_MODE) {
  if (mode === "full") return null;

  if (mode === "limited") {
    if (SAFE_TOOL_NAMES.has(toolName)) return null;
    if (toolName === "run_command") {
      return validateRunCommandAgainstAllowlist(cleanArgs.command, LIMITED_RUN_COMMANDS);
    }
    if (toolName === "write_file" || toolName === "take_screenshot") {
      return "This tool is disabled in Limited Permissions mode.";
    }
    return "This tool is not permitted in Limited Permissions mode.";
  }

  if (SAFE_TOOL_NAMES.has(toolName)) return null;

  if (toolName === "run_command") {
    return validateRunCommandAgainstAllowlist(cleanArgs.command, SANDBOX_RUN_COMMANDS);
  }

  if (toolName === "write_file" || toolName === "take_screenshot") {
    return "This tool is disabled in Sandbox mode.";
  }

  return "This tool is not permitted in Sandbox mode.";
}

function getRunCommandFingerprint(cleanArgs) {
  return JSON.stringify({
    command: typeof cleanArgs.command === "string" ? cleanArgs.command : "",
    cwd: typeof cleanArgs.cwd === "string" && cleanArgs.cwd.trim().length > 0 ? cleanArgs.cwd.trim() : "__HOME__",
  });
}

function getRunCommandState(sessionId) {
  if (!runCommandLoopState.has(sessionId)) {
    runCommandLoopState.set(sessionId, {
      inFlight: new Set(),
      recentFailures: new Map(),
    });
  }

  return runCommandLoopState.get(sessionId);
}

export function resetRunCommandLoopGuard() {
  runCommandLoopState.clear();
}

export function prepareRunCommandAttempt(sessionId, cleanArgs, now = Date.now()) {
  const state = getRunCommandState(sessionId);
  const fingerprint = getRunCommandFingerprint(cleanArgs);
  const recentFailure = state.recentFailures.get(fingerprint);

  if (state.inFlight.has(fingerprint)) {
    return {
      suppressed: true,
      reason: "already_running",
      fingerprint,
    };
  }

  if (recentFailure && now < recentFailure.suppressedUntil) {
    return {
      suppressed: true,
      reason: "recent_failure",
      fingerprint,
    };
  }

  state.inFlight.add(fingerprint);
  return {
    suppressed: false,
    fingerprint,
  };
}

export function recordRunCommandOutcome(sessionId, cleanArgs, result, now = Date.now()) {
  const state = getRunCommandState(sessionId);
  const fingerprint = getRunCommandFingerprint(cleanArgs);

  state.inFlight.delete(fingerprint);

  if (result.exitCode === 0) {
    state.recentFailures.delete(fingerprint);
    return;
  }

  state.recentFailures.set(fingerprint, {
    exitCode: result.exitCode,
    suppressedUntil: now + RUN_COMMAND_LOOP_SUPPRESSION_MS,
  });
}

function buildRunCommandSuppressionResponse(cleanArgs, reason) {
  const detail = reason === "already_running"
    ? "The same command is already running."
    : "The same command just failed, so repeated retries are being suppressed for a short period.";

  return {
    content: [{
      type: "text",
      text: `${detail} Change the command or wait before retrying: ${cleanArgs.command}`,
    }],
    isError: true,
  };
}

function quoteForSingleShellArg(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function buildSandboxProfile() {
  const userHome = homedir();
  return [
    "(version 1)",
    "(deny default)",
    "(import \"system.sb\")",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow file-read*)",
    "(allow network-outbound)",
    "(allow sysctl-read)",
    "(allow file-write*",
    `  (subpath "${userHome}/Downloads")`,
    "  (subpath \"/private/tmp\")",
    "  (subpath \"/tmp\")",
    ")",
  ].join("\n");
}

export function buildSandboxWrappedCommand(command) {
  const profile = buildSandboxProfile();
  return `${SANDBOX_EXEC_PATH} -p ${quoteForSingleShellArg(profile)} /bin/zsh -lc ${quoteForSingleShellArg(command)}`;
}

function runCommand(command, cwd, options = {}) {
  return new Promise((res) => {
    const dir = cwd || homedir();
    const sandboxRequested = options.permissionMode === "sandbox";
    const sandboxAvailable = existsSync(SANDBOX_EXEC_PATH);
    const sandboxApplied = sandboxRequested && sandboxAvailable;
    const commandToRun = sandboxApplied ? buildSandboxWrappedCommand(command) : command;

    const start = Date.now();
    exec(commandToRun, {
      cwd: dir,
      timeout: COMMAND_TIMEOUT,
      maxBuffer: 1024 * 1024,
      shell: true,
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const note = sandboxRequested && !sandboxAvailable
        ? "sandbox-exec unavailable; ran without OS sandbox"
        : "";

      res({
        stdout: stdout.slice(0, 50_000),
        stderr: `${stderr.slice(0, 10_000)}${note ? `${stderr ? "\n" : ""}${note}` : ""}`,
        exitCode: error ? (error.code ?? 1) : 0,
        durationMs,
        timedOut: Boolean(error?.killed && error?.signal === "SIGTERM"),
        sandboxApplied,
      });
    });
  });
}

function previewText(text, limit = 220) {
  if (typeof text !== "string") return "";
  return text.trim().replace(/\s+/g, " ").slice(0, limit);
}

function logCommandPreview(args, result) {
  if (!logEnabled) return;
  const ts = new Date().toISOString().slice(11, 19);
  const timeoutSuffix = result.timedOut ? " timeout" : "";
  const sandboxSuffix = result.sandboxApplied ? " sandbox=os" : " sandbox=none";
  const cwdText = args.cwd ? ` (in ${args.cwd})` : "";

  console.log(`[${ts}]   terminal preview:`);
  console.log(`[${ts}]     $ ${args.command}${cwdText}`);
  console.log(`[${ts}]     process: exit=${result.exitCode} duration=${result.durationMs}ms${timeoutSuffix}${sandboxSuffix}`);

  const stdoutPreview = previewText(result.stdout);
  const stderrPreview = previewText(result.stderr);
  if (stdoutPreview) console.log(`[${ts}]     stdout: ${stdoutPreview}`);
  if (stderrPreview) console.log(`[${ts}]     stderr: ${stderrPreview}`);
}

function toMbps(bytes, seconds) {
  if (!Number.isFinite(bytes) || !Number.isFinite(seconds) || seconds <= 0) return null;
  return (bytes * 8) / seconds / 1_000_000;
}

function runNetworkSpeedTests(testSelection = "both") {
  const tests = typeof testSelection === "string" ? testSelection : "both";
  const runDownload = tests === "download" || tests === "both";
  const runUpload = tests === "upload" || tests === "both";

  if (!runDownload && !runUpload) {
    return Promise.resolve({
      content: [{ type: "text", text: "Invalid test selection. Use download, upload, or both." }],
      isError: true,
    });
  }

  const downloadBytes = 25 * 1024 * 1024;
  const uploadBytes = 10 * 1024 * 1024;
  const parts = [];

  if (runDownload) {
    parts.push(`DL=$(curl -s -o /dev/null -w '%{time_total}' 'https://speed.cloudflare.com/__down?bytes=${downloadBytes}')`);
  }
  if (runUpload) {
    parts.push("TMP=$(mktemp /tmp/poke-speed.XXXXXX)");
    parts.push(`dd if=/dev/zero of="$TMP" bs=1m count=${Math.floor(uploadBytes / (1024 * 1024))} 2>/dev/null`);
    parts.push("UL=$(curl -s -o /dev/null -w '%{time_total}' -X POST --data-binary @\"$TMP\" 'https://speed.cloudflare.com/__up')");
    parts.push("rm -f \"$TMP\"");
  }
  parts.push("printf 'DL=%s\nUL=%s\n' \"${DL:-}\" \"${UL:-}\"");

  const cmd = parts.join(" && ");

  return runCommand(cmd, homedir(), { permissionMode: "full" }).then((result) => {
    const raw = String(result.stdout || "");
    const dlMatch = raw.match(/DL=([^\n]*)/);
    const ulMatch = raw.match(/UL=([^\n]*)/);
    const dlSeconds = dlMatch && dlMatch[1] ? Number.parseFloat(dlMatch[1]) : NaN;
    const ulSeconds = ulMatch && ulMatch[1] ? Number.parseFloat(ulMatch[1]) : NaN;
    const dlMbps = runDownload ? toMbps(downloadBytes, dlSeconds) : null;
    const ulMbps = runUpload ? toMbps(uploadBytes, ulSeconds) : null;

    const lines = ["Network Speed Test"]; 
    if (runDownload) {
      lines.push(dlMbps === null
        ? "- Download: unavailable"
        : `- Download: ${dlMbps.toFixed(2)} Mbps (${dlSeconds.toFixed(2)}s for 25 MiB)`);
    }
    if (runUpload) {
      lines.push(ulMbps === null
        ? "- Upload: unavailable"
        : `- Upload: ${ulMbps.toFixed(2)} Mbps (${ulSeconds.toFixed(2)}s for 10 MiB)`);
    }

    const response = {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        downloadMbps: dlMbps,
        uploadMbps: ulMbps,
        downloadSeconds: Number.isFinite(dlSeconds) ? dlSeconds : null,
        uploadSeconds: Number.isFinite(ulSeconds) ? ulSeconds : null,
      },
    };

    if (result.exitCode !== 0 || (runDownload && dlMbps === null) || (runUpload && ulMbps === null)) {
      response.isError = true;
      response.content[0].text += `\n\nDetails: ${result.stderr || "speed test command failed"}`;
    }

    return response;
  });
}

function handleToolCall(name, args, context = {}) {
  const sessionId = context.sessionId || "default";
  const cleanArgs = sanitizeToolArgs(args);

  const policyRejection = evaluateAccessPolicy(name, cleanArgs);
  if (policyRejection) {
    const blocked = buildPolicyDeniedResponse(policyRejection);
    logTool(name, cleanArgs, blocked);
    return blocked;
  }

  if (permissionService.isRisky(name)) {
    const commandText = typeof cleanArgs.command === "string" ? cleanArgs.command : "";
    const alreadyAllowed = sessionAutoApproveAllRisky.has(sessionId) ||
      (commandText && permissionService.isAllowedBySessionPattern(sessionId, commandText));

    if (!alreadyAllowed) {
      const hasApprovalToken = Boolean(args.approval_token);
      const isApproved = args.approve === true && hasApprovalToken
        ? permissionService.validateApprovalToken(sessionId, args.approval_token, name, cleanArgs)
        : false;

      if (!isApproved) {
        const approval = permissionService.requestApproval(sessionId, name, cleanArgs);
        return buildApprovalResponse(name, cleanArgs, approval);
      }

      if (name === "run_command" && args.remember_in_session === true && commandText) {
        permissionService.allowPatternForSession(sessionId, commandText);
      }

      if (args.remember_all_risky === true) {
        sessionAutoApproveAllRisky.add(sessionId);
      }
    }
  }

  switch (name) {
    case "network_speed": {
      logTool(name, cleanArgs);
      return runNetworkSpeedTests(cleanArgs.tests).then((response) => {
        logTool(name, cleanArgs, response);
        return response;
      });
    }

    case "run_command": {
      const attempt = prepareRunCommandAttempt(sessionId, cleanArgs);
      if (attempt.suppressed) {
        const r = buildRunCommandSuppressionResponse(cleanArgs, attempt.reason);
        logTool(name, cleanArgs, r);
        return r;
      }

      logTool(name, cleanArgs);
      return runCommand(cleanArgs.command, cleanArgs.cwd, { permissionMode: PERMISSION_MODE }).then((result) => {
        recordRunCommandOutcome(sessionId, cleanArgs, result);
        logCommandPreview(cleanArgs, result);
        const r = { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        if (result.exitCode !== 0) r.isError = true;
        logTool(name, cleanArgs, r);
        return r;
      });
    }

    case "read_file": {
      try {
        const p = resolve(cleanArgs.path.replace(/^~/, homedir()));
        const text = readFileSync(p, "utf-8");
        const r = { content: [{ type: "text", text: text.slice(0, 100_000) }] };
        logTool(name, cleanArgs, r);
        return r;
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, cleanArgs, r);
        return r;
      }
    }

    case "write_file": {
      try {
        const p = resolve(cleanArgs.path.replace(/^~/, homedir()));
        writeFileSync(p, cleanArgs.content);
        const r = { content: [{ type: "text", text: `Written to ${p}` }] };
        logTool(name, cleanArgs, r);
        return r;
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, cleanArgs, r);
        return r;
      }
    }

    case "list_directory": {
      try {
        const dir = resolve((cleanArgs.path || "~").replace(/^~/, homedir()));
        const entries = readdirSync(dir).map((entry) => {
          try {
            const s = statSync(join(dir, entry));
            return `${s.isDirectory() ? "d" : "-"} ${entry}`;
          } catch {
            return `? ${entry}`;
          }
        });
        const r = { content: [{ type: "text", text: entries.join("\n") }] };
        logTool(name, cleanArgs, r);
        return r;
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, cleanArgs, r);
        return r;
      }
    }

    case "system_info": {
      const info = {
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        uptime: `${Math.floor(uptime() / 3600)}h ${Math.floor((uptime() % 3600) / 60)}m`,
        totalMemory: `${Math.round(totalmem() / 1024 / 1024 / 1024)}GB`,
        freeMemory: `${Math.round(freemem() / 1024 / 1024 / 1024)}GB`,
        homeDir: homedir(),
        nodeVersion: process.version,
      };
      logTool(name, cleanArgs);
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }

    case "read_image": {
      try {
        const p = resolve(cleanArgs.path.replace(/^~/, homedir()));
        const ext = extname(p).toLowerCase().slice(1);
        const mimeMap = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          pdf: "application/pdf", ico: "image/x-icon", bmp: "image/bmp",
        };
        const mimeType = mimeMap[ext] || "application/octet-stream";
        const buf = readFileSync(p);
        const base64 = buf.toString("base64");
        logTool(name, cleanArgs);

        if (mimeType.startsWith("image/")) {
          return {
            content: [
              { type: "image", data: base64, mimeType },
              { type: "text", text: `Image: ${p} (${mimeType}, ${buf.length} bytes)` },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: `File: ${p} (${mimeType}, ${buf.length} bytes)\nBase64: ${base64.slice(0, 200)}${base64.length > 200 ? "..." : ""}` },
          ],
        };
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, cleanArgs, r);
        return r;
      }
    }

    case "run_agent": {
      const agentName = args.name;
      logTool(name, { name: agentName });
      const agentsDir = join(homedir(), ".config", "poke-gate", "agents");

      // Ensure node_modules symlink so agents can import poke
      const pkgNodeModules = join(new URL(".", import.meta.url).pathname, "..", "node_modules");
      const agentNodeModules = join(agentsDir, "node_modules");
      if (existsSync(pkgNodeModules)) {
        try {
          const s = lstatSync(agentNodeModules);
          if (!s.isSymbolicLink()) throw new Error();
        } catch {
          try { symlinkSync(pkgNodeModules, agentNodeModules, "junction"); } catch {}
        }
      }

      let files;
      try { files = readdirSync(agentsDir).filter((f) => f.endsWith(".js") && f.startsWith(agentName + ".")); } catch { files = []; }
      if (files.length === 0) {
        let available = [];
        try { available = readdirSync(agentsDir).filter(f => f.endsWith(".js")).map(f => f.split(".")[0]); } catch {}
        return { content: [{ type: "text", text: `Agent "${agentName}" not found. Available: ${available.join(", ") || "none"}` }], isError: true };
      }
      const agentFile = join(agentsDir, files[0]);
      return runCommand(`node "${agentFile}"`, agentsDir).then((result) => {
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        if (result.exitCode === 0) {
          return { content: [{ type: "text", text: `Agent "${agentName}" completed.\n${output || "No output."}` }] };
        }
        return { content: [{ type: "text", text: `Agent "${agentName}" failed (exit ${result.exitCode}).\n${output}` }], isError: true };
      });
    }

    case "take_screenshot": {
      logTool(name, cleanArgs);

      return runCommand('open -Ra "Poke macOS Gate" 2>/dev/null', homedir()).then((appCheck) => {
        if (appCheck.exitCode === 0) {
          return runCommand('open "poke-gate://screenshot"', homedir()).then(() => {
            return { content: [{ type: "text", text: "Screenshot captured and sent to Poke via the macOS app." }] };
          });
        }

        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const dest = cleanArgs.path
          ? resolve(cleanArgs.path.replace(/^~/, homedir()))
          : join(homedir(), "Desktop", `screenshot-${ts}.png`);
        return runCommand(`/usr/sbin/screencapture -x "${dest}"`, homedir()).then((result) => {
          if (result.exitCode === 0) {
            return { content: [{ type: "text", text: `Screenshot saved to ${dest}` }] };
          }
          return { content: [{ type: "text", text: `Screenshot failed: ${result.stderr || "unknown error"}. Grant Screen Recording permission to Terminal or install the Poke macOS Gate app.` }], isError: true };
        });
      });
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

function handleJsonRpc(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "This server gives you access to the user's machine. " +
            "You can run shell commands, read/write files, list directories, and get system info. " +
            "Use these tools to help the user with OS-level tasks.",
        },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

    case "tools/call": {
      const result = handleToolCall(params.name, params.arguments || {}, msg.__context || {});
      if (result instanceof Promise) {
        return result.then((r) => ({ jsonrpc: "2.0", id, result: r }));
      }
      return { jsonrpc: "2.0", id, result };
    }

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    default:
      if (!id) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function startMcpServer(port = 0) {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, "http://localhost");

      if (url.pathname === "/mcp" && req.method === "POST") {
        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body);

          const sessionId = extractSessionId(req);

          if (Array.isArray(parsed)) {
            const results = [];
            for (const msg of parsed) {
              const m = { ...msg, __context: { sessionId } };
              const r = handleJsonRpc(m);
              const resolved = r instanceof Promise ? await r : r;
              if (resolved) results.push(resolved);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(results));
          } else {
            const m = { ...parsed, __context: { sessionId } };
            let result = handleJsonRpc(m);
            if (result instanceof Promise) result = await result;
            if (result) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(204);
              res.end();
            }
          }
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
        }
        return;
      }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.on("error", reject);
    httpServer.listen(port, "127.0.0.1", () => {
      resolve({ httpServer, port: httpServer.address().port });
    });
  });
}
