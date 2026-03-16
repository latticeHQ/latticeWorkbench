/**
 * Google Workspace CLI (gws) tools.
 *
 * Wraps the `gws` CLI (https://github.com/googleworkspace/cli) as MCP tools
 * so agents can interact with Drive, Gmail, Sheets, Docs, Calendar, and more
 * without needing to know the CLI syntax.
 *
 * Prerequisites:
 *   brew install googleworkspace-cli
 *   gws auth login
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { jsonContent, withErrorHandling } from "../utils";

const execFileAsync = promisify(execFile);

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
    // Some commands return NDJSON (one JSON per line)
    const lines = stdout.trim().split("\n");
    if (lines.length > 1) {
      try {
        return lines.map((line) => JSON.parse(line));
      } catch {
        // Fall through to raw text
      }
    }
    return { raw: stdout.trim() };
  }
}

export function registerGwsTools(server: McpServer): void {
  // ── Auth Status ─────────────────────────────────────────────────────────
  server.tool(
    "gws_auth_status",
    "Check Google Workspace CLI authentication status. Shows whether credentials are configured and which auth method is active.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await runGws(["auth", "status"]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Auth Login ──────────────────────────────────────────────────────────
  server.tool(
    "gws_auth_login",
    "Start Google Workspace CLI OAuth login flow. Opens a browser for Google authentication. Run this once to enable all Google Workspace tools.",
    {
      scopes: z
        .string()
        .optional()
        .describe("Comma-separated OAuth scopes (default: drive,sheets,gmail,calendar,docs,slides,tasks)"),
      full: z
        .boolean()
        .optional()
        .describe("Request full scopes including cloud-platform (default: false)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const args = ["auth", "login"];
        if (params.full) args.push("--full");
        if (params.scopes) args.push("--scopes", params.scopes);
        const result = await runGws(args);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Generic API Call ────────────────────────────────────────────────────
  server.tool(
    "gws_api",
    "Execute any Google Workspace API call via the gws CLI. Use 'gws schema <service.resource.method>' pattern to discover available methods. Examples: 'drive files list', 'gmail users messages list', 'sheets spreadsheets get'.",
    {
      service: z.string().describe("Google service (drive, gmail, sheets, calendar, docs, slides, tasks, people, chat, etc.)"),
      resource: z.string().describe("API resource (e.g., 'files', 'users messages', 'spreadsheets')"),
      method: z.string().describe("API method (list, get, create, update, delete, etc.)"),
      params: z.string().optional().describe("URL/query parameters as JSON string"),
      json: z.string().optional().describe("Request body as JSON string (for create/update)"),
      format: z.enum(["json", "table", "yaml", "csv"]).optional().describe("Output format (default: json)"),
      pageAll: z.boolean().optional().describe("Auto-paginate all results"),
      pageLimit: z.number().optional().describe("Max pages to fetch with pageAll (default: 10)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const args = [params.service, ...params.resource.split(" "), params.method];
        if (params.params) args.push("--params", params.params);
        if (params.json) args.push("--json", params.json);
        if (params.format) args.push("--format", params.format);
        if (params.pageAll) args.push("--page-all");
        if (params.pageLimit) args.push("--page-limit", String(params.pageLimit));
        const result = await runGws(args);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Schema Discovery ────────────────────────────────────────────────────
  server.tool(
    "gws_schema",
    "Get the API schema for a Google Workspace method. Shows required/optional parameters, request body structure, and response format. Use dot notation like 'drive.files.list' or 'gmail.users.messages.get'.",
    {
      method: z.string().describe("Fully qualified method name (e.g., 'drive.files.list', 'sheets.spreadsheets.values.get')"),
      resolveRefs: z.boolean().optional().describe("Resolve JSON schema $ref pointers (default: false)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const args = ["schema", params.method];
        if (params.resolveRefs) args.push("--resolve-refs");
        const result = await runGws(args);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Drive: List Files ───────────────────────────────────────────────────
  server.tool(
    "gws_drive_list",
    "List files in Google Drive. Supports search queries, folder filtering, and pagination.",
    {
      query: z.string().optional().describe("Drive search query (e.g., \"name contains 'report'\" or \"mimeType='application/vnd.google-apps.spreadsheet'\")"),
      folderId: z.string().optional().describe("List files in a specific folder"),
      pageSize: z.number().optional().describe("Number of files per page (default: 20, max: 1000)"),
      orderBy: z.string().optional().describe("Sort order (e.g., 'modifiedTime desc', 'name')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const queryParts: string[] = [];
        if (params.query) queryParts.push(params.query);
        if (params.folderId) queryParts.push(`'${params.folderId}' in parents`);

        const apiParams: Record<string, unknown> = {
          pageSize: params.pageSize ?? 20,
          fields: "files(id,name,mimeType,modifiedTime,size,webViewLink),nextPageToken",
        };
        if (queryParts.length > 0) apiParams.q = queryParts.join(" and ");
        if (params.orderBy) apiParams.orderBy = params.orderBy;

        const result = await runGws([
          "drive", "files", "list",
          "--params", JSON.stringify(apiParams),
        ]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Drive: Download ─────────────────────────────────────────────────────
  server.tool(
    "gws_drive_get",
    "Get metadata or content of a Google Drive file by ID.",
    {
      fileId: z.string().describe("The Drive file ID"),
      fields: z.string().optional().describe("Specific fields to return (default: all)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const apiParams: Record<string, unknown> = { fileId: params.fileId };
        if (params.fields) apiParams.fields = params.fields;
        const result = await runGws([
          "drive", "files", "get",
          "--params", JSON.stringify(apiParams),
        ]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Gmail: List Messages ────────────────────────────────────────────────
  server.tool(
    "gws_gmail_list",
    "List Gmail messages. Supports search queries matching Gmail search syntax.",
    {
      query: z.string().optional().describe("Gmail search query (e.g., 'is:unread', 'from:user@example.com', 'subject:invoice')"),
      maxResults: z.number().optional().describe("Max messages to return (default: 10)"),
      labelIds: z.array(z.string()).optional().describe("Filter by label IDs (e.g., ['INBOX', 'UNREAD'])"),
    },
    (params) =>
      withErrorHandling(async () => {
        const apiParams: Record<string, unknown> = {
          userId: "me",
          maxResults: params.maxResults ?? 10,
        };
        if (params.query) apiParams.q = params.query;
        if (params.labelIds) apiParams.labelIds = params.labelIds;
        const result = await runGws([
          "gmail", "users", "messages", "list",
          "--params", JSON.stringify(apiParams),
        ]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Sheets: Read ────────────────────────────────────────────────────────
  server.tool(
    "gws_sheets_read",
    "Read values from a Google Sheets spreadsheet.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      range: z.string().describe("A1 notation range (e.g., 'Sheet1!A1:D10', 'Sheet1')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await runGws([
          "sheets", "spreadsheets", "values", "get",
          "--params", JSON.stringify({
            spreadsheetId: params.spreadsheetId,
            range: params.range,
          }),
        ]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Calendar: List Events ───────────────────────────────────────────────
  server.tool(
    "gws_calendar_events",
    "List upcoming Google Calendar events.",
    {
      calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
      maxResults: z.number().optional().describe("Max events to return (default: 10)"),
      timeMin: z.string().optional().describe("Start time filter (RFC3339, e.g., '2026-03-16T00:00:00Z')"),
      timeMax: z.string().optional().describe("End time filter (RFC3339)"),
      query: z.string().optional().describe("Free-text search query"),
    },
    (params) =>
      withErrorHandling(async () => {
        const apiParams: Record<string, unknown> = {
          calendarId: params.calendarId ?? "primary",
          maxResults: params.maxResults ?? 10,
          singleEvents: true,
          orderBy: "startTime",
        };
        if (params.timeMin) apiParams.timeMin = params.timeMin;
        if (params.timeMax) apiParams.timeMax = params.timeMax;
        if (params.query) apiParams.q = params.query;
        const result = await runGws([
          "calendar", "events", "list",
          "--params", JSON.stringify(apiParams),
        ]);
        return { content: [jsonContent(result)] };
      })
  );
}
