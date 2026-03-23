import http from "node:http";
import { execSync, exec } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { hostname, platform, arch, uptime, totalmem, freemem, homedir } from "node:os";
import { join, resolve } from "node:path";

const SERVER_INFO = { name: "poke-gate", version: "0.0.1" };

const COMMAND_TIMEOUT = 30_000;

let logEnabled = false;

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
      },
      required: ["command"],
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
];

function runCommand(command, cwd) {
  return new Promise((res) => {
    const dir = cwd || homedir();
    const child = exec(command, {
      cwd: dir,
      timeout: COMMAND_TIMEOUT,
      maxBuffer: 1024 * 1024,
      shell: true,
    }, (error, stdout, stderr) => {
      res({
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 10_000),
        exitCode: error ? (error.code ?? 1) : 0,
      });
    });
  });
}

function handleToolCall(name, args) {
  switch (name) {
    case "run_command": {
      logTool(name, args);
      return runCommand(args.command, args.cwd).then((result) => {
        const r = { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        if (result.exitCode !== 0) r.isError = true;
        logTool(name, args, r);
        return r;
      });
    }

    case "read_file": {
      try {
        const p = resolve(args.path.replace(/^~/, homedir()));
        const text = readFileSync(p, "utf-8");
        const r = { content: [{ type: "text", text: text.slice(0, 100_000) }] };
        logTool(name, args, r);
        return r;
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, args, r);
        return r;
      }
    }

    case "write_file": {
      try {
        const p = resolve(args.path.replace(/^~/, homedir()));
        writeFileSync(p, args.content);
        const r = { content: [{ type: "text", text: `Written to ${p}` }] };
        logTool(name, args, r);
        return r;
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, args, r);
        return r;
      }
    }

    case "list_directory": {
      try {
        const dir = resolve((args.path || "~").replace(/^~/, homedir()));
        const entries = readdirSync(dir).map((entry) => {
          try {
            const s = statSync(join(dir, entry));
            return `${s.isDirectory() ? "d" : "-"} ${entry}`;
          } catch {
            return `? ${entry}`;
          }
        });
        const r = { content: [{ type: "text", text: entries.join("\n") }] };
        logTool(name, args, r);
        return r;
      } catch (err) {
        const r = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        logTool(name, args, r);
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
      logTool(name, args);
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
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
      const result = handleToolCall(params.name, params.arguments || {});
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

          if (Array.isArray(parsed)) {
            const results = [];
            for (const msg of parsed) {
              const r = handleJsonRpc(msg);
              const resolved = r instanceof Promise ? await r : r;
              if (resolved) results.push(resolved);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(results));
          } else {
            let result = handleJsonRpc(parsed);
            if (result instanceof Promise) result = await result;
            if (result) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(204);
              res.end();
            }
          }
        } catch (err) {
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
