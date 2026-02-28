import { describe, expect, test } from "bun:test";

import type { AgentLikeForPolicy } from "./resolveToolPolicy";
import { resolveToolPolicyForAgent } from "./resolveToolPolicy";

// Test helper: agents array is ordered child → base (as returned by resolveAgentInheritanceChain)
describe("resolveToolPolicyForAgent", () => {
  test("no tools means all tools disabled", () => {
    const agents: AgentLikeForPolicy[] = [{}];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("switch_agent is disabled by default when auto switch is off", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("tools.add enables specified patterns", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["file_read", "bash.*"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "bash.*", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("agents can include propose_plan in tools", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["propose_plan", "file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "propose_plan", action: "enable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("enableAgentSwitchTool enables switch_agent for top-level minions", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: true,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "switch_agent", action: "enable" },
    ]);
  });

  test("requireSwitchAgentTool forces switch_agent for strict auto routing", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: true,
      requireSwitchAgentTool: true,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "switch_agent", action: "enable" },
      { regex_match: "switch_agent", action: "require" },
    ]);
  });

  test("requireSwitchAgentTool degrades safely for invalid runtime combinations", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["file_read"] } }];

    const withoutSwitchEnablement = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
      requireSwitchAgentTool: true,
    });
    expect(withoutSwitchEnablement).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);

    const sidekickPolicy = resolveToolPolicyForAgent({
      agents,
      isSidekick: true,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: true,
      requireSwitchAgentTool: true,
    });
    expect(sidekickPolicy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "ask_user_question", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "propose_plan", action: "disable" },
      { regex_match: "agent_report", action: "enable" },
    ]);
  });

  test("sidekicks still hard-deny switch_agent even when auto switch is enabled", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: true,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: true,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "ask_user_question", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "propose_plan", action: "disable" },
      { regex_match: "agent_report", action: "enable" },
    ]);
  });

  test("non-plan sidekicks disable propose_plan and allow agent_report", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["task", "file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: true,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "task", action: "enable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "ask_user_question", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "propose_plan", action: "disable" },
      { regex_match: "agent_report", action: "enable" },
    ]);
  });

  test("plan-like sidekicks enable propose_plan and disable agent_report", () => {
    const agents: AgentLikeForPolicy[] = [
      { tools: { add: ["propose_plan", "file_read", "agent_report"] } },
    ];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: true,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "propose_plan", action: "enable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "agent_report", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "ask_user_question", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "propose_plan", action: "enable" },
      { regex_match: "agent_report", action: "disable" },
    ]);
  });

  test("depth limit hard-denies task tools", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["task", "file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: true,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "task", action: "enable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "task", action: "disable" },
      { regex_match: "task_.*", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("depth limit hard-denies task tools for sidekicks", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["task", "file_read"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: true,
      disableTaskToolsForDepth: true,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "task", action: "enable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "task", action: "disable" },
      { regex_match: "task_.*", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "ask_user_question", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
      { regex_match: "propose_plan", action: "disable" },
      { regex_match: "agent_report", action: "enable" },
    ]);
  });

  test("empty tools.add array means no tools", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: [] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("whitespace in tool patterns is trimmed", () => {
    const agents: AgentLikeForPolicy[] = [{ tools: { add: ["  file_read  ", "  ", "bash"] } }];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "bash", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("tools.remove disables specified patterns", () => {
    const agents: AgentLikeForPolicy[] = [
      { tools: { add: ["file_read", "bash", "task"], remove: ["task"] } },
    ];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "bash", action: "enable" },
      { regex_match: "task", action: "enable" },
      { regex_match: "task", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("inherits tools from base agent", () => {
    // Chain: ask → exec (ordered child → base as returned by resolveAgentInheritanceChain)
    const agents: AgentLikeForPolicy[] = [
      { tools: { remove: ["file_edit_.*"] } }, // ask (child)
      { tools: { add: [".*"], remove: ["propose_plan"] } }, // exec (base)
    ];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    // exec: deny-all → enable .* → disable propose_plan
    // ask: → disable file_edit_.*
    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: ".*", action: "enable" },
      { regex_match: "propose_plan", action: "disable" },
      { regex_match: "file_edit_.*", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("multi-level inheritance", () => {
    // Chain: leaf → middle → base (ordered child → base)
    const agents: AgentLikeForPolicy[] = [
      { tools: { remove: ["task"] } }, // leaf (child)
      { tools: { add: ["task"], remove: ["bash"] } }, // middle
      { tools: { add: ["file_read", "bash"] } }, // base
    ];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    // base: deny-all → enable file_read → enable bash
    // middle: → enable task → disable bash
    // leaf: → disable task
    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "bash", action: "enable" },
      { regex_match: "task", action: "enable" },
      { regex_match: "bash", action: "disable" },
      { regex_match: "task", action: "disable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });

  test("child can add tools not in base", () => {
    // Chain: child → base (ordered child → base)
    const agents: AgentLikeForPolicy[] = [
      { tools: { add: ["bash"] } }, // child
      { tools: { add: ["file_read"] } }, // base
    ];
    const policy = resolveToolPolicyForAgent({
      agents,
      isSidekick: false,
      disableTaskToolsForDepth: false,
      enableAgentSwitchTool: false,
    });

    expect(policy).toEqual([
      { regex_match: ".*", action: "disable" },
      { regex_match: "file_read", action: "enable" },
      { regex_match: "bash", action: "enable" },
      { regex_match: "switch_agent", action: "disable" },
    ]);
  });
});
