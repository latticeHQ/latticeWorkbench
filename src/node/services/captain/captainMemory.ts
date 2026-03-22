/**
 * Captain Memory Service
 *
 * Persistent file-based memory system for the Captain's autonomous mind.
 * Stores episodic (what happened), semantic (what I know), relational (who I know),
 * and procedural (how to do things) memories.
 *
 * Files are stored in .lattice/captain/memories/ as JSON.
 * Retrieval uses importance + recency scoring (no vector DB needed initially).
 */

import { readdir, readFile, writeFile, unlink, mkdir } from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { log } from "@/node/services/log";
import type {
  Memory,
  MemoryType,
  CaptainIdentity,
  RelationalMemory,
} from "./types";

export class CaptainMemory {
  private readonly baseDir: string;

  constructor(projectDir: string) {
    this.baseDir = path.join(projectDir, ".lattice", "captain", "memories");
  }

  // ---------------------------------------------------------------------------
  // Core CRUD
  // ---------------------------------------------------------------------------

  /** Store a new memory with importance scoring. */
  async store(
    type: MemoryType,
    content: string,
    importance: number,
    metadata: Record<string, unknown> = {},
  ): Promise<Memory> {
    const memory: Memory = {
      id: randomUUID(),
      type,
      content,
      importance: Math.max(0, Math.min(1, importance)),
      metadata,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    const dir = path.join(this.baseDir, type);
    await mkdir(dir, { recursive: true });

    const filename = `${new Date().toISOString().split("T")[0]}_${memory.id.slice(0, 8)}.json`;
    await writeFile(
      path.join(dir, filename),
      JSON.stringify(memory, null, 2),
      "utf-8",
    );

    log.info(`[Captain Memory] Stored ${type} memory: ${content.slice(0, 80)}...`);
    return memory;
  }

  /** Recall relevant memories, scored by importance + recency. */
  async recall(
    query: string,
    types?: MemoryType[],
    limit: number = 10,
  ): Promise<Memory[]> {
    const allMemories: Memory[] = [];
    const targetTypes = types ?? ["episodic", "semantic", "relational", "procedural"];

    for (const type of targetTypes) {
      const dir = path.join(this.baseDir, type);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = await readFile(path.join(dir, file), "utf-8");
            const memory = JSON.parse(raw) as Memory;
            allMemories.push(memory);
          } catch {
            // Skip malformed files
          }
        }
      } catch {
        // Directory doesn't exist yet — that's fine
      }
    }

    // Score: importance * recencyBoost * relevanceBoost
    const queryLower = query.toLowerCase();
    const now = Date.now();
    const scored = allMemories.map((m) => {
      const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.max(0.1, 1 - ageDays / 30); // Decay over 30 days
      const relevanceBoost = this.keywordRelevance(m.content, queryLower);
      const score = m.importance * recencyBoost * (0.5 + relevanceBoost);
      return { memory: m, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Update lastAccessedAt for returned memories
    const results = scored.slice(0, limit).map((s) => s.memory);
    // Fire-and-forget access time update
    void this.updateAccessTimes(results);

    return results;
  }

  /** Get all memories of a specific type. */
  async getAll(type: MemoryType): Promise<Memory[]> {
    const dir = path.join(this.baseDir, type);
    const memories: Memory[] = [];

    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(path.join(dir, file), "utf-8");
          memories.push(JSON.parse(raw) as Memory);
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Dir doesn't exist
    }

    return memories.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------------------------------------------------------------------------
  // Memory Consolidation
  // ---------------------------------------------------------------------------

  /**
   * Consolidate old episodic memories into semantic summaries.
   * Called periodically by the cognitive loop.
   * Returns the consolidation prompt for the LLM to process.
   */
  async buildConsolidationPrompt(): Promise<string | null> {
    const episodic = await this.getAll("episodic");
    const oldEpisodic = episodic.filter((m) => {
      const ageDays = (Date.now() - m.createdAt) / (1000 * 60 * 60 * 24);
      return ageDays > 7 && m.importance < 0.7;
    });

    if (oldEpisodic.length < 5) return null;

    const summaryBlock = oldEpisodic
      .slice(0, 20)
      .map((m) => `- [${new Date(m.createdAt).toISOString()}] ${m.content}`)
      .join("\n");

    return [
      "Consolidate these old episodic memories into 2-3 semantic memories (general facts/patterns).",
      "Return JSON array: [{\"content\": \"...\", \"importance\": 0.0-1.0}]",
      "",
      "Episodic memories to consolidate:",
      summaryBlock,
    ].join("\n");
  }

  /** Prune low-importance memories older than threshold. */
  async forget(importanceThreshold: number = 0.3, olderThanDays: number = 30): Promise<number> {
    let pruned = 0;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    for (const type of ["episodic", "semantic", "procedural"] as MemoryType[]) {
      const dir = path.join(this.baseDir, type);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = await readFile(path.join(dir, file), "utf-8");
            const memory = JSON.parse(raw) as Memory;
            if (memory.importance < importanceThreshold && memory.createdAt < cutoff) {
              await unlink(path.join(dir, file));
              pruned++;
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Dir doesn't exist
      }
    }

    if (pruned > 0) {
      log.info(`[Captain Memory] Pruned ${pruned} low-importance memories`);
    }
    return pruned;
  }

  // ---------------------------------------------------------------------------
  // Context Building
  // ---------------------------------------------------------------------------

  /** Build a memory context block for injection into the captain's system prompt. */
  async buildContextBlock(query?: string): Promise<string> {
    const sections: string[] = [];

    // Identity
    const identityPath = path.join(
      this.baseDir,
      "..",
      "identity.json",
    );
    try {
      const raw = await readFile(identityPath, "utf-8");
      const identity = JSON.parse(raw) as CaptainIdentity;
      sections.push(
        "## Your Identity",
        `Name: ${identity.name}`,
        `Traits: ${identity.personality.traits.join(", ")}`,
        `Style: ${identity.personality.communication_style}`,
        `Values: ${identity.personality.values.join(", ")}`,
      );
      if (Object.keys(identity.personality.opinions).length > 0) {
        sections.push("Opinions:");
        for (const [topic, opinion] of Object.entries(identity.personality.opinions)) {
          sections.push(`  - ${topic}: ${opinion}`);
        }
      }
    } catch {
      // No identity file yet
    }

    // Recent episodic memories
    const recent = await this.recall(query ?? "recent events", ["episodic"], 5);
    if (recent.length > 0) {
      sections.push(
        "",
        "## Recent Memories",
        ...recent.map(
          (m) => `- [${new Date(m.createdAt).toLocaleDateString()}] ${m.content}`,
        ),
      );
    }

    // Key semantic knowledge
    const knowledge = await this.recall(query ?? "important facts", ["semantic"], 5);
    if (knowledge.length > 0) {
      sections.push(
        "",
        "## What I Know",
        ...knowledge.map((m) => `- ${m.content}`),
      );
    }

    // User relationship
    try {
      const userPath = path.join(this.baseDir, "relational", "user.json");
      const raw = await readFile(userPath, "utf-8");
      const rel = JSON.parse(raw) as RelationalMemory;
      if (rel.observations.length > 0 || rel.expertise.length > 0) {
        sections.push("", "## About My Human Partner");
        if (rel.expertise.length > 0) {
          sections.push(`Expertise: ${rel.expertise.join(", ")}`);
        }
        if (rel.observations.length > 0) {
          sections.push(
            ...rel.observations.slice(-5).map((o) => `- ${o}`),
          );
        }
      }
    } catch {
      // No relational data yet
    }

    return sections.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Simple keyword relevance scoring (0-1). */
  private keywordRelevance(text: string, queryLower: string): number {
    const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) return 0.5;

    const textLower = text.toLowerCase();
    const matches = words.filter((w) => textLower.includes(w)).length;
    return matches / words.length;
  }

  /** Update lastAccessedAt timestamps (fire-and-forget). */
  private async updateAccessTimes(memories: Memory[]): Promise<void> {
    const now = Date.now();
    for (const m of memories) {
      m.lastAccessedAt = now;
      // We don't re-write every time — too expensive.
      // Just update in-memory for this session.
    }
  }
}
