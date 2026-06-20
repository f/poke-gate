import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { startMcpServer } from "../src/mcp-server.js";

const TUNNEL_CONNECTION_ID = "64574786-7a08-4074-ab67-8078a40b7ba2";

function request({ port, method = "GET", path = "/", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
        if (headers.Accept === "text/event-stream") {
          req.destroy();
        }
      });
      res.on("end", () => resolve({ res, body: data }));
      res.on("close", () => resolve({ res, body: data }));
    });
    req.on("error", (error) => {
      if (headers.Accept === "text/event-stream") return;
      reject(error);
    });
    if (body) req.write(body);
    req.end();
  });
}

test("MCP POST responses include session id header", async () => {
  const { httpServer, port } = await startMcpServer();
  try {
    const { res, body } = await request({
      port,
      method: "POST",
      path: "/mcp",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "session-1",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["mcp-session-id"], "session-1");
    assert.equal(JSON.parse(body).result.tools.length > 0, true);
  } finally {
    httpServer.close();
  }
});

test("MCP GET supports event stream transport", async () => {
  const { httpServer, port } = await startMcpServer();
  try {
    const { res, body } = await request({
      port,
      path: "/mcp",
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": "session-2",
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/event-stream");
    assert.equal(res.headers["mcp-session-id"], "session-2");
    assert.match(body, /: connected/);
  } finally {
    httpServer.close();
  }
});

test("MCP POST accepts Poke tunnel connection-id prefix", async () => {
  const { httpServer, port } = await startMcpServer();
  try {
    const { res, body } = await request({
      port,
      method: "POST",
      path: `/${TUNNEL_CONNECTION_ID}/mcp`,
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "session-prefixed-post",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["mcp-session-id"], "session-prefixed-post");
    assert.equal(JSON.parse(body).result.tools.length > 0, true);
  } finally {
    httpServer.close();
  }
});

test("MCP GET accepts Poke tunnel connection-id prefix", async () => {
  const { httpServer, port } = await startMcpServer();
  try {
    const { res, body } = await request({
      port,
      path: `/${TUNNEL_CONNECTION_ID}/mcp`,
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": "session-prefixed-get",
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/event-stream");
    assert.equal(res.headers["mcp-session-id"], "session-prefixed-get");
    assert.match(body, /: connected/);
  } finally {
    httpServer.close();
  }
});

test("MCP route rejects non-connection-id prefixes", async () => {
  const { httpServer, port } = await startMcpServer();
  try {
    const { res } = await request({
      port,
      method: "POST",
      path: "/not-a-connection/mcp",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    assert.equal(res.statusCode, 404);
  } finally {
    httpServer.close();
  }
});
