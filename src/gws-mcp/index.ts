#!/usr/bin/env bun

/**
 * Google Workspace MCP Server — built-in MCP server wrapping the `gws` CLI.
 *
 * Provides tools for Google Drive, Gmail, Sheets, Calendar, Docs, Slides,
 * Tasks, and any other Google Workspace API via the gws CLI.
 *
 * Prerequisites:
 *   brew install googleworkspace-cli
 *   gws auth login
 *
 * Usage:
 *   bun run src/gws-mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { which } from "bun";

const execFileAsync = promisify(execFile);

// ── Helpers ───────────────────────────────────────────────────────────────

/** Run a gws command and return parsed JSON output. */
async function runGws(args: string[]): Promise<unknown> {
  const { stdout, stderr } = await execFileAsync("gws", args, {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });

  if (!stdout.trim()) {
    if (stderr.trim()) throw new Error(stderr.trim());
    return { message: "Command completed with no output" };
  }

  try {
    return JSON.parse(stdout);
  } catch {
    const lines = stdout.trim().split("\n");
    if (lines.length > 1) {
      try {
        return lines.map((line) => JSON.parse(line));
      } catch {
        // Fall through
      }
    }
    return { raw: stdout.trim() };
  }
}

function jsonContent(data: unknown) {
  return { type: "text" as const, text: JSON.stringify(data, null, 2) };
}

