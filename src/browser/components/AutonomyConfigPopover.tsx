import React, { useCallback, useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { cn } from "@/common/lib/utils";
import { useAPI } from "@/browser/contexts/API";
import {
  AUTONOMY_PRESETS,
  type AutonomyPresetId,
  type AutonomyOverrides,
} from "@/common/types/autonomyPresets";

interface AutonomyConfigPopoverProps {
  minionId: string;
  /** Initial overrides from minion metadata (null = inherit) */
  initialOverrides?: AutonomyOverrides | null;
}

const PRESET_COLORS: Record<AutonomyPresetId, string> = {
  inherit: "#6b7280",
  guided: "#f59e0b",
  independent: "#10b981",
  autonomous: "#8b5cf6",
};

function detectPresetId(overrides: AutonomyOverrides | null | undefined): AutonomyPresetId {
  if (!overrides) return "inherit";
  for (const preset of AUTONOMY_PRESETS) {
    if (!preset.overrides) continue;
    const o = preset.overrides;
    if (
      o.circuitBreaker?.enabled === overrides.circuitBreaker?.enabled &&
      o.phases?.enabled === overrides.phases?.enabled &&
      o.siblingContext?.enabled === overrides.siblingContext?.enabled &&
      o.challenger?.enabled === overrides.challenger?.enabled
    ) {
      return preset.id;
    }
  }
  return "inherit"; // Custom config, no exact match — default to inherit display
}

export const AutonomyConfigPopover: React.FC<AutonomyConfigPopoverProps> = (props) => {
  const { api } = useAPI();
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<AutonomyOverrides | null>(
    props.initialOverrides ?? null
  );
  const [softLimit, setSoftLimit] = useState<number>(
    overrides?.circuitBreaker?.softLimit ?? 9
  );
  const [hardLimit, setHardLimit] = useState<number>(
    overrides?.circuitBreaker?.hardLimit ?? 15
  );

  // Sync from props on metadata changes
  useEffect(() => {
    setOverrides(props.initialOverrides ?? null);
    setSoftLimit(props.initialOverrides?.circuitBreaker?.softLimit ?? 9);
    setHardLimit(props.initialOverrides?.circuitBreaker?.hardLimit ?? 15);
  }, [props.initialOverrides]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveOverrides = useCallback(
    (next: AutonomyOverrides | null) => {
      setOverrides(next);
      // Debounce save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void api?.minion.updateAutonomyOverrides({
          minionId: props.minionId,
          autonomyOverrides: next ?? undefined,
        });
      }, 400);
    },
    [api, props.minionId]
  );

  const currentPreset = detectPresetId(overrides);

  const applyPreset = useCallback(
    (presetId: AutonomyPresetId) => {
      const preset = AUTONOMY_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const next = preset.overrides ?? null;
      setSoftLimit(next?.circuitBreaker?.softLimit ?? 9);
      setHardLimit(next?.circuitBreaker?.hardLimit ?? 15);
      saveOverrides(next);
    },
    [saveOverrides]
  );

  const toggleFeature = useCallback(
    (feature: "circuitBreaker" | "phases" | "siblingContext" | "challenger") => {
      const base = overrides ?? {
        circuitBreaker: { enabled: false },
        phases: { enabled: false },
        siblingContext: { enabled: false },
        challenger: { enabled: false },
      };
      const current = base[feature]?.enabled ?? false;
      const next: AutonomyOverrides = {
        ...base,
        [feature]:
          feature === "circuitBreaker"
            ? { enabled: !current, softLimit, hardLimit }
            : { enabled: !current },
      };
      saveOverrides(next);
    },
    [overrides, saveOverrides, softLimit, hardLimit]
  );

  const updateLimits = useCallback(
    (soft: number, hard: number) => {
      setSoftLimit(soft);
      setHardLimit(hard);
      if (overrides?.circuitBreaker?.enabled) {
        saveOverrides({
          ...overrides,
          circuitBreaker: { enabled: true, softLimit: soft, hardLimit: hard },
        });
      }
    },
    [overrides, saveOverrides]
  );

  const hasAnyEnabled =
    overrides?.circuitBreaker?.enabled ??
    overrides?.phases?.enabled ??
    overrides?.siblingContext?.enabled ??
    overrides?.challenger?.enabled;

  const btnClass =
    "text-muted hover:text-foreground hover:bg-hover flex h-7 w-7 shrink-0 items-center justify-center rounded";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(btnClass, hasAnyEnabled && "text-amber-700 dark:text-amber-400")}
              data-testid="autonomy-config-button"
            >
              <Zap className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="left">
            Autonomy config{hasAnyEnabled ? " (active)" : ""}
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        side="left"
        align="start"
        className="bg-modal-bg border-separator-light w-72 overflow-visible rounded px-3 py-2.5 text-[11px] font-normal shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
      >
        <div className="flex flex-col gap-2.5">
          {/* Preset quick-select */}
          <div className="flex flex-wrap gap-1">
            {AUTONOMY_PRESETS.map((preset) => {
              const color = PRESET_COLORS[preset.id];
              const isSelected = preset.id === currentPreset;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-all",
                    isSelected
                      ? "text-foreground"
                      : "border-transparent text-muted hover:text-foreground hover:bg-hover"
                  )}
                  style={
                    isSelected
                      ? { borderColor: color, backgroundColor: `${color}15` }
                      : undefined
                  }
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: color, opacity: isSelected ? 1 : 0.4 }}
                  />
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="border-separator-light border-t" />

          {/* Circuit Breaker */}
          <FeatureToggle
            label="Circuit Breaker"
            color="amber"
            enabled={overrides?.circuitBreaker?.enabled ?? false}
            onToggle={() => toggleFeature("circuitBreaker")}
          />
          {overrides?.circuitBreaker?.enabled && (
            <div className="ml-4 flex items-center gap-2 text-[10px]">
              <label className="text-muted">
                Soft:
                <input
                  type="number"
                  min={3}
                  max={50}
                  value={softLimit}
                  onChange={(e) => updateLimits(Number(e.target.value), hardLimit)}
                  className="border-border-light bg-bg-dark text-foreground ml-1 w-10 rounded border px-1 py-0.5 text-[10px]"
                />
              </label>
              <label className="text-muted">
                Hard:
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={hardLimit}
                  onChange={(e) => updateLimits(softLimit, Number(e.target.value))}
                  className="border-border-light bg-bg-dark text-foreground ml-1 w-10 rounded border px-1 py-0.5 text-[10px]"
                />
              </label>
            </div>
          )}

          {/* Phases */}
          <FeatureToggle
            label="Phases"
            color="sky"
            enabled={overrides?.phases?.enabled ?? false}
            onToggle={() => toggleFeature("phases")}
          />

          {/* Sibling Context */}
          <FeatureToggle
            label="Sibling Context"
            color="emerald"
            enabled={overrides?.siblingContext?.enabled ?? false}
            onToggle={() => toggleFeature("siblingContext")}
          />

          {/* Challenger */}
          <FeatureToggle
            label="Challenger"
            color="violet"
            enabled={overrides?.challenger?.enabled ?? false}
            onToggle={() => toggleFeature("challenger")}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** Small labeled toggle row */
const FeatureToggle: React.FC<{
  label: string;
  color: string;
  enabled: boolean;
  onToggle: () => void;
}> = ({ label, color, enabled, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className="hover:bg-hover flex items-center gap-2 rounded px-1 py-0.5 text-left transition-colors"
  >
    <span
      className={cn(
        "flex h-3.5 w-6 items-center rounded-full transition-colors",
        enabled ? `bg-${color}-500` : "bg-zinc-700"
      )}
      style={enabled ? { backgroundColor: `var(--color-${color}-500, #f59e0b)` } : undefined}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-3" : "translate-x-0.5"
        )}
      />
    </span>
    <span className={cn("text-[11px]", enabled ? "text-foreground font-medium" : "text-muted")}>
      {label}
    </span>
  </button>
);
