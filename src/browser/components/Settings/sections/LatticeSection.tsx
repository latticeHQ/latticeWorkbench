import React, { useState, useEffect, useCallback } from "react";
import {
  Globe,
  RefreshCw,
  LogIn,
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  Link2,
} from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import { useAPI } from "@/browser/contexts/API";
import { LatticeAuthModal } from "../../LatticeAuthModal";
import type { LatticeWhoami } from "@/common/orpc/schemas/lattice";

type LatticeAvailabilityState = "checking" | "unavailable" | "available";

export function LatticeSection() {
  const { api } = useAPI();
  const [availability, setAvailability] = useState<LatticeAvailabilityState>("checking");
  const [unavailableReason, setUnavailableReason] = useState<string>("");
  const [whoami, setWhoami] = useState<LatticeWhoami | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const loadStatus = useCallback(
    async (refresh = false) => {
      if (!api) return;
      if (refresh) setRefreshing(true);
      else setAvailability("checking");

      try {
        const info = await api.lattice.getInfo();
        if (info.state !== "available") {
          setAvailability("unavailable");
          setUnavailableReason(
            info.state === "not_installed"
              ? "Lattice CLI is not installed."
              : info.state === "outdated"
                ? `Lattice CLI is outdated (found ${info.version ?? "unknown"}, need ≥ ${info.minimumVersion ?? "0.7.0"}).`
                : "Lattice CLI is not available."
          );
          return;
        }

        setAvailability("available");
        const wm = await api.lattice.whoami(refresh ? { refresh: true } : undefined);
        setWhoami(wm);
      } catch {
        setAvailability("unavailable");
        setUnavailableReason("Could not connect to the Lattice CLI.");
      } finally {
        setRefreshing(false);
      }
    },
    [api]
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleAuthenticated = useCallback(() => {
    setShowAuthModal(false);
    void loadStatus(true);
  }, [loadStatus]);

  const handleSkip = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  // ── Rendering ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-foreground text-sm font-semibold">Lattice Connection</h2>
        <p className="text-muted mt-0.5 text-xs">
          Manage your Lattice deployment URL and session credentials.
        </p>
      </div>

      {/* Status card */}
      <div className="border-border rounded-lg border">
        {availability === "checking" ? (
          <div className="flex items-center gap-2.5 px-4 py-4">
            <Loader2 className="text-muted h-4 w-4 animate-spin" />
            <span className="text-muted text-sm">Checking Lattice CLI…</span>
          </div>
        ) : availability === "unavailable" ? (
          <div className="px-4 py-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertCircle className="text-muted h-4 w-4 shrink-0" />
              <span className="text-foreground text-sm font-medium">Lattice not available</span>
            </div>
            <p className="text-muted text-xs">{unavailableReason}</p>
          </div>
        ) : whoami?.state === "authenticated" ? (
          <div className="divide-border divide-y">
            {/* Connected banner */}
            <div className="flex items-center gap-2.5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success)]" />
              <span className="text-[var(--color-success)] text-sm font-medium">Connected</span>
            </div>

            {/* Details */}
            <div className="space-y-3 px-4 py-3">
              <div className="flex items-start gap-3">
                <User className="text-muted mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <p className="text-muted text-[10px] uppercase tracking-wide">Account</p>
                  <p className="text-foreground text-sm">{whoami.username}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Link2 className="text-muted mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-muted text-[10px] uppercase tracking-wide">Deployment URL</p>
                  <p className="text-foreground truncate font-mono text-sm">
                    {whoami.deploymentUrl}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4">
            <div className="mb-1 flex items-center gap-2">
              <AlertCircle className="text-muted h-4 w-4 shrink-0" />
              <span className="text-foreground text-sm font-medium">Not authenticated</span>
            </div>
            <p className="text-muted text-xs">
              {whoami?.state === "unauthenticated" ? whoami.reason : "Run lattice login to connect."}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      {availability === "available" && (
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowAuthModal(true)}
            className="gap-1.5"
          >
            <LogIn className="h-3.5 w-3.5" />
            {whoami?.state === "authenticated" ? "Re-authorize" : "Connect to Lattice"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadStatus(true)}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh status
          </Button>
        </div>
      )}

      {/* Info blurb */}
      <div className="border-border bg-background-secondary rounded-md border px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <Globe className="text-muted h-3.5 w-3.5" />
          <span className="text-muted text-xs font-medium">About Lattice</span>
        </div>
        <p className="text-muted text-xs leading-relaxed">
          Lattice is the cloud infrastructure layer that provides remote workspaces, SSH tunnels,
          and team collaboration features. You can change your deployment URL by clicking
          &ldquo;Re-authorize&rdquo; and entering a new URL in step 1.
        </p>
      </div>

      {/* Re-auth modal — rendered here so it layers over settings panel */}
      {api && showAuthModal && (
        <LatticeAuthModal
          isOpen={showAuthModal}
          reason="Re-authorizing from Settings"
          api={api}
          onAuthenticated={handleAuthenticated}
          onSkip={handleSkip}
        />
      )}
    </div>
  );
}