async function withErrorHandling(fn: () => Promise<{ content: Array<{ type: "text"; text: string }> }>) {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stderr.write("[gws-mcp] Starting Google Workspace MCP server...\n");

  // Check if gws CLI is available
  const gwsPath = which("gws");
  if (!gwsPath) {
    process.stderr.write(
      "[gws-mcp] Warning: gws CLI not found. Install: brew install googleworkspace-cli\n"
    );
  } else {
    process.stderr.write(`[gws-mcp] Found gws CLI at ${gwsPath}\n`);

    // Check auth status
    try {
      const status = await runGws(["auth", "status"]) as Record<string, unknown>;
      if (status.auth_method === "none") {
        process.stderr.write("[gws-mcp] Not authenticated. Run: gws auth login\n");
      } else {
        process.stderr.write(`[gws-mcp] Authenticated via ${status.auth_method}\n`);
      }
    } catch {
      process.stderr.write("[gws-mcp] Could not check auth status\n");
    }
  }

  const server = new McpServer({
    name: "gws",
    version: "1.0.0",
  });

  // ── Auth Tools ────────────────────────────────────────────────────────

  server.tool(
    "gws_auth_status",
    "Check Google Workspace authentication status. Shows credentials, auth method, and token cache state.",
    {},
    () => withErrorHandling(async () => ({
      content: [jsonContent(await runGws(["auth", "status"]))],
    }))
  );

  server.tool(
    "gws_auth_login",
    "Start Google Workspace OAuth login. Opens browser for authentication. Run once to enable all Google Workspace tools.",
    {
      scopes: z.string().optional().describe("Comma-separated OAuth scopes"),
      full: z.boolean().optional().describe("Request full scopes including cloud-platform"),
    },
    (params) => withErrorHandling(async () => {
      const args = ["auth", "login"];
      if (params.full) args.push("--full");
      if (params.scopes) args.push("--scopes", params.scopes);
      return { content: [jsonContent(await runGws(args))] };
    })
  );

  // ── Schema Discovery ──────────────────────────────────────────────────

  server.tool(
    "gws_schema",
    "Get API schema for a Google Workspace method. Shows parameters, request body, and response format. Use dot notation: 'drive.files.list', 'gmail.users.messages.get'.",
    {
      method: z.string().describe("Fully qualified method (e.g., 'drive.files.list')"),
      resolveRefs: z.boolean().optional().describe("Resolve $ref pointers"),
    },
    (params) => withErrorHandling(async () => {
      const args = ["schema", params.method];
      if (params.resolveRefs) args.push("--resolve-refs");
      return { content: [jsonContent(await runGws(args))] };
    })
  );

  // ── Generic API Call ──────────────────────────────────────────────────

  server.tool(
    "gws_api",
    "Execute any Google Workspace API call. Services: drive, gmail, sheets, calendar, docs, slides, tasks, people, chat, classroom, forms, keep, meet, events, modelarmor. Example: service='drive', resource='files', method='list'.",
    {
      service: z.string().describe("Google service name"),
      resource: z.string().describe("API resource (e.g., 'files', 'users messages', 'spreadsheets values')"),
      method: z.string().describe("API method (list, get, create, update, delete)"),
      params: z.string().optional().describe("URL/query parameters as JSON"),
      json: z.string().optional().describe("Request body as JSON (for create/update)"),
      format: z.enum(["json", "table", "yaml", "csv"]).optional().describe("Output format"),
      pageAll: z.boolean().optional().describe("Auto-paginate all results"),
      pageLimit: z.number().optional().describe("Max pages (default: 10)"),
    },
    (params) => withErrorHandling(async () => {
      const args = [params.service, ...params.resource.split(" "), params.method];
      if (params.params) args.push("--params", params.params);
      if (params.json) args.push("--json", params.json);
      if (params.format) args.push("--format", params.format);
      if (params.pageAll) args.push("--page-all");
      if (params.pageLimit) args.push("--page-limit", String(params.pageLimit));
      return { content: [jsonContent(await runGws(args))] };
    })
  );

  // ── Drive ─────────────────────────────────────────────────────────────

  server.tool(
    "gws_drive_list",
    "List files in Google Drive. Supports search queries and folder filtering.",
    {
      query: z.string().optional().describe("Drive search query (e.g., \"name contains 'report'\")"),
      folderId: z.string().optional().describe("Folder ID to list"),
      pageSize: z.number().optional().describe("Results per page (default: 20)"),
      orderBy: z.string().optional().describe("Sort order (e.g., 'modifiedTime desc')"),
    },
    (params) => withErrorHandling(async () => {
      const q: string[] = [];
      if (params.query) q.push(params.query);
      if (params.folderId) q.push(`'${params.folderId}' in parents`);
      const apiParams: Record<string, unknown> = {
        pageSize: params.pageSize ?? 20,
        fields: "files(id,name,mimeType,modifiedTime,size,webViewLink),nextPageToken",
      };
      if (q.length > 0) apiParams.q = q.join(" and ");
      if (params.orderBy) apiParams.orderBy = params.orderBy;
      return { content: [jsonContent(await runGws(["drive", "files", "list", "--params", JSON.stringify(apiParams)]))] };
    })
  );

  server.tool(
    "gws_drive_get",
    "Get metadata of a Google Drive file by ID.",
    {
      fileId: z.string().describe("Drive file ID"),
      fields: z.string().optional().describe("Specific fields to return"),
    },
    (params) => withErrorHandling(async () => {
      const apiParams: Record<string, unknown> = { fileId: params.fileId };
      if (params.fields) apiParams.fields = params.fields;
      return { content: [jsonContent(await runGws(["drive", "files", "get", "--params", JSON.stringify(apiParams)]))] };
    })
  );

  // ── Gmail ─────────────────────────────────────────────────────────────

  server.tool(
    "gws_gmail_list",
    "List Gmail messages. Supports Gmail search syntax.",
    {
      query: z.string().optional().describe("Gmail search (e.g., 'is:unread', 'from:user@example.com')"),
      maxResults: z.number().optional().describe("Max messages (default: 10)"),
    },
    (params) => withErrorHandling(async () => {
      const apiParams: Record<string, unknown> = { userId: "me", maxResults: params.maxResults ?? 10 };
      if (params.query) apiParams.q = params.query;
      return { content: [jsonContent(await runGws(["gmail", "users", "messages", "list", "--params", JSON.stringify(apiParams)]))] };
    })
  );

  server.tool(
    "gws_gmail_get",
    "Get a Gmail message by ID. Returns headers, body, and attachments.",
    {
      messageId: z.string().describe("Gmail message ID"),
      format: z.enum(["full", "metadata", "minimal", "raw"]).optional().describe("Response format (default: full)"),
    },
    (params) => withErrorHandling(async () => {
      const apiParams: Record<string, unknown> = { userId: "me", id: params.messageId };
      if (params.format) apiParams.format = params.format;
      return { content: [jsonContent(await runGws(["gmail", "users", "messages", "get", "--params", JSON.stringify(apiParams)]))] };
    })
  );

  server.tool(
    "gws_gmail_send",
    "Send an email via Gmail. Provide raw RFC 2822 message or use the helper format.",
    {
      to: z.string().describe("Recipient email"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
    },
    (params) => withErrorHandling(async () => {
      const raw = `To: ${params.to}\r\nSubject: ${params.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${params.body}`;
      const encoded = Buffer.from(raw).toString("base64url");
      return { content: [jsonContent(await runGws(["gmail", "users", "messages", "send", "--params", '{"userId":"me"}', "--json", JSON.stringify({ raw: encoded })]))] };
    })
  );

  // ── Sheets ────────────────────────────────────────────────────────────

  server.tool(
    "gws_sheets_read",
    "Read values from a Google Sheets spreadsheet.",
    {
      spreadsheetId: z.string().describe("Spreadsheet ID"),
      range: z.string().describe("A1 notation range (e.g., 'Sheet1!A1:D10')"),
    },
    (params) => withErrorHandling(async () => {
      return { content: [jsonContent(await runGws(["sheets", "spreadsheets", "values", "get", "--params", JSON.stringify({ spreadsheetId: params.spreadsheetId, range: params.range })]))] };
    })
  );

  server.tool(
    "gws_sheets_write",
    "Write values to a Google Sheets spreadsheet.",
    {
      spreadsheetId: z.string().describe("Spreadsheet ID"),
      range: z.string().describe("A1 notation range"),
      values: z.array(z.array(z.string())).describe("2D array of values to write"),
    },
    (params) => withErrorHandling(async () => {
      return { content: [jsonContent(await runGws(["sheets", "spreadsheets", "values", "update", "--params", JSON.stringify({ spreadsheetId: params.spreadsheetId, range: params.range, valueInputOption: "USER_ENTERED" }), "--json", JSON.stringify({ values: params.values })]))] };
    })
  );

  // ── Calendar ──────────────────────────────────────────────────────────

  server.tool(
    "gws_calendar_events",
    "List upcoming Google Calendar events.",
    {
      calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
      maxResults: z.number().optional().describe("Max events (default: 10)"),
      timeMin: z.string().optional().describe("Start time filter (RFC3339)"),
      timeMax: z.string().optional().describe("End time filter (RFC3339)"),
      query: z.string().optional().describe("Free-text search"),
    },
    (params) => withErrorHandling(async () => {
      const apiParams: Record<string, unknown> = {
        calendarId: params.calendarId ?? "primary",
        maxResults: params.maxResults ?? 10,
        singleEvents: true,
        orderBy: "startTime",
      };
      if (params.timeMin) apiParams.timeMin = params.timeMin;
      if (params.timeMax) apiParams.timeMax = params.timeMax;
      if (params.query) apiParams.q = params.query;
      return { content: [jsonContent(await runGws(["calendar", "events", "list", "--params", JSON.stringify(apiParams)]))] };
    })
  );

  server.tool(
    "gws_calendar_create",
    "Create a new Google Calendar event.",
    {
      summary: z.string().describe("Event title"),
      start: z.string().describe("Start time (RFC3339 or date YYYY-MM-DD)"),
      end: z.string().describe("End time (RFC3339 or date YYYY-MM-DD)"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
      calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
    },
    (params) => withErrorHandling(async () => {
      const isDate = params.start.length === 10; // YYYY-MM-DD
      const event: Record<string, unknown> = {
        summary: params.summary,
        start: isDate ? { date: params.start } : { dateTime: params.start },
        end: isDate ? { date: params.end } : { dateTime: params.end },
      };
      if (params.description) event.description = params.description;
      if (params.location) event.location = params.location;
      if (params.attendees) event.attendees = params.attendees.map((e) => ({ email: e }));
      return { content: [jsonContent(await runGws(["calendar", "events", "insert", "--params", JSON.stringify({ calendarId: params.calendarId ?? "primary" }), "--json", JSON.stringify(event)]))] };
    })
  );

  // ── Docs ──────────────────────────────────────────────────────────────

  server.tool(
    "gws_docs_get",
    "Get a Google Doc by ID. Returns the document structure and content.",
    {
      documentId: z.string().describe("Google Doc ID"),
    },
    (params) => withErrorHandling(async () => {
      return { content: [jsonContent(await runGws(["docs", "documents", "get", "--params", JSON.stringify({ documentId: params.documentId })]))] };
    })
  );

  // ── Tasks ─────────────────────────────────────────────────────────────

  server.tool(
    "gws_tasks_list",
    "List Google Tasks from a task list.",
    {
      taskListId: z.string().optional().describe("Task list ID (default: '@default')"),
      showCompleted: z.boolean().optional().describe("Include completed tasks"),
    },
    (params) => withErrorHandling(async () => {
      const apiParams: Record<string, unknown> = {
        tasklist: params.taskListId ?? "@default",
      };
      if (params.showCompleted !== undefined) apiParams.showCompleted = params.showCompleted;
      return { content: [jsonContent(await runGws(["tasks", "tasks", "list", "--params", JSON.stringify(apiParams)]))] };
    })
  );

  // Count tools
  const internalTools = (server as any)._registeredTools;
  const toolCount = internalTools instanceof Map
    ? internalTools.size
    : Object.keys(internalTools ?? {}).length;

  process.stderr.write(`[gws-mcp] Registered ${toolCount} tools\n`);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[gws-mcp] Server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[gws-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
