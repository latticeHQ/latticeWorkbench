/**
 * Dialog showing Lattice CLI installation instructions.
 * Guides users through installing via Homebrew, then re-checks CLI availability.
 */

import { useState, useCallback } from "react";
import { Terminal, Copy, Check, Loader2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/browser/components/ui/dialog";
import { Button } from "@/browser/components/ui/button";
import { useAPI } from "@/browser/contexts/API";
import type { LatticeInfo } from "@/common/orpc/schemas/lattice";

const BREW_COMMAND = "brew install latticehq/lattice/lattice";
const LATTICE_DOCS_URL = "https://github.com/latticehq/lattice";

interface LatticeInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after CLI is detected so the caller can refresh state. */
  onInstallSuccess: () => void;
}

export function LatticeInstallDialog({
  open,
  onOpenChange,
  onInstallSuccess,
}: LatticeInstallDialogProps) {
  const { api } = useAPI();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<LatticeInfo | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(BREW_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts; ignore.
    }
  }, []);

  const handleCheckInstall = useCallback(async () => {
    if (!api) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const info = await api.lattice.getInfo();
      setCheckResult(info);
      if (info.state === "available" || info.state === "outdated") {
        // CLI found — close after brief delay and notify parent.
        setTimeout(() => {
          onOpenChange(false);
          onInstallSuccess();
        }, 1200);
      }
    } catch {
      setCheckResult({
        state: "unavailable",
        reason: { kind: "error", message: "Failed to check CLI status" },
      });
    } finally {
      setChecking(false);
    }
  }, [api, onOpenChange, onInstallSuccess]);

  const handleClose = () => {
    onOpenChange(false);
    setCopied(false);
    setChecking(false);
    setCheckResult(null);
  };

  const detected =
    checkResult?.state === "available" || checkResult?.state === "outdated";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            Install Lattice CLI
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-muted-foreground text-sm">
            The Lattice CLI is required to connect to Lattice Runtime minions.
            Install it with Homebrew, then click "Check Installation" to verify.
          </p>

          {/* Brew command with copy button */}
          <div className="bg-background-secondary border-border-light flex items-center justify-between gap-2 rounded-md border px-3 py-2.5">
            <code className="text-foreground text-sm font-mono select-all">
              {BREW_COMMAND}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0"
              onClick={() => void handleCopy()}
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <p className="text-muted text-xs">
            Open a terminal, paste the command above, and wait for installation to
            complete. Then come back here and click the button below.
          </p>

          {/* Check result feedback */}
          {checkResult && !detected && (
            <p className="text-destructive text-sm">
              CLI not detected yet. Make sure the install finished and try again.
            </p>
          )}
          {detected && (
            <p className="text-sm text-green-500 flex items-center gap-1.5">
              <Check className="h-4 w-4" />
              Lattice CLI detected!
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button
              variant="link"
              size="sm"
              className="text-muted h-auto p-0 text-xs"
              onClick={() => window.open(LATTICE_DOCS_URL, "_blank", "noopener")}
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Docs
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => void handleCheckInstall()} disabled={checking}>
                {checking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking…
                  </>
                ) : (
                  "Check Installation"
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
