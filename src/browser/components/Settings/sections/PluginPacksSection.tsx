import React, { useCallback, useState } from "react";
import { Switch } from "@/browser/components/ui/switch";
import { usePluginPacks } from "@/browser/hooks/usePluginPacks";
import type { PluginPackDescriptor } from "@/common/types/pluginPack";

function PluginPackRow({
  pack,
  onToggle,
}: {
  pack: PluginPackDescriptor;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = useCallback(
    (value: boolean) => {
      onToggle(pack.name, value);
    },
    [onToggle, pack.name]
  );

  return (
    <div className="border-border border-b last:border-b-0">
      <div className="flex items-center justify-between py-3">
        <div className="flex-1 pr-4">
          <button type="button" className="text-left" onClick={() => setExpanded(!expanded)}>
            <div className="text-foreground text-sm font-medium">
              {pack.name}
              <span className="text-muted ml-2 text-xs font-normal">v{pack.version}</span>
            </div>
            <div className="text-muted mt-0.5 text-xs">{pack.description}</div>
          </button>
        </div>
        <Switch
          checked={pack.enabled}
          onCheckedChange={handleToggle}
          aria-label={`Toggle ${pack.name}`}
        />
      </div>
      {expanded && (
        <div className="text-muted mb-3 ml-2 space-y-1 text-xs">
          <div>Author: {pack.author}</div>
          <div>
            Skills: {pack.skillCount} ({pack.commandCount} commands,{" "}
            {pack.skillCount - pack.commandCount} knowledge skills)
          </div>
          {pack.mcpServerCount > 0 && <div>Suggested MCP servers: {pack.mcpServerCount}</div>}
        </div>
      )}
    </div>
  );
}

export function PluginPacksSection() {
  const { packs, loading, setEnabled } = usePluginPacks();

  const handleToggle = useCallback(
    (name: string, enabled: boolean) => {
      void setEnabled(name, enabled);
    },
    [setEnabled]
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-foreground text-lg font-semibold">Plugin Packs</h2>
          <p className="text-muted mt-1 text-sm">Loading plugin packs...</p>
        </div>
      </div>
    );
  }

  const enabledCount = packs.filter((p) => p.enabled).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">Plugin Packs</h2>
        <p className="text-muted mt-1 text-sm">
          Enable domain-specific skill packs to extend your workspace with specialized knowledge and
          commands.{" "}
          {enabledCount > 0
            ? `${enabledCount} of ${packs.length} enabled.`
            : `${packs.length} available.`}
        </p>
      </div>

      <div className="border-border divide-border rounded-md border">
        {packs.map((pack) => (
          <PluginPackRow key={pack.name} pack={pack} onToggle={handleToggle} />
        ))}
      </div>

      <p className="text-muted text-xs">
        Click a plugin name to see details. Enabled plugins add domain-specific skills to the agent
        context in new conversations.
      </p>
    </div>
  );
}
