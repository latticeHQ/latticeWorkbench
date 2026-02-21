/**
 * InferenceSetupWizard — Guided one-click setup for the Python inference environment.
 *
 * Phase flow:
 *   idle     → Auto-checks setup status (loading spinner)
 *   ready    → Shows detected Python info, packages to install, confirm button
 *   running  → Streams pip install output with phase stepper
 *   success  → Green checkmark, "Done" button
 *   error    → Red alert, output log, "Retry" button
 */

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
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Download,
  Cpu,
  Settings,
  RefreshCw,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";

// ─── Types ────────────────────────────────────────────────────────────

type WizardPhase = "idle" | "ready" | "running" | "success" | "error";

interface SetupStatus {
  venvExists: boolean;
  venvPath: string;
  systemPythonFound: boolean;
  systemPythonPath: string | null;
  systemPythonVersion: string | null;
  pythonVersionOk: boolean;
  platform: "apple-silicon" | "other";
  requiredPackages: string[];
  depsInstalled: boolean;
  detectedBackend: string | null;
  inferenceAvailable: boolean;
  error: string | null;
}

const SETUP_PHASES = [
  { key: "detecting-python", label: "Detect Python", icon: Cpu },
  { key: "creating-venv", label: "Create Env", icon: Settings },
  { key: "installing-deps", label: "Install Packages", icon: Download },
  { key: "verifying", label: "Verify", icon: CheckCircle2 },
  { key: "restarting-engine", label: "Restart", icon: RefreshCw },
] as const;

type SetupPhaseKey = (typeof SETUP_PHASES)[number]["key"];

// ─── Component ────────────────────────────────────────────────────────

