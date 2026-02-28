/**
 * Dialog for logging in to a Lattice deployment.
 * Opens the deployment's /cli-auth page in the browser, then the user
 * pastes the session token back. The backend pipes the token to
 * `lattice login <url>` via stdin to complete the flow.
 */

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, CheckCircle2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/browser/components/ui/dialog";
import { Button } from "@/browser/components/ui/button";
import { Input } from "@/browser/components/ui/input";
import { useAPI } from "@/browser/contexts/API";

type LoginStep = "url" | "token" | "logging-in" | "success" | "error";

/** Extract a deployment URL from a Lattice CLI "not logged in" error message. */
export function extractDeploymentUrl(message: string): string | undefined {
  const match = /https?:\/\/[^\s'"]+/.exec(message);
  return match?.[0];
}

interface LatticeLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after successful login so the caller can refresh lattice info. */
  onLoginSuccess: () => void;
  /** Pre-populated URL hint (e.g. parsed from CLI error message). */
  defaultUrl?: string;
}

export function LatticeLoginDialog({
  open,
  onOpenChange,
  onLoginSuccess,
  defaultUrl,
}: LatticeLoginDialogProps) {
  const { api } = useAPI();

  // Form state
  const [deploymentUrl, setDeploymentUrl] = useState(defaultUrl ?? "");
  const [token, setToken] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlWarning, setUrlWarning] = useState<string | null>(null);

  // Flow state
  const [step, setStep] = useState<LoginStep>("url");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginResult, setLoginResult] = useState<{
    message?: string;
    url?: string;
  } | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setDeploymentUrl(defaultUrl ?? "");
      setToken("");
      setUrlError(null);
      setUrlWarning(null);
      setStep("url");
      setLoginError(null);
      setLoginResult(null);
    }
  }, [open, defaultUrl]);

  const validateUrl = (input: string): { valid: boolean; origin?: string } => {
    if (!input.trim()) {
      return { valid: false };
    }
    try {
      const url = new URL(input.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        setUrlError("URL must use http:// or https://");
        setUrlWarning(null);
        return { valid: false };
      }
      setUrlError(null);
      setUrlWarning(url.protocol === "http:" ? "Warning: HTTP is not secure. Use HTTPS in production." : null);
      return { valid: true, origin: url.origin };
    } catch {
      setUrlError("Please enter a valid URL (e.g. https://lattice.mycompany.com)");
      setUrlWarning(null);
      return { valid: false };
    }
  };

  const handleUrlInputChange = (value: string) => {
    setDeploymentUrl(value);
    if (value.trim()) {
      validateUrl(value);
    } else {
      setUrlError(null);
      setUrlWarning(null);
    }
  };

  const handleOpenBrowser = () => {
    const result = validateUrl(deploymentUrl);
    if (!result.valid || !result.origin) return;
    window.open(`${result.origin}/cli-auth`, "_blank", "noopener");
    setStep("token");
  };

  const handleLogin = async () => {
    if (!api || !token.trim()) return;

    setStep("logging-in");
    setLoginError(null);

    const url = deploymentUrl.trim().replace(/\/+$/, "");
    const loginResponse = await api.lattice.login({ url, sessionToken: token.trim() });

    if (loginResponse.success) {
      setLoginResult({ message: loginResponse.message, url });
      setStep("success");
      // Brief delay so user sees success state, then close
      setTimeout(() => {
        onOpenChange(false);
        onLoginSuccess();
      }, 1500);
    } else {
      setLoginError(loginResponse.message);
      setStep("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Login to Lattice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Step 1: URL input */}
          {step === "url" && (
            <>
              <p className="text-muted-foreground text-sm">
                Enter your Lattice deployment URL, then authenticate in your browser.
              </p>
              <Input
                placeholder="https://lattice.mycompany.com"
                value={deploymentUrl}
                onChange={(e) => handleUrlInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !urlError) handleOpenBrowser();
                }}
                autoFocus
              />
              {urlError && <p className="text-destructive text-sm">{urlError}</p>}
              {urlWarning && (
                <p className="text-sm text-yellow-500">{urlWarning}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleOpenBrowser}
                  disabled={!deploymentUrl.trim() || !!urlError}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Browser
                </Button>
              </div>
            </>
          )}

          {/* Step 2: Token paste */}
          {step === "token" && (
            <>
              <p className="text-muted-foreground text-sm">
                Authenticate in the browser window that opened, copy your session
                token, and paste it below.
              </p>
              <Input
                placeholder="Paste session token here"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && token.trim()) void handleLogin();
                }}
                autoFocus
                type="password"
              />
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("url")}
                >
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleLogin()}
                    disabled={!token.trim()}
                  >
                    Login
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Logging in */}
          {step === "logging-in" && (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground text-sm">
                Logging in…
              </span>
            </div>
          )}

          {/* Step 4: Success */}
          {step === "success" && (
            <div className="flex items-center gap-2 py-4 text-sm text-green-500">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {loginResult?.message || "Login completed"}
                {loginResult?.url ? ` — ${loginResult.url}` : ""}
              </span>
            </div>
          )}

          {/* Step 5: Error */}
          {step === "error" && (
            <>
              <div className="text-destructive flex items-start gap-2 text-sm">
                <X className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{loginError ?? "Login failed"}</span>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setToken("");
                    setStep("token");
                  }}
                >
                  Try Again
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
