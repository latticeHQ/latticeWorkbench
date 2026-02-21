/**
 * AgentToastRenderer — renders global agent lifecycle toasts in a portal.
 *
 * Toasts are stacked in the bottom-right corner of the viewport, above
 * the status bar. Each slides in from the right and auto-dismisses.
 *
 * Usage: mount once near the app root (WorkspaceShell / App).
 * Fire toasts from anywhere via showAgentToast() from agentToast.ts.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/common/lib/utils";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useAgentToasts, dismissAgentToast } from "@/browser/stores/agentToast";
import type { AgentToast, AgentToastType } from "@/browser/stores/agentToast";

// ── Per-toast item ────────────────────────────────────────────────────────────

function ToastItem({ toast }: { toast: AgentToast }) {
  const [leaving, setLeaving] = useState(false);

  // Animate out just before dismiss
  useEffect(() => {
    if (toast.duration > 0) {
      const leaveDelay = Math.max(0, toast.duration - 350);
      const t = setTimeout(() => setLeaving(true), leaveDelay);
      return () => clearTimeout(t);
    }
  }, [toast.duration]);

  const handleClose = () => {
    setLeaving(true);
    setTimeout(() => dismissAgentToast(toast.id), 280);
  };

  const icon = getIcon(toast.type);
  const accentClass = getAccentClass(toast.type);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto flex w-72 items-start gap-3 rounded-xl border bg-background-secondary px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all duration-300",
        "border-border",
        // slide-in from right; fade-out to right
        leaving
          ? "translate-x-4 opacity-0"
          : "translate-x-0 opacity-100 animate-[agentToastIn_0.25s_cubic-bezier(0.16,1,0.3,1)]"
      )}
    >
      {/* Accent strip */}
      <div className={cn("mt-0.5 h-4 w-0.5 shrink-0 rounded-full", accentClass)} />

      {/* Icon */}
      <span className={cn("mt-0.5 shrink-0", accentClass)}>{icon}</span>

      {/* Text */}
      <div className="min-w-0 flex-1">
        {toast.label && (
          <div className={cn("mb-0.5 text-[9px] font-bold uppercase tracking-widest", accentClass)}>
            {toast.label}
          </div>
        )}
        <div className="text-foreground truncate text-xs font-medium">{toast.message}</div>
      </div>

      {/* Dismiss */}
      <button
        onClick={handleClose}
        aria-label="Dismiss"
        className="text-muted hover:text-foreground mt-0.5 shrink-0 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function getIcon(type: AgentToastType) {
  switch (type) {
    case "done":
    case "success":
      return <CheckCircle2 className="h-4 w-4" />;
    case "error":
      return <AlertCircle className="h-4 w-4" />;
    default:
      return <Info className="h-4 w-4" />;
  }
}

function getAccentClass(type: AgentToastType): string {
  switch (type) {
    case "done":
    case "success":
      return "text-[var(--color-success)]";
    case "error":
      return "text-destructive";
    default:
      return "text-[var(--color-exec-mode)]";
  }
}

// ── Renderer (portal) ─────────────────────────────────────────────────────────

export function AgentToastRenderer() {
  const toasts = useAgentToasts();

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-label="Agent notifications"
      className="pointer-events-none fixed bottom-10 right-4 z-[9000] flex flex-col-reverse gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}
