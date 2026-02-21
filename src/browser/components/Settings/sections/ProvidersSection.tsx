import React, { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, Bot, Radio } from "lucide-react";
import { AgentsSection } from "./AgentsSection";
import { TasksSection } from "./TasksSection";
import { LiveKitSection } from "./LiveKitSection";

type SubSection = "cli-tools" | "ai-agents" | "livekit";

/**
 * Combined Providers section — merges CLI tool detection/install
 * with AI agent configuration into a single settings pane.
 */
export function ProvidersSection() {
  const [collapsed, setCollapsed] = useState<Record<SubSection, boolean>>({
    "cli-tools": false,
    "ai-agents": false,
    livekit: false,
  });

  const toggle = (section: SubSection) =>
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));

  return (
    <div className="space-y-6">
      {/* CLI Tools sub-section */}
      <div>
        <button
          type="button"
          onClick={() => toggle("cli-tools")}
          className="flex w-full items-center gap-2 pb-2 text-left"
        >
          {collapsed["cli-tools"] ? (
            <ChevronRight className="text-muted h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="text-muted h-3.5 w-3.5" />
          )}
          <Terminal className="text-muted h-3.5 w-3.5" />
          <span className="text-foreground text-xs font-semibold tracking-wide uppercase">
            Employees
          </span>
        </button>
        {!collapsed["cli-tools"] && <AgentsSection />}
      </div>

      {/* Divider */}
      <div className="border-border-medium border-t" />

      {/* AI Agents sub-section */}
      <div>
        <button
          type="button"
          onClick={() => toggle("ai-agents")}
          className="flex w-full items-center gap-2 pb-2 text-left"
        >
          {collapsed["ai-agents"] ? (
            <ChevronRight className="text-muted h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="text-muted h-3.5 w-3.5" />
          )}
          <Bot className="text-muted h-3.5 w-3.5" />
          <span className="text-foreground text-xs font-semibold tracking-wide uppercase">
            AI Team
          </span>
        </button>
        {!collapsed["ai-agents"] && <TasksSection />}
      </div>

      {/* Divider */}
      <div className="border-border-medium border-t" />

      {/* LiveKit sub-section */}
      <div>
        <button
          type="button"
          onClick={() => toggle("livekit")}
          className="flex w-full items-center gap-2 pb-2 text-left"
        >
          {collapsed["livekit"] ? (
            <ChevronRight className="text-muted h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="text-muted h-3.5 w-3.5" />
          )}
          <Radio className="text-muted h-3.5 w-3.5" />
          <span className="text-foreground text-xs font-semibold tracking-wide uppercase">
            LiveKit
          </span>
          <span className="text-muted ml-auto text-[10px]">Voice &amp; Video</span>
        </button>
        {!collapsed["livekit"] && <LiveKitSection />}
      </div>
    </div>
  );
}