interface InferenceSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function InferenceSetupWizard({
  isOpen,
  onClose,
  onSuccess,
}: InferenceSetupWizardProps) {
  const { api } = useAPI();
  const [phase, setPhase] = useState<WizardPhase>("idle");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [currentSetupPhase, setCurrentSetupPhase] =
    useState<SetupPhaseKey | null>(null);
  const [output, setOutput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedBackend, setDetectedBackend] = useState<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll terminal output
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase("idle");
      setStatus(null);
      setCurrentSetupPhase(null);
      setOutput("");
      setErrorMessage(null);
      setDetectedBackend(null);
      void checkStatus();
    } else {
      // Abort any running setup when closing
      abortRef.current?.abort();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ─── Phase: idle → ready ──────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.inferenceSetup.checkStatus();
      setStatus(result);
      setPhase("ready");
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Failed to check setup status"
      );
      setPhase("error");
    }
  }, [api]);

  // ─── Phase: ready → running ───────────────────────────────────────

  const handleStartSetup = useCallback(async () => {
    if (!api) return;

    setPhase("running");
    setOutput("");
    setErrorMessage(null);
    setDetectedBackend(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const iter = await api.inferenceSetup.runSetup(undefined, {
        signal: ac.signal,
      });

      for await (const event of iter) {
        if (ac.signal.aborted) break;

        switch (event.type) {
          case "phase":
            setCurrentSetupPhase(event.phase as SetupPhaseKey);
            setOutput((prev) => prev + `\n── ${event.message} ──\n`);
            break;
          case "stdout":
            setOutput((prev) => prev + event.data);
            break;
          case "stderr":
            setOutput((prev) => prev + event.data);
            break;
          case "result":
            if (event.success) {
              setDetectedBackend(event.backend ?? null);
              setPhase("success");
            } else {
              setErrorMessage(event.message);
              setPhase("error");
            }
            break;
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setErrorMessage(
          e instanceof Error ? e.message : "Setup stream failed"
        );
        setPhase("error");
      }
    }
  }, [api]);

  // ─── Phase: error → ready (retry) ────────────────────────────────

  const handleRetry = useCallback(() => {
    setOutput("");
    setErrorMessage(null);
    setCurrentSetupPhase(null);
    setPhase("ready");
    void checkStatus();
  }, [checkStatus]);

  // ─── Phase: success → close ───────────────────────────────────────

  const handleDone = useCallback(() => {
    onSuccess();
    onClose();
  }, [onSuccess, onClose]);

  // ─── Restart engine only (when deps already installed) ────────────

  const handleRestartOnly = useCallback(async () => {
    if (!api) return;
    setPhase("running");
    setOutput("");
    setCurrentSetupPhase("restarting-engine");

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const iter = await api.inferenceSetup.runSetup(undefined, {
        signal: ac.signal,
      });
      for await (const event of iter) {
        if (ac.signal.aborted) break;
        switch (event.type) {
          case "phase":
            setCurrentSetupPhase(event.phase as SetupPhaseKey);
            setOutput((prev) => prev + `\n── ${event.message} ──\n`);
            break;
          case "stdout":
          case "stderr":
            setOutput((prev) => prev + event.data);
            break;
          case "result":
            if (event.success) {
              setDetectedBackend(event.backend ?? null);
              setPhase("success");
            } else {
              setErrorMessage(event.message);
              setPhase("error");
            }
            break;
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setErrorMessage(
          e instanceof Error ? e.message : "Setup stream failed"
        );
        setPhase("error");
      }
    }
  }, [api]);

  // ─── Description text ─────────────────────────────────────────────

  const descriptionText = (() => {
    switch (phase) {
      case "idle":
        return "Checking your system...";
      case "ready":
        return "Review your setup and click to install.";
      case "running":
        return "Setting up the inference environment...";
      case "success":
        return "Inference engine is ready!";
      case "error":
        return "Setup encountered an issue.";
    }
  })();

  // Don't allow closing during running phase
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && phase !== "running") {
        onClose();
      }
    },
    [phase, onClose]
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={phase !== "running"}
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-5" />
            Inference Setup
          </DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Phase: idle — loading */}
          {phase === "idle" && (
            <div className="flex items-center justify-center gap-3 py-8">
              <Loader2 className="text-accent size-5 animate-spin" />
              <span className="text-muted text-sm">
                Checking system requirements...
              </span>
            </div>
          )}

          {/* Phase: ready — show status + confirm */}
          {phase === "ready" && status && (
            <div className="flex flex-col gap-3">
              {/* System info card */}
              <div className="bg-sidebar border-border-medium rounded-lg border p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-xs font-medium uppercase tracking-wider">
                      Python
                    </span>
                    {status.systemPythonFound && status.pythonVersionOk ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle2 className="size-3" />
                        {status.systemPythonVersion}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle className="size-3" />
                        {status.systemPythonFound
                          ? `${status.systemPythonVersion} (need 3.10+)`
                          : "Not found"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted text-xs font-medium uppercase tracking-wider">
                      Platform
                    </span>
                    <span className="text-foreground text-xs">
                      {status.platform === "apple-silicon"
                        ? "Apple Silicon (MLX)"
                        : "CPU/NVIDIA (llama.cpp)"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted text-xs font-medium uppercase tracking-wider">
                      Packages
                    </span>
                    <span className="text-foreground font-mono text-xs">
                      {status.requiredPackages.join(", ")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted text-xs font-medium uppercase tracking-wider">
                      Venv
                    </span>
                    <span className="text-foreground truncate text-xs max-w-[250px]" title={status.venvPath}>
                      {status.venvExists ? "Exists" : "Will create"}
                    </span>
                  </div>

                  {status.depsInstalled && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted text-xs font-medium uppercase tracking-wider">
                        Status
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle2 className="size-3" />
                        Dependencies installed ({status.detectedBackend})
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Error: Python not found or too old */}
              {status.error && (
                <div className="bg-error-bg border-error flex items-start gap-3 rounded-lg border p-4">
                  <AlertCircle className="text-error mt-0.5 size-4 shrink-0" />
                  <span className="text-foreground whitespace-pre-wrap text-xs">
                    {status.error}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Phase: running — phase stepper + terminal output */}
          {phase === "running" && (
            <div className="flex flex-col gap-3">
              {/* Phase stepper */}
              <div className="flex items-center justify-between px-1">
                {SETUP_PHASES.map((p, i) => {
                  const phaseIndex = SETUP_PHASES.findIndex(
                    (sp) => sp.key === currentSetupPhase
                  );
                  const isCompleted = i < phaseIndex;
                  const isActive = p.key === currentSetupPhase;
                  const Icon = p.icon;

                  return (
                    <div
                      key={p.key}
                      className="flex flex-col items-center gap-1"
                    >
                      <div
                        className={`flex size-6 items-center justify-center rounded-full transition-colors ${
                          isCompleted
                            ? "bg-green-500/20 text-green-500"
                            : isActive
                              ? "bg-accent/20 text-accent"
                              : "bg-sidebar text-muted"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : isActive ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Icon className="size-3" />
                        )}
                      </div>
                      <span
                        className={`text-[9px] ${
                          isActive
                            ? "text-accent font-medium"
                            : "text-muted"
                        }`}
                      >
                        {p.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Terminal output */}
              <div className="bg-background border-border-medium overflow-hidden rounded-lg border">
                <pre className="text-muted max-h-[250px] overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {output || "Starting setup..."}
                  <div ref={outputEndRef} />
                </pre>
              </div>
            </div>
          )}

          {/* Phase: success */}
          {phase === "success" && (
            <div className="flex flex-col gap-3">
              <div className="bg-success-bg border-success flex items-center gap-3 rounded-lg border p-4">
                <CheckCircle2 className="text-success size-5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground text-sm font-medium">
                    Inference engine is ready!
                  </span>
                  {detectedBackend && (
                    <span className="text-muted text-xs">
                      Backend: {detectedBackend === "mlx" ? "MLX (Apple Silicon)" : "llama.cpp"}
                    </span>
                  )}
                </div>
              </div>

              {/* Show terminal output on success too */}
              {output && (
                <div className="bg-background border-border-medium overflow-hidden rounded-lg border">
                  <pre className="text-muted max-h-[150px] overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {output}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Phase: error */}
          {phase === "error" && (
            <div className="flex flex-col gap-3">
              <div className="bg-error-bg border-error flex items-start gap-3 rounded-lg border p-4">
                <AlertCircle className="text-error mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-1">
                  <span className="text-foreground text-sm font-medium">
                    Setup failed
                  </span>
                  {errorMessage && (
                    <span className="text-muted whitespace-pre-wrap text-xs">
                      {errorMessage}
                    </span>
                  )}
                </div>
              </div>

              {/* Show terminal output for debugging */}
              {output && (
                <div className="bg-background border-border-medium overflow-hidden rounded-lg border">
                  <pre className="text-muted max-h-[200px] overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {output}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 pt-0">
          {/* Close/Cancel — available except during running */}
          {phase !== "running" && phase !== "success" && (
            <Button variant="ghost" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          )}

          {/* Ready: Install or Restart button */}
          {phase === "ready" && status && (
            <>
              {status.depsInstalled && !status.inferenceAvailable ? (
                <Button onClick={handleRestartOnly} className="flex-1">
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Restart Engine
                </Button>
              ) : !status.depsInstalled &&
                status.pythonVersionOk ? (
                <Button onClick={handleStartSetup} className="flex-1">
                  <Download className="mr-1.5 size-3.5" />
                  Set Up Inference
                </Button>
              ) : null}
            </>
          )}

          {/* Running: show spinner */}
          {phase === "running" && (
            <Button disabled className="flex-1">
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              Installing...
            </Button>
          )}

          {/* Success: Done button */}
          {phase === "success" && (
            <Button onClick={handleDone} className="flex-1">
              Done
            </Button>
          )}

          {/* Error: Retry button */}
          {phase === "error" && (
            <Button onClick={handleRetry} className="flex-1">
              <RefreshCw className="mr-1.5 size-3.5" />
              Retry
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
