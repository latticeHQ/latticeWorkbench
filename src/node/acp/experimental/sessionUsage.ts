import type { Usage } from "@agentclientprotocol/sdk";

interface LatticeUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

function toNonNegativeInt(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

/**
 * Convert Lattice usage fields into ACP's usage shape.
 *
 * Lattice primarily uses inputTokens/outputTokens/totalTokens, while some integrations may still pass
 * promptTokens/completionTokens aliases.
 */
export function convertToAcpUsage(latticeUsage: LatticeUsageLike): Usage {
  const inputTokens = toNonNegativeInt(latticeUsage.inputTokens ?? latticeUsage.promptTokens);
  const outputTokens = toNonNegativeInt(latticeUsage.outputTokens ?? latticeUsage.completionTokens);
  const totalTokens = toNonNegativeInt(latticeUsage.totalTokens ?? inputTokens + outputTokens);
  const thoughtTokens = toNonNegativeInt(latticeUsage.reasoningTokens);
  const cachedReadTokens = toNonNegativeInt(latticeUsage.cachedInputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    thoughtTokens: thoughtTokens > 0 ? thoughtTokens : undefined,
    cachedReadTokens: cachedReadTokens > 0 ? cachedReadTokens : undefined,
  };
}
