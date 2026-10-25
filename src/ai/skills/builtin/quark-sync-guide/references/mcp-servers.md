# MCP Server Configuration

Use this reference when the user asks to add, edit, remove, or diagnose an MCP
server.

## Configuration workflow

1. The file is a real vault file at `.agents/quark-sync/mcp.json`, visible
   to the tools at `/.agents/quark-sync/mcp.json`.
2. Read the file first when it exists: `cat /.agents/quark-sync/mcp.json`.
   Preserve unrelated server entries unless the user asks to remove them.
3. The file is a JSON object with a top-level `mcpServers` map. Each server
   name must use letters, numbers, hyphens, or underscores, and must start with
   a letter or number.
4. Only HTTP servers are supported. A server entry has `type: "http"`, a
   `url`, optional string `headers`, and optional boolean `enabled`. A server
   with `enabled` missing or `false` is disabled; in-file `enabled: false`
   differs from disabling a server for one chat session.
5. To add, edit, or remove a server, rewrite the complete `mcpServers` map with
   `jq` on the current contents or an `apply_patch` update (read the file before
   patching). Keep the JSON valid and intact, and never drop other servers.
6. Handle headers as secrets: retain existing values where possible and never
   include their values in a chat response.
7. MCP tools are refreshed before the next agent turn. After changing the file,
   tell the user that the configuration will take effect on their next message;
   the new tools are not available in the current turn.

Use this neutral example only when the user needs the file format:

```json
{
	"mcpServers": {
		"notes-service": {
			"type": "http",
			"url": "https://example.com/mcp",
			"enabled": true
		}
	}
}
```

If connection or parsing fails, explain the observed error and check the
server name, JSON syntax, URL, and header names before proposing a change.
