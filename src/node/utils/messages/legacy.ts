import type {
  LatticeFrontendMetadata,
  LatticeMessage,
  LatticeMetadata,
} from "@/common/types/message";

interface LegacyLatticeMetadata extends LatticeMetadata {
  clatticeMetadata?: LatticeFrontendMetadata;
  idleCompacted?: boolean;
}

/**
 * Normalize persisted messages from older builds.
 *
 * Migrations:
 * - `clatticeMetadata` → `latticeMetadata` (lattice rename)
 * - `{ compacted: true, idleCompacted: true }` → `{ compacted: "idle" }`
 */
export function normalizeLegacyLatticeMetadata(message: LatticeMessage): LatticeMessage {
  const metadata = message.metadata as LegacyLatticeMetadata | undefined;
  if (!metadata) return message;

  let normalized: LatticeMetadata = { ...metadata };
  let changed = false;

  // Migrate clatticeMetadata → latticeMetadata
  if (metadata.clatticeMetadata !== undefined) {
    const { clatticeMetadata, ...rest } = normalized as LegacyLatticeMetadata;
    normalized = rest;
    if (!metadata.latticeMetadata) {
      normalized.latticeMetadata = clatticeMetadata;
    }
    changed = true;
  }

  // Migrate idleCompacted: true → compacted: "idle"
  if (metadata.idleCompacted === true) {
    const { idleCompacted, ...rest } = normalized as LegacyLatticeMetadata;
    normalized = { ...rest, compacted: "idle" };
    changed = true;
  }

  return changed ? { ...message, metadata: normalized } : message;
}
