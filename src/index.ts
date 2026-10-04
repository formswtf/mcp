#!/usr/bin/env node
/**
 * forms.wtf MCP server (stdio).
 *
 * A thin bridge: desktop and editor MCP clients (Claude Desktop, Claude Code,
 * Cursor, Codex, VS Code) talk to this process over stdio, and every request
 * is forwarded to the hosted forms.wtf MCP server at https://forms.wtf/api/mcp.
 * The tool list therefore always matches the live app: new features show up
 * without a new release of this package.
 *
 * Config (environment variables):
 *   FORMS_WTF_API_KEY   required: a fwtf_ key from forms.wtf → Settings → API
 *   FORMS_WTF_API_URL   optional: base URL (default https://forms.wtf)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const OFFICIAL_API_URL = "https://forms.wtf";
const API_URL = (process.env.FORMS_WTF_API_URL || OFFICIAL_API_URL).replace(/\/$/, "");
const API_KEY = process.env.FORMS_WTF_API_KEY;

if (!API_KEY) {
  console.error("[forms-wtf-mcp] FORMS_WTF_API_KEY environment variable is required.");
  console.error("Create a key at " + OFFICIAL_API_URL + "/dashboard/settings/api");
  process.exit(1);
}

// The API key is sent as a Bearer token to API_URL on every request, so the
// host must be trusted. Require HTTPS (or localhost for dev) and fail closed
// otherwise; warn loudly if pointed at a non-official host.
const isLocalhost = /^http:\/\/localhost(:\d+)?$/.test(API_URL);
if (!/^https:\/\//.test(API_URL) && !isLocalhost) {
  console.error(
    `[forms-wtf-mcp] Refusing to use FORMS_WTF_API_URL="${API_URL}": it must use https:// ` +
      `(your API key is transmitted to this host).`
  );
  process.exit(1);
}
if (API_URL !== OFFICIAL_API_URL && !isLocalhost) {
  console.error(
    `[forms-wtf-mcp] WARNING: using non-default API host "${API_URL}". Your fwtf_ API key will be sent there. ` +
      `Only set FORMS_WTF_API_URL to a host you trust.`
  );
}

const ENDPOINT = new URL("/api/mcp", API_URL);

// ── Connection to the hosted server ─────────────────────────────────────
// Connected on first use and reused. If a request fails because the
// connection dropped, the next request reconnects.

let remote: Promise<Client> | null = null;

function connectRemote(): Promise<Client> {
  if (!remote) {
    remote = (async () => {
      const client = new Client({ name: "forms-wtf-mcp-bridge", version: pkg.version });
      const transport = new StreamableHTTPClientTransport(ENDPOINT, {
        requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
      });
      await client.connect(transport);
      return client;
    })();
    remote.catch(() => {
      remote = null;
    });
  }
  return remote;
}

/** Turn a transport/HTTP failure into a message a person can act on. */
function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b401\b|unauthori[sz]ed|invalid_token/i.test(msg)) {
    return `forms.wtf rejected the API key. Check FORMS_WTF_API_KEY (create one at ${OFFICIAL_API_URL}/dashboard/settings/api).`;
  }
  if (/\b429\b|rate limit/i.test(msg)) return "forms.wtf rate limit reached. Wait a minute and try again.";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)) {
    return `Couldn't reach ${ENDPOINT.origin}. Check your internet connection.`;
  }
  return msg;
}

/** Run a request against the hosted server, reconnecting once if the connection went stale. */
async function withRemote<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  try {
    return await fn(await connectRemote());
  } catch (err) {
    // The server answered with an error (bad arguments, unknown tool...): it
    // handled the request, so never send it again.
    if (err instanceof McpError) throw err;
    // Connection-level failure (server restart, expired session, network):
    // reconnect and retry once.
    remote = null;
    try {
      return await fn(await connectRemote());
    } catch {
      throw new Error(explain(err));
    }
  }
}

// ── Local stdio server ──────────────────────────────────────────────────

const server = new Server(
  { name: "forms-wtf", version: pkg.version },
  {
    capabilities: { tools: {} },
    instructions:
      "Build, manage and analyze forms.wtf forms: conversational (one question at a time) or classic (all fields on one page), " +
      "with token gating, hidden fields, AI generation, responses, analytics and webhooks. Tools mirror the live forms.wtf app.",
  }
);

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  return withRemote((client) => client.listTools(request.params));
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  try {
    return (await withRemote((client) => client.callTool(request.params))) as CallToolResult;
  } catch (err) {
    // Report as a tool error so the assistant can tell the user what went wrong.
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
});

const shutdown = async () => {
  try {
    const client = remote ? await remote : null;
    await client?.close();
  } catch {
    // exiting anyway
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
