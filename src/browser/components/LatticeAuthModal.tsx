import { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/browser/components/ui/dialog";
import { Button } from "@/browser/components/ui/button";
import { Input } from "@/browser/components/ui/input";
import {
  Loader2,
  LogIn,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Globe,
  KeyRound,
} from "lucide-react";
import type { APIClient } from "@/browser/contexts/API";

/**
 * LatticeAuthModal — Two-phase authentication flow:
 *
 * Phase 1 (url-input):
 *   User enters their Lattice deployment URL (e.g., https://orbitalclusters.com).
 *
 * Phase 2 (token-input):
 *   User logs in at the deployment URL in their browser, copies the session token,
 *   and pastes it here.
 *
 * Phase 3 (authenticating):
 *   We pipe the session token to `lattice login <url>` via the backend API.
 *
 * Phase 4 (success / error):
 *   Show result and either dismiss or allow retry.
 */

type ModalPhase = "url-input" | "token-input" | "authenticating" | "success" | "error";

interface LatticeAuthModalProps {
  isOpen: boolean;
  reason: string;
  api: APIClient;
  onAuthenticated: () => void;
  onSkip: () => void;
}

export function LatticeAuthModal({
  isOpen,
  reason,
  api,
  onAuthenticated,
  onSkip,
}: LatticeAuthModalProps) {
  const [phase, setPhase] = useState<ModalPhase>("url-input");
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auto-focus URL input when modal opens
  useEffect(() => {
    if (isOpen && phase === "url-input") {
      setTimeout(() => urlInputRef.current?.focus(), 100);
    }
  }, [isOpen, phase]);

  // Auto-focus token input when entering token phase
  useEffect(() => {
    if (phase === "token-input") {
      setTimeout(() => tokenInputRef.current?.focus(), 100);
    }
  }, [phase]);

  // Phase 1 → Phase 2: User entered URL, move to token input
  const handleUrlSubmit = useCallback(() => {
    const trimmed = deploymentUrl.trim();
    if (!trimmed) return;

    // Normalize: ensure https:// prefix
    let normalizedUrl = trimmed;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    // Remove trailing slash
    normalizedUrl = normalizedUrl.replace(/\/+$/, "");

    setDeploymentUrl(normalizedUrl);
    setPhase("token-input");
  }, [deploymentUrl]);

  // Phase 2 → Phase 3: User pasted token, authenticate
  const handleAuthenticate = useCallback(async () => {
    const trimmedToken = sessionToken.trim();
    if (!trimmedToken) return;

    setPhase("authenticating");
    setErrorMessage(null);

    try {
      const result = await api.lattice.login({
        url: deploymentUrl,
        sessionToken: trimmedToken,
      });

      if (!mountedRef.current) return;

      if (result.success) {
        // Verify with whoami
        try {
          const whoami = await api.lattice.whoami({ refresh: true });
          if (whoami.state === "authenticated") {
            setPhase("success");
            setTimeout(() => {
              if (mountedRef.current) onAuthenticated();
            }, 800);
            return;
          }
        } catch {
          // Whoami check failed, but login succeeded — proceed anyway
        }
        setPhase("success");
        setTimeout(() => {
          if (mountedRef.current) onAuthenticated();
        }, 800);
      } else {
        setPhase("error");
        setErrorMessage(result.message);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setPhase("error");
      setErrorMessage(e instanceof Error ? e.message : "Authentication failed");
    }
  }, [api, deploymentUrl, sessionToken, onAuthenticated]);

  // Retry: go back to token input (keep URL)
  const handleRetry = useCallback(() => {
    setSessionToken("");
    setErrorMessage(null);
    setPhase("token-input");
  }, []);

  // Start over: go back to URL input
  const handleStartOver = useCallback(() => {
    setDeploymentUrl("");
    setSessionToken("");
    setErrorMessage(null);
    setPhase("url-input");
  }, []);

  // Allow dismissal by clicking outside (treats it as "Skip") so the settings X button
  // is never permanently blocked by this dialog's backdrop overlay.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onSkip();
    },
    [onSkip]
  );

  const descriptionText = (() => {
    switch (phase) {
      case "url-input":
        return "Enter your Lattice deployment URL to get started.";
      case "token-input":
        return "Log in at your deployment URL, then paste the session token here.";
      case "authenticating":
        return "Authenticating with Lattice...";
      case "success":
        return "Successfully authenticated!";
      case "error":
        return "Authentication failed. You can retry or start over.";
    }
  })();

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-md" zIndex={2100}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="size-5" />
            Lattice Authentication
          </DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Phase 1: URL input */}
          {phase === "url-input" && (
            <div className="flex flex-col gap-3">
              {reason && (
                <div className="bg-sidebar border-border-medium rounded-lg border p-3">
                  <span className="text-muted text-xs">{reason}</span>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="lattice-url"
                  className="text-foreground flex items-center gap-1.5 text-sm font-medium"
                >
                  <Globe className="size-3.5" />
                  Deployment URL
                </label>
                <Input
                  ref={urlInputRef}
                  id="lattice-url"
                  type="url"
                  placeholder="https://orbitalclusters.com"
                  value={deploymentUrl}
                  onChange={(e) => setDeploymentUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUrlSubmit();
                  }}
                  autoComplete="url"
                />
              </div>
            </div>
          )}

          {/* Phase 2: Token input */}
          {phase === "token-input" && (
            <div className="flex flex-col gap-3">
              <div className="bg-sidebar border-border-medium flex items-start gap-3 rounded-lg border p-4">
                <ExternalLink className="text-accent mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span className="text-foreground text-sm font-medium">
                    Sign in at your deployment
                  </span>
                  <span className="text-muted text-xs">
                    1. Open{" "}
                    <a
                      href={deploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {deploymentUrl}
                    </a>{" "}
                    in your browser
                  </span>
                  <span className="text-muted text-xs">
                    2. Log in with your credentials
                  </span>
                  <span className="text-muted text-xs">
                    3. Copy the session token shown after login
                  </span>
                  <span className="text-muted text-xs">
                    4. Paste it below
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="lattice-token"
                  className="text-foreground flex items-center gap-1.5 text-sm font-medium"
                >
                  <KeyRound className="size-3.5" />
                  Session Token
                </label>
                <Input
                  ref={tokenInputRef}
                  id="lattice-token"
                  type="password"
                  placeholder="Paste your session token here"
                  value={sessionToken}
                  onChange={(e) => setSessionToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAuthenticate();
                  }}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {/* Phase 3: Authenticating */}
          {phase === "authenticating" && (
            <div className="bg-sidebar border-border-medium flex items-center gap-3 rounded-lg border p-4">
              <Loader2 className="text-accent size-5 shrink-0 animate-spin" />
              <div className="flex flex-col gap-0.5">
                <span className="text-foreground text-sm font-medium">
                  Authenticating with Lattice...
                </span>
                <span className="text-muted text-xs">
                  Connecting to {deploymentUrl}
                </span>
              </div>
            </div>
          )}

          {/* Phase 4a: Success */}
          {phase === "success" && (
            <div className="bg-success-bg border-success flex items-center gap-3 rounded-lg border p-4">
              <CheckCircle2 className="text-success size-5 shrink-0" />
              <span className="text-foreground text-sm font-medium">
                Authenticated! Loading workspace...
              </span>
            </div>
          )}

          {/* Phase 4b: Error */}
          {phase === "error" && (
            <div className="flex flex-col gap-3">
              <div className="bg-error-bg border-error flex items-start gap-3 rounded-lg border p-4">
                <AlertCircle className="text-error mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span className="text-foreground text-sm font-medium">
                    Authentication failed
                  </span>
                  {errorMessage && (
                    <span className="text-muted text-xs">{errorMessage}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 pt-0">
          {/* Skip — always available except during success */}
          <Button
            variant="ghost"
            onClick={onSkip}
            disabled={phase === "success" || phase === "authenticating"}
            className="flex-1"
          >
            Skip
          </Button>

          {/* URL input: Continue button */}
          {phase === "url-input" && (
            <Button
              onClick={handleUrlSubmit}
              disabled={!deploymentUrl.trim()}
              className="flex-1"
            >
              Continue
            </Button>
          )}

          {/* Token input: Authenticate button */}
          {phase === "token-input" && (
            <Button
              onClick={() => void handleAuthenticate()}
              disabled={!sessionToken.trim()}
              className="flex-1"
            >
              Authenticate
            </Button>
          )}

          {/* Error: Retry + Start Over buttons */}
          {phase === "error" && (
            <>
              <Button variant="outline" onClick={handleStartOver} className="flex-1">
                Start Over
              </Button>
              <Button onClick={handleRetry} className="flex-1">
                Retry
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
