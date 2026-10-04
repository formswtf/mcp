# forms.wtf MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [forms.wtf](https://forms.wtf). Build, manage, and analyze forms from any MCP client (Claude Desktop, Claude Code, Cursor, Codex, VS Code) in natural language: one-question-at-a-time or classic forms, token gating, hidden fields, AI generation, responses, analytics and webhooks.

Source: [github.com/formswtf/mcp](https://github.com/formswtf/mcp) · Package: [`@formswtf/mcp`](https://www.npmjs.com/package/@formswtf/mcp)

## How it works

This package is a small bridge. Your MCP client starts it over stdio, and it forwards every request to the hosted forms.wtf MCP server at `https://forms.wtf/api/mcp` using your API key. The tools you see are always the ones the live app offers, so new forms.wtf features show up without updating this package.

If your client can connect to remote MCP servers by URL (ChatGPT connectors, Claude.ai connectors), you can skip this package and connect to `https://forms.wtf/api/mcp` directly with your API key as a Bearer token.

Available on **all plans** (actions respect your plan's limits, e.g. form count and AI generation quota).

## Get an API key

forms.wtf → **Settings → API → Create key**. Copy the `fwtf_...` key (shown once).

## Install

```bash
npm install -g @formswtf/mcp
# or run on demand with npx (no install)
npx @formswtf/mcp
```

## Configure your MCP client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "forms-wtf": {
      "command": "npx",
      "args": ["-y", "@formswtf/mcp"],
      "env": {
        "FORMS_WTF_API_KEY": "fwtf_your_key_here"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`) uses the same shape.

| Env var | Required | Default | Description |
|---|---|---|---|
| `FORMS_WTF_API_KEY` | yes | n/a | Your `fwtf_` API key |
| `FORMS_WTF_API_URL` | no | `https://forms.wtf` | Override the base URL (staging). Must be https (or localhost); your key is sent there |

## Tools

The tool list comes from the live server. At the time of writing:

| Tool | Description |
|---|---|
| `list_forms` | List your forms |
| `get_form` | A form with its style, settings, questions and gate rules |
| `get_account` | Plan, limits, and usage |
| `create_form` | Create a form (choose `layout`: `conversational` or `classic`) |
| `generate_form` | AI-generate a form from a prompt (optionally save it) |
| `update_form` | Update title, style, settings, questions, gate rules, publish state |
| `publish_form` / `unpublish_form` | Toggle accepting responses |
| `delete_form` | Delete a form and its responses |
| `set_token_gate` | Set ERC20/721/1155 gate rules |
| `list_responses` | Paginated responses |
| `get_form_analytics` | Views, starts, completions, response totals |
| `export_responses_csv` | All responses as CSV |
| `list_webhooks` / `create_webhook` / `delete_webhook` | Manage webhooks (Pro+) |
| `resolve_ens` | Reverse-resolve an address to its ENS name |

## Example prompts

- "Create a classic contact form with name and email side by side, a hidden utm_source field, and publish it."
- "Create a token-gated NFT allowlist form that collects wallet address, Discord handle, and Web3 experience, then publish it."
- "Show me the completion rate and last 20 responses for my DAO feedback form."
- "Export all responses from my airdrop form as CSV."

## Develop

```bash
npm install
npm run build      # compile to dist/
FORMS_WTF_API_KEY=fwtf_... npm start
```

## License

MIT
