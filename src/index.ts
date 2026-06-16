#!/usr/bin/env node
/**
 * forms.wtf MCP server (stdio).
 *
 * Wraps the forms.wtf v1 REST API so any MCP client (Claude Desktop, Cursor,
 * etc.) can build, manage, and analyze Web3 forms in natural language.
 *
 * Config (environment variables):
 *   FORMS_WTF_API_KEY   required: a fwtf_ key from forms.wtf → Settings → API
 *   FORMS_WTF_API_URL   optional: base URL (default https://forms.wtf)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.FORMS_WTF_API_URL || "https://forms.wtf").replace(/\/$/, "");
const API_KEY = process.env.FORMS_WTF_API_KEY;

if (!API_KEY) {
  console.error("[forms-wtf-mcp] FORMS_WTF_API_KEY environment variable is required.");
  console.error("Create a key at " + API_URL + "/dashboard/settings/api");
  process.exit(1);
}

const QUESTION_TYPES = [
  "SHORT_TEXT", "LONG_TEXT", "MULTIPLE_CHOICE", "EMAIL", "PHONE", "URL", "NUMBER",
  "DATE", "YES_NO", "DROPDOWN", "RATING", "OPINION_SCALE", "NPS", "LEGAL", "CHECKBOX",
  "STATEMENT", "WELCOME_SCREEN", "END_SCREEN", "WALLET_ADDRESS", "ENS_NAME", "FILE_UPLOAD",
] as const;

type Json = Record<string, unknown>;

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data as Json)?.error ?? `Request failed (HTTP ${res.status})`;
    throw new Error(String(msg));
  }
  return data;
}

async function apiText(path: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Request failed (HTTP ${res.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return text;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function fail(e: unknown): ToolResult {
  return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
}
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const questionShape = z.object({
  id: z.string().optional().describe("Existing question id to update; omit to create"),
  type: z.enum(QUESTION_TYPES),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  order: z.number().int().min(0),
  options: z.array(z.string()).optional().describe("For MULTIPLE_CHOICE / DROPDOWN / CHECKBOX"),
  emailVerify: z.boolean().optional().describe("For EMAIL: require OTP verification"),
});

const gateRuleShape = z.object({
  chain: z.string().optional().describe("default 'ethereum'"),
  contractAddress: z.string(),
  tokenType: z.enum(["ERC20", "ERC721", "ERC1155"]).optional(),
  minBalance: z.string().optional(),
});

const server = new McpServer({ name: "forms-wtf", version: "0.1.0" });

// --- Forms: read ---
server.tool("list_forms", "List all of your forms (id, title, slug, published, response count).", () =>
  run(() => api("/forms"))
);

server.tool(
  "get_form",
  "Get one form in full, including its questions and token-gate rules.",
  { formId: z.string() },
  ({ formId }) => run(() => api(`/forms/${formId}`))
);

server.tool("get_account", "Get your current plan, limits, and usage (forms, AI generations).", () =>
  run(() => api("/account"))
);

// --- Forms: create / generate / update / delete ---
server.tool(
  "create_form",
  "Create a new empty form. Add questions with update_form afterwards.",
  { title: z.string().min(1).max(200), description: z.string().max(1000).optional() },
  (args) => run(() => api("/forms", { method: "POST", body: JSON.stringify(args) }))
);

server.tool(
  "generate_form",
  "Generate a complete form from a natural-language description using AI. Set create=true to save it immediately (consumes one AI generation either way).",
  { prompt: z.string().min(10).max(2000), create: z.boolean().optional() },
  (args) => run(() => api("/forms/generate", { method: "POST", body: JSON.stringify(args) }))
);

server.tool(
  "update_form",
  "Update a form. Provide only the fields you want to change. Passing `questions` replaces the full question list (include existing ids to preserve them).",
  {
    formId: z.string(),
    title: z.string().max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    published: z.boolean().optional(),
    slug: z.string().optional().describe("Custom slug (Pro+ only)"),
    gateLogic: z.enum(["AND", "OR"]).optional(),
    questions: z.array(questionShape).optional(),
    gateRules: z.array(gateRuleShape).nullable().optional(),
  },
  ({ formId, ...body }) => run(() => api(`/forms/${formId}`, { method: "PUT", body: JSON.stringify(body) }))
);

server.tool(
  "publish_form",
  "Publish a form so it accepts responses.",
  { formId: z.string() },
  ({ formId }) => run(() => api(`/forms/${formId}`, { method: "PUT", body: JSON.stringify({ published: true }) }))
);

server.tool(
  "unpublish_form",
  "Unpublish a form (stops accepting responses).",
  { formId: z.string() },
  ({ formId }) => run(() => api(`/forms/${formId}`, { method: "PUT", body: JSON.stringify({ published: false }) }))
);

server.tool(
  "delete_form",
  "Permanently delete a form and all its responses.",
  { formId: z.string() },
  ({ formId }) => run(() => api(`/forms/${formId}`, { method: "DELETE" }))
);

server.tool(
  "set_token_gate",
  "Set the token-gate rules for a form (ERC20/721/1155 balance checks). Replaces existing rules.",
  {
    formId: z.string(),
    gateLogic: z.enum(["AND", "OR"]).optional(),
    rules: z.array(gateRuleShape),
  },
  ({ formId, gateLogic, rules }) =>
    run(() => api(`/forms/${formId}`, { method: "PUT", body: JSON.stringify({ gateRules: rules, ...(gateLogic ? { gateLogic } : {}) }) }))
);

// --- Responses / analytics ---
server.tool(
  "list_responses",
  "List responses for a form (paginated, newest first).",
  { formId: z.string(), page: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(100).optional() },
  ({ formId, page, limit }) => {
    const qs = new URLSearchParams();
    if (page) qs.set("page", String(page));
    if (limit) qs.set("limit", String(limit));
    const q = qs.toString();
    return run(() => api(`/forms/${formId}/responses${q ? `?${q}` : ""}`));
  }
);

server.tool(
  "get_form_analytics",
  "Get view, start, completion, and response metrics for a form.",
  { formId: z.string() },
  ({ formId }) => run(() => api(`/forms/${formId}/analytics`))
);

server.tool(
  "export_responses_csv",
  "Export all responses for a form as CSV text.",
  { formId: z.string() },
  ({ formId }) => run(() => apiText(`/forms/${formId}/export`))
);

// --- Webhooks ---
server.tool(
  "list_webhooks",
  "List webhooks configured on a form.",
  { formId: z.string() },
  ({ formId }) => run(() => api(`/forms/${formId}/webhooks`))
);

server.tool(
  "create_webhook",
  "Add a webhook to a form (requires the webhooks feature / Team+ plan). Fires on each submission.",
  { formId: z.string(), url: z.string().url(), secret: z.string().optional(), enabled: z.boolean().optional() },
  ({ formId, ...body }) => run(() => api(`/forms/${formId}/webhooks`, { method: "POST", body: JSON.stringify(body) }))
);

server.tool(
  "delete_webhook",
  "Remove a webhook from a form.",
  { formId: z.string(), webhookId: z.string() },
  ({ formId, webhookId }) => run(() => api(`/forms/${formId}/webhooks/${webhookId}`, { method: "DELETE" }))
);

// --- Utilities ---
server.tool(
  "resolve_ens",
  "Reverse-resolve an EVM wallet address to its primary ENS name (or null).",
  { address: z.string() },
  ({ address }) => run(() => api(`/ens/${address}`))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[forms-wtf-mcp] connected (API: ${API_URL})`);
}

main().catch((e) => {
  console.error("[forms-wtf-mcp] fatal:", e);
  process.exit(1);
});
