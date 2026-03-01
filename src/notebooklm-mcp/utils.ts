/**
 * Shared utilities for the NotebookLM MCP server.
 */

/**
 * Format a value as JSON text content for MCP tool responses.
 */
export function jsonContent(data: unknown): { type: "text"; text: string } {
  return { type: "text" as const, text: JSON.stringify(data, null, 2) };
}

/**
 * Create an MCP error response.
 */
export function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

/**
 * Wrap an async tool handler with standardized error handling.
 * Catches exceptions and returns MCP-formatted error responses.
 */
export function withErrorHandling(
  fn: () => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  return fn().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message);
  });
}
