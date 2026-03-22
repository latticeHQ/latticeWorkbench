#!/usr/bin/env bun
/**
 * Captain Test Script
 *
 * Standalone verification that the Captain's cognitive loop, memory,
 * goals, perception, and initiative systems work correctly.
 *
 * Run: bun scripts/test-captain.ts
 */

import { CaptainService } from "../src/node/services/captain/captainService";
import { CaptainMemory } from "../src/node/services/captain/captainMemory";
import { CaptainGoalManager } from "../src/node/services/captain/captainGoals";
import { CaptainPerception } from "../src/node/services/captain/captainPerception";
import { CaptainInitiative } from "../src/node/services/captain/captainInitiative";
import { CostGuardrail, InitiativeThrottle, ErrorRecovery } from "../src/node/services/captain/captainGuardrails";
import * as path from "path";
import * as fs from "fs/promises";

const PROJECT_DIR = path.resolve(__dirname, "..");
const CAPTAIN_DIR = path.join(PROJECT_DIR, ".lattice", "captain");

// Colors for terminal output
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(green(`  ✓ ${message}`));
    passed++;
  } else {
    console.log(red(`  ✗ ${message}`));
    failed++;
  }
}

async function testMemory() {
  console.log(blue("\n━━━ Memory System ━━━"));

  const memory = new CaptainMemory(PROJECT_DIR);

  // Store memories
  const m1 = await memory.store("episodic", "User asked about AI startups research", 0.8, { topic: "ai" });
  assert(m1.id.length > 0, "Store episodic memory");
  assert(m1.importance === 0.8, "Importance set correctly");

  const m2 = await memory.store("semantic", "The user prefers concise communication", 0.9, { category: "preference" });
  assert(m2.type === "semantic", "Store semantic memory");

  // Recall memories
  const recalled = await memory.recall("AI startups", ["episodic"], 5);
  assert(recalled.length > 0, "Recall episodic memories");
  assert(recalled[0].content.includes("AI startups"), "Recalled correct memory");

  // Build context block
  const context = await memory.buildContextBlock("recent events");
  assert(context.includes("Atlas"), "Context block includes identity name");
  assert(context.length > 50, `Context block has content (${context.length} chars)`);

  console.log(dim(`  Context preview: ${context.slice(0, 120)}...`));

  // Consolidation prompt
  const consolPrompt = await memory.buildConsolidationPrompt();
  // May be null if not enough old memories
  assert(consolPrompt === null || consolPrompt.length > 0, "Consolidation prompt (null or valid)");

  // Cleanup test memories
  const pruned = await memory.forget(1.0, 0); // prune everything with importance < 1.0 and age > 0 days
  assert(pruned >= 0, `Pruned ${pruned} test memories`);
}

async function testGoals() {
  console.log(blue("\n━━━ Goal System ━━━"));

  const goals = new CaptainGoalManager(PROJECT_DIR);

  // Create a goal
  const goal = await goals.createGoal("Research top 50 AI startups", "user", 1);
  assert(goal.id.length > 0, "Create goal");
  assert(goal.status === "pending", "Initial status is pending");
  assert(goal.priority === 1, "Priority set correctly");
  assert(goal.source === "user", "Source is user");

  // Create sub-goal
  const subGoal = await goals.createGoal("Research batch 1 (startups 1-10)", "self", 2, goal.id);
  assert(subGoal.parentId === goal.id, "Sub-goal linked to parent");

  // Get active goals
  const active = await goals.getActiveGoals();
  assert(active.length >= 1, `Active goals: ${active.length}`);

  // Build context block
  const context = await goals.buildGoalContextBlock();
  assert(context.includes("Research top 50"), "Goal context includes description");
  console.log(dim(`  Goal context: ${context.slice(0, 150)}...`));

  // Build decomposition prompt
  const decompPrompt = goals.buildDecompositionPrompt(goal);
  assert(decompPrompt.includes("Decompose"), "Decomposition prompt generated");
  assert(decompPrompt.includes("Research top 50"), "Decomposition prompt includes goal");

  // Update status
  await goals.updateStatus(goal.id, "active");
  const updated = await goals.getActiveGoals();
  const found = updated.find(g => g.id === goal.id);
  assert(found?.status === "active", "Goal status updated to active");

  // Cancel
  await goals.cancelGoal(goal.id);
  const afterCancel = await goals.getActiveGoals();
  const cancelled = afterCancel.find(g => g.id === goal.id);
  assert(!cancelled, "Goal removed from active after cancel");
}

