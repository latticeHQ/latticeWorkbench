import {
  collectToolConfigsFromResolvedChain,
  isPlanLikeInResolvedChain,
  type ToolsConfig,
} from "@/common/utils/agentTools";
import type { ToolPolicy } from "@/common/utils/tools/toolPolicy";

/**
 * Minimal agent structure needed for tool policy resolution.
 * Compatible with AgentForInheritance from resolveAgentInheritanceChain.
 */
export interface AgentLikeForPolicy {
  tools?: ToolsConfig;
}

export interface ResolveToolPolicyOptions {
  /**
   * Pre-resolved inheritance chain from resolveAgentInheritanceChain.
   * Ordered child → base (selected agent first, then its base, etc.).
   */
  agents: readonly AgentLikeForPolicy[];
  isSidekick: boolean;
  disableTaskToolsForDepth: boolean;
  enableAgentSwitchTool: boolean;
  /**
   * Force switch_agent as the only required tool for this turn.
   * Used by Auto so routing always happens before prose output.
   */
  requireSwitchAgentTool?: boolean;
}

// Runtime restrictions that cannot be overridden by agent definitions.
// Ask-for-input and agent-switch tools are never allowed in autonomous sidekick flows.
const SIDEKICK_HARD_DENY: ToolPolicy = [
  { regex_match: "ask_user_question", action: "disable" },
  { regex_match: "switch_agent", action: "disable" },
];

const DEPTH_HARD_DENY: ToolPolicy = [
  { regex_match: "task", action: "disable" },
  { regex_match: "task_.*", action: "disable" },
];

/**
 * Resolves tool policy for an agent, including inherited tools from base agents.
 *
 * The policy is built from:
 * 1. Inheritance chain processed base → child:
 *    - Each layer's `tools.add` patterns (enable)
 *    - Each layer's `tools.remove` patterns (disable)
 * 2. Runtime restrictions (sidekick limits, depth limits) applied last
 *
 * Example: ask (base: exec)
 * - exec has add: [.*], remove: [propose_plan, ask_user_question]
 * - ask has remove: [file_edit_.*]
 * - Result: deny-all → enable .* → disable propose_plan → disable ask_user_question → disable file_edit_.*
 *
 * Sidekick completion tool is mode-dependent:
 * - plan-like sidekicks: enable `propose_plan`, disable `agent_report`
 * - non-plan sidekicks: disable `propose_plan`, enable `agent_report`
 */
export function resolveToolPolicyForAgent(options: ResolveToolPolicyOptions): ToolPolicy {
  const {
    agents,
    isSidekick,
    disableTaskToolsForDepth,
    enableAgentSwitchTool,
    requireSwitchAgentTool = false,
  } = options;

  // Defensive normalization: requiring switch_agent is only valid when the tool can be enabled.
  // Invalid combinations (e.g. stale sidekick metadata pointing at Auto) degrade safely
  // to the default disabled policy instead of throwing and bricking the minion.
  const shouldRequireSwitchAgentTool =
    requireSwitchAgentTool && enableAgentSwitchTool && !isSidekick;

  // Start with deny-all baseline
  const agentPolicy: ToolPolicy = [{ regex_match: ".*", action: "disable" }];

  // Process inheritance chain: base → child
  const configs = collectToolConfigsFromResolvedChain(agents);
  for (const config of configs) {
    // Enable tools from add list (treated as regex patterns)
    if (config.add) {
      for (const pattern of config.add) {
        const trimmed = pattern.trim();
        if (trimmed.length > 0) {
          agentPolicy.push({ regex_match: trimmed, action: "enable" });
        }
      }
    }

    // Disable tools from remove list
    if (config.remove) {
      for (const pattern of config.remove) {
        const trimmed = pattern.trim();
        if (trimmed.length > 0) {
          agentPolicy.push({ regex_match: trimmed, action: "disable" });
        }
      }
    }
  }

  // Runtime restrictions (applied last, cannot be overridden)
  const runtimePolicy: ToolPolicy = [];

  if (disableTaskToolsForDepth) {
    runtimePolicy.push(...DEPTH_HARD_DENY);
  }

  // switch_agent is disabled by default and only enabled for Auto-started sessions.
  // This must come before sidekick hard-deny so sidekicks always resolve to disabled.
  runtimePolicy.push({ regex_match: "switch_agent", action: "disable" });
  if (enableAgentSwitchTool && !isSidekick) {
    runtimePolicy.push({ regex_match: "switch_agent", action: "enable" });

    // Auto is a strict router: force a switch_agent tool call before producing prose.
    if (shouldRequireSwitchAgentTool) {
      runtimePolicy.push({ regex_match: "switch_agent", action: "require" });
    }
  }

  if (isSidekick) {
    runtimePolicy.push(...SIDEKICK_HARD_DENY);

    const isPlanLikeSidekick = isPlanLikeInResolvedChain(agents);
    if (isPlanLikeSidekick) {
      // Plan-mode sidekicks must finish by proposing a plan, not by reporting.
      runtimePolicy.push({ regex_match: "propose_plan", action: "enable" });
      runtimePolicy.push({ regex_match: "agent_report", action: "disable" });
    } else {
      // Non-plan sidekicks should complete through agent_report.
      runtimePolicy.push({ regex_match: "propose_plan", action: "disable" });
      runtimePolicy.push({ regex_match: "agent_report", action: "enable" });
    }
  }

  return [...agentPolicy, ...runtimePolicy];
}
