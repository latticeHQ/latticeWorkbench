import assert from "node:assert/strict";
import type { RuntimeMode } from "../../common/types/runtime";
import type { NegotiatedCapabilities } from "./capabilities";

const KNOWN_RUNTIME_MODES: ReadonlySet<RuntimeMode> = new Set([
  "local",
  "worktree",
  "ssh",
  "docker",
  "devcontainer",
]);

export interface SessionRouting {
  minionId: string;
  runtimeMode: RuntimeMode;
  editorHandlesFs: boolean;
  editorHandlesTerminal: boolean;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRouting>();
  private readonly minionToSession = new Map<string, string>();

  registerSession(
    sessionId: string,
    minionId: string,
    runtimeMode: RuntimeMode,
    negotiated?: NegotiatedCapabilities
  ): void {
    assert(sessionId.trim().length > 0, "[SessionManager] sessionId must be a non-empty string");
    assert(
      minionId.trim().length > 0,
      "[SessionManager] minionId must be a non-empty string"
    );
    assert(
      KNOWN_RUNTIME_MODES.has(runtimeMode),
      `[SessionManager] unsupported runtime mode: ${runtimeMode}`
    );

    const existingRouting = this.sessions.get(sessionId);
    if (existingRouting && existingRouting.minionId !== minionId) {
      this.minionToSession.delete(existingRouting.minionId);
    }

    const existingSessionId = this.minionToSession.get(minionId);
    if (existingSessionId && existingSessionId !== sessionId) {
      this.sessions.delete(existingSessionId);
    }

    const isLocal = runtimeMode === "local";
    this.sessions.set(sessionId, {
      minionId,
      runtimeMode,
      editorHandlesFs: isLocal && (negotiated?.editorSupportsFsWrite ?? false),
      editorHandlesTerminal: isLocal && (negotiated?.editorSupportsTerminal ?? false),
    });

    this.minionToSession.set(minionId, sessionId);
  }

  getRouting(sessionId: string): SessionRouting {
    const routing = this.sessions.get(sessionId);
    assert(routing, `[SessionManager] missing routing for sessionId "${sessionId}"`);
    return routing;
  }

  getMinionId(sessionId: string): string {
    return this.getRouting(sessionId).minionId;
  }

  getSessionId(minionId: string): string {
    const sessionId = this.minionToSession.get(minionId);
    assert(sessionId, `[SessionManager] missing sessionId for minionId "${minionId}"`);
    return sessionId;
  }

  removeSession(sessionId: string): void {
    const routing = this.sessions.get(sessionId);
    if (!routing) {
      return;
    }

    this.sessions.delete(sessionId);

    const mappedSessionId = this.minionToSession.get(routing.minionId);
    if (mappedSessionId === sessionId) {
      this.minionToSession.delete(routing.minionId);
    }
  }

  getAllSessions(): ReadonlyMap<string, SessionRouting> {
    return this.sessions;
  }
}