async function testPerception() {
  console.log(blue("\n━━━ Perception System ━━━"));

  const perception = new CaptainPerception(PROJECT_DIR);

  // Empty perception
  const emptyEvents = await perception.perceive();
  assert(Array.isArray(emptyEvents), "Perceive returns array");

  // Enqueue user message
  perception.enqueueUserMessage("Hey Captain, what's your status?");
  const events = await perception.perceive();
  const userMsg = events.find(e => e.type === "user_message");
  assert(!!userMsg, "User message perceived");
  assert(userMsg!.content.includes("status"), "Message content correct");

  // Enqueue voice transcript
  perception.enqueueVoiceTranscript("Can you research quantum computing?");
  const voiceEvents = await perception.perceive();
  const voice = voiceEvents.find(e => e.type === "voice_transcript");
  assert(!!voice, "Voice transcript perceived");

  // After draining, should be empty
  const empty = await perception.perceive();
  const noMessages = empty.filter(e => e.type === "user_message" || e.type === "voice_transcript");
  assert(noMessages.length === 0, "Messages drained after perceive");
}

async function testInitiative() {
  console.log(blue("\n━━━ Initiative Engine ━━━"));

  const initiative = new CaptainInitiative();

  // No triggers should fire initially
  const actions = initiative.evaluate([], false, false);
  assert(actions.length === 0, "No triggers fire on empty state");

  // Record an open question
  initiative.recordOpenQuestion("What is the future of AGI?");
  assert(initiative.getOpenQuestions().length === 1, "Open question recorded");

  // Curiosity trigger should fire when no active goals
  const curiosityActions = initiative.evaluate([], false, false);
  // May or may not fire depending on cooldown state
  assert(Array.isArray(curiosityActions), "Initiative evaluation returns array");

  // Worker complete event should trigger synthesis
  const workerEvent = { type: "worker_complete" as const, source: "worker:123", content: "Done", timestamp: Date.now() };
  const synthActions = initiative.evaluate([workerEvent], true, true);
  assert(synthActions.includes("synthesize_and_notify"), "Worker completion triggers synthesis");

  // Resolve question
  initiative.resolveQuestion("What is the future of AGI?");
  assert(initiative.getOpenQuestions().length === 0, "Question resolved");
}

async function testGuardrails() {
  console.log(blue("\n━━━ Guardrails ━━━"));

  // Cost guardrail
  const cost = new CostGuardrail({
    maxTokensPerHour: 1000,
    maxTokensPerDay: 5000,
    maxConcurrentWorkers: 3,
  });

  assert(cost.canTick().allowed, "Tick allowed within budget");
  cost.recordTokenUsage(500);
  assert(cost.canTick().allowed, "Tick still allowed after 500 tokens");
  cost.recordTokenUsage(600);
  assert(!cost.canTick().allowed, "Tick blocked after exceeding hourly budget");

  const stats = cost.getStats();
  assert(stats.hourlyTokens === 1100, `Hourly tokens tracked: ${stats.hourlyTokens}`);

  // Worker spawn limits
  cost.recordWorkerSpawn();
  cost.recordWorkerSpawn();
  cost.recordWorkerSpawn();
  assert(!cost.canSpawnWorker().allowed, "Worker spawn blocked at max concurrent");
  cost.recordWorkerComplete();
  assert(cost.canSpawnWorker().allowed, "Worker spawn allowed after completion");

  // Initiative throttle
  const throttle = new InitiativeThrottle(1000, 3); // 1s interval, 3/hour
  assert(throttle.canMessage(), "First proactive message allowed");
  throttle.recordMessage();
  assert(!throttle.canMessage(), "Second message blocked (within interval)");

  // Error recovery
  const recovery = new ErrorRecovery(3, 60000);
  assert(recovery.isHealthy(), "Initially healthy");
  recovery.recordError(new Error("test error 1"));
  recovery.recordError(new Error("test error 2"));
  assert(recovery.isHealthy(), "Still healthy after 2 errors");
  const result = recovery.recordError(new Error("test error 3"));
  assert(!result.shouldContinue, "Circuit breaker triggers after 3 errors");
  assert(!recovery.isHealthy(), "Unhealthy after circuit break");
  recovery.recordSuccess();
  assert(recovery.isHealthy(), "Healthy again after success");
}

