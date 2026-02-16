import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/browser/components/ui/dialog";
import { Button } from "@/browser/components/ui/button";
import { Loader2, Terminal, LogIn } from "lucide-react";

interface LatticeAuthModalProps {
  isOpen: boolean;
  reason: string;
  onRetry: () => Promise<boolean>;
  onSkip: () => void;
}

export function LatticeAuthModal(props: LatticeAuthModalProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const success = await props.onRetry();
      if (!success) {
        setError("Still not authenticated. Please run `lattice login` first.");
      }
    } catch {
      setError("Failed to check authentication status.");
    } finally {
      setChecking(false);
    }
  }, [props.onRetry]);

  // Modal cannot be dismissed without action
  const handleOpenChange = useCallback(() => {
    // Do nothing - must retry or skip
  }, []);

  return (
    <Dialog open={props.isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="size-5" />
            Lattice Authentication
          </DialogTitle>
          <DialogDescription>
            Sign in to Lattice to access remote workspaces and templates.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="bg-sidebar border-border-medium flex items-start gap-3 rounded-lg border p-3">
            <Terminal className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-1">
              <span className="text-foreground text-sm font-medium">Run in your terminal:</span>
              <code className="bg-dark text-accent rounded px-2 py-1 text-xs font-mono select-all">
                lattice login
              </code>
            </div>
          </div>

          {error && (
            <div className="bg-error-bg text-error rounded p-2 px-3 text-[13px]">{error}</div>
          )}
        </div>

        <DialogFooter className="flex gap-2 pt-0">
          <Button variant="ghost" onClick={props.onSkip} disabled={checking} className="flex-1">
            Skip
          </Button>
          <Button onClick={handleRetry} disabled={checking} className="flex-1">
            {checking ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Checking…
              </>
            ) : (
              "Retry"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
