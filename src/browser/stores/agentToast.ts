/**
 * Lightweight global toast store for agent lifecycle notifications.
 *
 * No external dependencies — just a plain JS singleton with a React hook.
 * Used for: agent completion, terminal exit, workspace task reporting.
 */
import { useSyncExternalStore } from "react";

export type AgentToastType = "done" | "success" | "info" | "error";

export interface AgentToast {
  id: string;
  type: AgentToastType;
  /** Short pill label shown above the message (e.g. "Agent Done") */
  label?: string;
  message: string;
  /** Auto-dismiss after this many ms (0 = no auto-dismiss) */
  duration: number;
}

// ── Singleton state ──────────────────────────────────────────────────────────
let _toasts: AgentToast[] = [];
let _listeners: Array<() => void> = [];

function _notify() {
  for (const l of _listeners) l();
}

// ── Public API ───────────────────────────────────────────────────────────────

export function showAgentToast(
  message: string,
  opts?: {
    label?: string;
    type?: AgentToastType;
    duration?: number;
  }
): void {
  const toast: AgentToast = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    label: opts?.label,
    type: opts?.type ?? "done",
    duration: opts?.duration ?? 4500,
  };

  _toasts = [..._toasts, toast];
  _notify();

  if (toast.duration > 0) {
    setTimeout(() => dismissAgentToast(toast.id), toast.duration);
  }
}

export function dismissAgentToast(id: string): void {
  _toasts = _toasts.filter((t) => t.id !== id);
  _notify();
}

function _getToasts(): AgentToast[] {
  return _toasts;
}

function _subscribe(listener: () => void): () => void {
  _listeners = [..._listeners, listener];
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

// ── React hook ───────────────────────────────────────────────────────────────
export function useAgentToasts(): AgentToast[] {
  return useSyncExternalStore(_subscribe, _getToasts);
}