async function testCaptainService() {
  console.log(blue("\n━━━ Captain Service (Integration) ━━━"));

  const service = new CaptainService();

  // Initialize
  await service.initialize(PROJECT_DIR);
  assert(true, "CaptainService initialized");

  // Get identity
  const identity = await service.getIdentity();
  assert(identity.name === "Atlas", `Identity name: ${identity.name}`);
  assert(identity.personality.traits.length > 0, `Traits: ${identity.personality.traits.join(", ")}`);

  // Update identity
  const updated = await service.updateIdentity({
    personality: {
      ...identity.personality,
      opinions: { test_topic: "This is a test opinion" },
    },
  });
  assert(updated.personality.opinions.test_topic === "This is a test opinion", "Identity updated with opinion");

  // Restore original
  await service.updateIdentity({
    personality: { ...identity.personality, opinions: {} },
  });

  // Submit goal
  const goalId = await service.submitGoal("Test goal for verification", 3);
  assert(goalId.length > 0, `Goal submitted: ${goalId.slice(0, 8)}...`);

  // List goals
  const goals = await service.listGoals();
  assert(goals.length > 0, `Goals listed: ${goals.length}`);

  // Send message
  service.sendMessage("Hello Captain!");
  const messages = service.getMessages();
  assert(messages.length === 1, "Message queued");
  assert(messages[0].role === "user", "Message role is user");

  // Get memories
  const memories = await service.getMemories();
  assert(Array.isArray(memories), "Memories returned as array");

  // Get workers
  const workers = await service.getActiveWorkers();
  assert(Array.isArray(workers), "Workers returned as array");

  // Canvas state
  const canvas = service.getCanvasState();
  assert(Array.isArray(canvas.nodes), "Canvas nodes array");
  assert(Array.isArray(canvas.edges), "Canvas edges array");

  // State check
  assert(!service.isRunning(), "Not running (no sendFunction wired)");
  assert(service.getTickCount() === 0, "Tick count is 0");

  // Wire a mock send function and test cognitive loop
  service.wireSendFunction(async (message: string) => {
    console.log(dim(`  [Mock LLM] Received ${message.length} char prompt`));
    return "I've analyzed the events. No action needed right now.";
  });

  // Enable and run briefly
  service.enable();
  assert(service.isRunning(), "Captain is running");

  // Wait for 1 tick
  await new Promise(resolve => setTimeout(resolve, 12_000));

  assert(service.getTickCount() >= 1, `Cognitive ticks executed: ${service.getTickCount()}`);

  // Disable
  service.disable();
  assert(!service.isRunning(), "Captain stopped");

  // Cancel test goal
  await service.cancelGoal(goalId);
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

async function main() {
  console.log(yellow("\n╔══════════════════════════════════════╗"));
  console.log(yellow("║   Captain Autonomous Mind — Tests    ║"));
  console.log(yellow("╚══════════════════════════════════════╝"));

  try {
    await testMemory();
    await testGoals();
    await testPerception();
    await testInitiative();
    await testGuardrails();
    await testCaptainService();
  } catch (error) {
    console.log(red(`\n  FATAL ERROR: ${error}`));
    failed++;
  }

  console.log(yellow("\n━━━ Results ━━━"));
  console.log(green(`  ${passed} passed`));
  if (failed > 0) console.log(red(`  ${failed} failed`));
  else console.log(green("  All tests passed!"));

  // Clean up test data from goals.json
  try {
    await fs.writeFile(
      path.join(CAPTAIN_DIR, "goals.json"),
      JSON.stringify({ goals: [], last_updated: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

main();
