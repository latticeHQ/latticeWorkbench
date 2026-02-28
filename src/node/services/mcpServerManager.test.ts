import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createServer } from "http";

import { MCPServerManager } from "./mcpServerManager";
import type { MCPConfigService } from "./mcpConfigService";
import type { Runtime } from "@/node/runtime/Runtime";
import type { Tool } from "ai";

interface MCPServerManagerTestAccess {
  minionServers: Map<string, unknown>;
  cleanupIdleServers: () => void;
  startServers: (...args: unknown[]) => Promise<Map<string, unknown>>;
}

describe("MCPServerManager", () => {
  let configService: {
    listServers: ReturnType<typeof mock>;
  };

  let manager: MCPServerManager;
  let access: MCPServerManagerTestAccess;

  beforeEach(() => {
    configService = {
      listServers: mock(() => Promise.resolve({})),
    };

    manager = new MCPServerManager(configService as unknown as MCPConfigService);
    access = manager as unknown as MCPServerManagerTestAccess;
  });

  afterEach(() => {
    manager.dispose();
  });

  test("cleanupIdleServers stops idle servers when minion is not leased", () => {
    const minionId = "ws-idle";

    const close = mock(() => Promise.resolve(undefined));

    const instance = {
      name: "server",
      resolvedTransport: "stdio",
      autoFallbackUsed: false,
      tools: {},
      isClosed: false,
      close,
    };

    const entry = {
      configSignature: "sig",
      instances: new Map([["server", instance]]),
      stats: {
        enabledServerCount: 1,
        startedServerCount: 1,
        failedServerCount: 0,
        autoFallbackCount: 0,
        hasStdio: true,
        hasHttp: false,
        hasSse: false,
        transportMode: "stdio_only",
      },
      lastActivity: Date.now() - 11 * 60_000,
    };

    access.minionServers.set(minionId, entry);

    access.cleanupIdleServers();

    expect(access.minionServers.has(minionId)).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("cleanupIdleServers does not stop idle servers when minion is leased", () => {
    const minionId = "ws-leased";

    const close = mock(() => Promise.resolve(undefined));

    const instance = {
      name: "server",
      resolvedTransport: "stdio",
      autoFallbackUsed: false,
      tools: {},
      isClosed: false,
      close,
    };

    const entry = {
      configSignature: "sig",
      instances: new Map([["server", instance]]),
      stats: {
        enabledServerCount: 1,
        startedServerCount: 1,
        failedServerCount: 0,
        autoFallbackCount: 0,
        hasStdio: true,
        hasHttp: false,
        hasSse: false,
        transportMode: "stdio_only",
      },
      lastActivity: Date.now() - 11 * 60_000,
    };

    access.minionServers.set(minionId, entry);
    manager.acquireLease(minionId);

    // Ensure the minion still looks idle even after acquireLease() updates activity.
    (entry as { lastActivity: number }).lastActivity = Date.now() - 11 * 60_000;

    access.cleanupIdleServers();

    expect(access.minionServers.has(minionId)).toBe(true);
    expect(close).toHaveBeenCalledTimes(0);
  });

  test("getToolsForMinion defers restarts while leased and applies them on next request", async () => {
    const minionId = "ws-defer";
    const projectPath = "/tmp/project";
    const minionPath = "/tmp/minion";

    let command = "cmd-1";
    configService.listServers = mock(() =>
      Promise.resolve({
        server: { transport: "stdio", command, disabled: false },
      })
    );

    const close = mock(() => Promise.resolve(undefined));

    const dummyTool = {
      execute: mock(() => Promise.resolve({ ok: true })),
    } as unknown as Tool;

    const startServersMock = mock(() =>
      Promise.resolve(
        new Map([
          [
            "server",
            {
              name: "server",
              resolvedTransport: "stdio",
              autoFallbackUsed: false,
              tools: { tool: dummyTool },
              isClosed: false,
              close,
            },
          ],
        ])
      )
    );

    access.startServers = startServersMock;

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    manager.acquireLease(minionId);

    // Change signature while leased.
    command = "cmd-2";

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    expect(startServersMock).toHaveBeenCalledTimes(1);

    manager.releaseLease(minionId);

    // No automatic restart on lease release (avoids closing clients out from under a
    // subsequent stream that already captured the tool objects).
    expect(access.minionServers.has(minionId)).toBe(true);
    expect(close).toHaveBeenCalledTimes(0);

    // Next request (no lease) applies the pending restart.
    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    expect(startServersMock).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("getToolsForMinion restarts when cached instances are marked closed", async () => {
    const minionId = "ws-closed";
    const projectPath = "/tmp/project";
    const minionPath = "/tmp/minion";

    configService.listServers = mock(() =>
      Promise.resolve({
        server: { transport: "stdio", command: "cmd", disabled: false },
      })
    );

    const close1 = mock(() => Promise.resolve(undefined));
    const close2 = mock(() => Promise.resolve(undefined));

    let startCount = 0;
    const startServersMock = mock(() => {
      startCount += 1;
      return Promise.resolve(
        new Map([
          [
            "server",
            {
              name: "server",
              resolvedTransport: "stdio",
              autoFallbackUsed: false,
              tools: {},
              isClosed: false,
              close: startCount === 1 ? close1 : close2,
            },
          ],
        ])
      );
    });

    access.startServers = startServersMock;

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    // Simulate an active stream lease.
    manager.acquireLease(minionId);

    const cached = access.minionServers.get(minionId) as {
      instances: Map<string, { isClosed: boolean }>;
    };

    const instance = cached.instances.get("server");
    expect(instance).toBeTruthy();
    if (instance) {
      instance.isClosed = true;
    }

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    expect(startServersMock).toHaveBeenCalledTimes(2);
    expect(close1).toHaveBeenCalledTimes(1);
  });

  test("getToolsForMinion does not close healthy instances when restarting closed ones while leased", async () => {
    const minionId = "ws-closed-partial";
    const projectPath = "/tmp/project";
    const minionPath = "/tmp/minion";

    configService.listServers = mock(() =>
      Promise.resolve({
        serverA: { transport: "stdio", command: "cmd-a", disabled: false },
        serverB: { transport: "stdio", command: "cmd-b", disabled: false },
      })
    );

    const closeA1 = mock(() => Promise.resolve(undefined));
    const closeA2 = mock(() => Promise.resolve(undefined));
    const closeB1 = mock(() => Promise.resolve(undefined));

    let startCount = 0;
    const startServersMock = mock(() => {
      startCount += 1;

      if (startCount === 1) {
        return Promise.resolve(
          new Map([
            [
              "serverA",
              {
                name: "serverA",
                resolvedTransport: "stdio",
                autoFallbackUsed: false,
                tools: {},
                isClosed: false,
                close: closeA1,
              },
            ],
            [
              "serverB",
              {
                name: "serverB",
                resolvedTransport: "stdio",
                autoFallbackUsed: false,
                tools: {},
                isClosed: false,
                close: closeB1,
              },
            ],
          ])
        );
      }

      return Promise.resolve(
        new Map([
          [
            "serverA",
            {
              name: "serverA",
              resolvedTransport: "stdio",
              autoFallbackUsed: false,
              tools: {},
              isClosed: false,
              close: closeA2,
            },
          ],
        ])
      );
    });

    access.startServers = startServersMock;

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    // Simulate an active stream lease.
    manager.acquireLease(minionId);

    const cached = access.minionServers.get(minionId) as {
      instances: Map<string, { isClosed: boolean }>;
    };

    const instanceA = cached.instances.get("serverA");
    expect(instanceA).toBeTruthy();
    if (instanceA) {
      instanceA.isClosed = true;
    }

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    // Restart should only close the dead instance.
    expect(closeA1).toHaveBeenCalledTimes(1);
    expect(closeB1).toHaveBeenCalledTimes(0);
  });

  test("getToolsForMinion does not return tools from newly-disabled servers while leased", async () => {
    const minionId = "ws-disable-while-leased";
    const projectPath = "/tmp/project";
    const minionPath = "/tmp/minion";

    configService.listServers = mock(() =>
      Promise.resolve({
        serverA: { transport: "stdio", command: "cmd-a", disabled: false },
        serverB: { transport: "stdio", command: "cmd-b", disabled: false },
      })
    );

    const dummyToolA = { execute: mock(() => Promise.resolve({ ok: true })) } as unknown as Tool;
    const dummyToolB = { execute: mock(() => Promise.resolve({ ok: true })) } as unknown as Tool;

    const startServersMock = mock(() =>
      Promise.resolve(
        new Map([
          [
            "serverA",
            {
              name: "serverA",
              resolvedTransport: "stdio",
              autoFallbackUsed: false,
              tools: { tool: dummyToolA },
              isClosed: false,
              close: mock(() => Promise.resolve(undefined)),
            },
          ],
          [
            "serverB",
            {
              name: "serverB",
              resolvedTransport: "stdio",
              autoFallbackUsed: false,
              tools: { tool: dummyToolB },
              isClosed: false,
              close: mock(() => Promise.resolve(undefined)),
            },
          ],
        ])
      )
    );

    access.startServers = startServersMock;

    await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
    });

    manager.acquireLease(minionId);

    const toolsResult = await manager.getToolsForMinion({
      minionId,
      projectPath,
      runtime: {} as unknown as Runtime,
      minionPath,
      overrides: {
        disabledServers: ["serverB"],
      },
    });

    // Tool names are normalized to provider-safe keys (lowercase + underscore-delimited).
    expect(Object.keys(toolsResult.tools)).toContain("servera_tool");
    expect(Object.keys(toolsResult.tools)).not.toContain("serverb_tool");
  });

  test("test() includes oauthChallenge when server responds 401 + WWW-Authenticate Bearer", async () => {
    let baseUrl = "";
    let resourceMetadataUrl = "";

    const server = createServer((_req, res) => {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        `Bearer scope="mcp.read" resource_metadata="${resourceMetadataUrl}"`
      );
      res.end("Unauthorized");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind OAuth challenge test server");
      }

      baseUrl = `http://127.0.0.1:${address.port}/`;
      resourceMetadataUrl = `${baseUrl}.well-known/oauth-protected-resource`;

      const result = await manager.test({
        projectPath: "/tmp/project",
        transport: "http",
        url: baseUrl,
      });

      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("Expected test() to fail");
      }

      expect(result.oauthChallenge).toEqual({
        scope: "mcp.read",
        resourceMetadataUrl,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
