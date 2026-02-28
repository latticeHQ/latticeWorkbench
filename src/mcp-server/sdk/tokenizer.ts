/**
 * Lattice SDK — Tokenizer operations (3 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function countTokens(c: RouterClient<AppRouter>, model: string, text: string) {
  return c.tokenizer.countTokens({ model, text });
}

export async function countTokensBatch(c: RouterClient<AppRouter>, model: string, texts: string[]) {
  return c.tokenizer.countTokensBatch({ model, texts });
}

export async function calculateStats(c: RouterClient<AppRouter>, input: Parameters<typeof c.tokenizer.calculateStats>[0]) {
  return c.tokenizer.calculateStats(input);
}
