import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LanguageModelV2Usage } from "@ai-sdk/provider";
import type { DuckDBConnection } from "@duckdb/node-api";
import { EventRowSchema, type EventRow } from "@/common/orpc/schemas/analytics";
import { getErrorMessage } from "@/common/utils/errors";
import { createDisplayUsage } from "@/common/utils/tokens/displayUsage";
import { log } from "@/node/services/log";

export const CHAT_FILE_NAME = "chat.jsonl";
const METADATA_FILE_NAME = "metadata.json";

const INSERT_EVENT_SQL = `
INSERT INTO events (
  minion_id,
  project_path,
  project_name,
  minion_name,
  parent_minion_id,
  agent_id,
  timestamp,
  date,
  model,
  thinking_level,
  input_tokens,
  output_tokens,
  reasoning_tokens,
  cached_tokens,
  cache_create_tokens,
  input_cost_usd,
  output_cost_usd,
  reasoning_cost_usd,
  cached_cost_usd,
  total_cost_usd,
  duration_ms,
  ttft_ms,
  streaming_ms,
  tool_execution_ms,
  output_tps,
  response_index,
  is_sub_agent
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?
)
`;

interface MinionMeta {
  projectPath?: string;
  projectName?: string;
  minionName?: string;
  parentMinionId?: string;
}

type MinionMetaById = Record<string, MinionMeta>;

interface IngestWatermark {
  lastSequence: number;
  lastModified: number;
}

interface IngestEvent {
  row: EventRow;
  sequence: number;
  date: string | null;
}

interface EventHeadSignatureParts {
  timestamp: number | null;
  model: string | null;
  totalCostUsd: number | null;
}

interface PersistedMessage {
  role?: unknown;
  createdAt?: unknown;
  metadata?: unknown;
}

const TTFT_FIELD_CANDIDATES = [
  "ttftMs",
  "ttft_ms",
  "timeToFirstTokenMs",
  "time_to_first_token_ms",
  "timeToFirstToken",
  "time_to_first_token",
  "firstTokenMs",
  "first_token_ms",
] as const;

const TIMING_RECORD_CANDIDATES = [
  "providerMetadata",
  "timing",
  "timings",
  "metrics",
  "latency",
  "performance",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  // DuckDB returns BIGINT columns as JS bigint — coerce to number when safe.
  if (typeof value === "bigint") {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function toFiniteInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCreatedAtTimestamp(value: unknown): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateBucketFromTimestamp(timestampMs: number | null): string | null {
  if (timestampMs === null) {
    return null;
  }

  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseUsage(rawUsage: unknown): LanguageModelV2Usage | undefined {
  if (!isRecord(rawUsage)) {
    return undefined;
  }

  const inputTokens = toFiniteNumber(rawUsage.inputTokens) ?? undefined;
  const outputTokens = toFiniteNumber(rawUsage.outputTokens) ?? undefined;
  const totalTokens = toFiniteNumber(rawUsage.totalTokens) ?? undefined;
  const reasoningTokens = toFiniteNumber(rawUsage.reasoningTokens) ?? undefined;
  const cachedInputTokens = toFiniteNumber(rawUsage.cachedInputTokens) ?? undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined &&
    cachedInputTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cachedInputTokens,
  };
}

function readFirstFiniteMetric(
  source: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const parsed = toFiniteNumber(source[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function collectTimingMetricSources(
  metadata: Record<string, unknown>
): Array<Record<string, unknown>> {
  const visited = new Set<Record<string, unknown>>();
  const sources: Array<Record<string, unknown>> = [];

  const enqueueRecord = (value: unknown): void => {
    if (!isRecord(value) || visited.has(value)) {
      return;
    }

    visited.add(value);
    sources.push(value);
  };

  const enqueueKnownTimingCandidates = (value: unknown): void => {
    if (!isRecord(value)) {
      return;
    }

    enqueueRecord(value);

    for (const key of TIMING_RECORD_CANDIDATES) {
      enqueueRecord(value[key]);
    }
  };

  enqueueKnownTimingCandidates(metadata);

  const providerMetadata = metadata.providerMetadata;
  enqueueKnownTimingCandidates(providerMetadata);

  if (isRecord(providerMetadata)) {
    for (const nestedProviderMetadata of Object.values(providerMetadata)) {
      enqueueKnownTimingCandidates(nestedProviderMetadata);
    }
  }

  return sources;
}

function extractTtftMs(metadata: Record<string, unknown>): number | null {
  const timingSources = collectTimingMetricSources(metadata);
  assert(timingSources.length > 0, "extractTtftMs: expected at least one timing source");

  for (const source of timingSources) {
    const ttftMs = readFirstFiniteMetric(source, TTFT_FIELD_CANDIDATES);
    if (ttftMs !== null) {
      return ttftMs;
    }
  }

  return null;
}

function deriveProjectName(projectPath: string | undefined): string | undefined {
  if (!projectPath) {
    return undefined;
  }

  const basename = path.basename(projectPath);
  return basename.length > 0 ? basename : undefined;
}

function parseMinionMetaFromUnknown(value: unknown): MinionMeta {
  if (!isRecord(value)) {
    return {};
  }

  return {
    projectPath: toOptionalString(value.projectPath),
    projectName: toOptionalString(value.projectName),
    minionName: toOptionalString(value.name),
    parentMinionId: toOptionalString(value.parentMinionId),
  };
}

async function readMinionMetaFromDisk(sessionDir: string): Promise<MinionMeta> {
  const metadataPath = path.join(sessionDir, METADATA_FILE_NAME);

  try {
    const raw = await fs.readFile(metadataPath, "utf-8");
    return parseMinionMetaFromUnknown(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return {};
    }

    log.warn("[analytics-etl] Failed to read minion metadata", {
      metadataPath,
      error: getErrorMessage(error),
    });
    return {};
  }
}

function mergeMinionMeta(
  sessionMeta: MinionMeta,
  overrideMeta: MinionMeta
): MinionMeta {
  const projectPath = overrideMeta.projectPath ?? sessionMeta.projectPath;

  return {
    projectPath,
    projectName:
      overrideMeta.projectName ?? sessionMeta.projectName ?? deriveProjectName(projectPath),
    minionName: overrideMeta.minionName ?? sessionMeta.minionName,
    parentMinionId: overrideMeta.parentMinionId ?? sessionMeta.parentMinionId,
  };
}

function parsePersistedMessage(
  line: string,
  minionId: string,
  lineNumber: number
): PersistedMessage | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? (parsed as PersistedMessage) : null;
  } catch (error) {
    log.warn("[analytics-etl] Skipping malformed chat.jsonl line", {
      minionId,
      lineNumber,
      error: getErrorMessage(error),
    });
    return null;
  }
}

function extractIngestEvent(params: {
  minionId: string;
  minionMeta: MinionMeta;
  message: PersistedMessage;
  lineNumber: number;
  responseIndex: number;
}): IngestEvent | null {
  if (params.message.role !== "assistant") {
    return null;
  }

  const metadata = isRecord(params.message.metadata) ? params.message.metadata : null;
  if (!metadata) {
    return null;
  }

  const usage = parseUsage(metadata.usage);
  if (!usage) {
    return null;
  }

  const sequence = toFiniteInteger(metadata.historySequence) ?? params.lineNumber;

  const model = toOptionalString(metadata.model);
  const providerMetadata = isRecord(metadata.providerMetadata)
    ? metadata.providerMetadata
    : undefined;

  const displayUsage = createDisplayUsage(usage, model ?? "unknown", providerMetadata);
  assert(displayUsage, "createDisplayUsage should return data for parsed usage payloads");

  const timestamp =
    toFiniteNumber(metadata.timestamp) ?? parseCreatedAtTimestamp(params.message.createdAt) ?? null;
  const dateBucket = dateBucketFromTimestamp(timestamp);

  const inputTokens = displayUsage.input.tokens;
  const outputTokens = displayUsage.output.tokens;
  const reasoningTokens = displayUsage.reasoning.tokens;
  const cachedTokens = displayUsage.cached.tokens;
  const cacheCreateTokens = displayUsage.cacheCreate.tokens;

  const inputCostUsd = displayUsage.input.cost_usd ?? 0;
  const outputCostUsd = displayUsage.output.cost_usd ?? 0;
  const reasoningCostUsd = displayUsage.reasoning.cost_usd ?? 0;
  const cachedCostUsd =
    (displayUsage.cached.cost_usd ?? 0) + (displayUsage.cacheCreate.cost_usd ?? 0);

  const durationMs = toFiniteNumber(metadata.duration);
  const ttftMs = extractTtftMs(metadata);
  const outputTps =
    durationMs !== null && durationMs > 0 ? outputTokens / (durationMs / 1000) : null;

  const maybeEvent = {
    minion_id: params.minionId,
    project_path: params.minionMeta.projectPath ?? null,
    project_name: params.minionMeta.projectName ?? null,
    minion_name: params.minionMeta.minionName ?? null,
    parent_minion_id: params.minionMeta.parentMinionId ?? null,
    agent_id: toOptionalString(metadata.agentId) ?? null,
    timestamp,
    model: model ?? null,
    thinking_level: toOptionalString(metadata.thinkingLevel) ?? null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_create_tokens: cacheCreateTokens,
    input_cost_usd: inputCostUsd,
    output_cost_usd: outputCostUsd,
    reasoning_cost_usd: reasoningCostUsd,
    cached_cost_usd: cachedCostUsd,
    total_cost_usd: inputCostUsd + outputCostUsd + reasoningCostUsd + cachedCostUsd,
    duration_ms: durationMs,
    ttft_ms: ttftMs,
    streaming_ms: null,
    tool_execution_ms: null,
    output_tps: outputTps,
    response_index: params.responseIndex,
    is_sub_agent: (params.minionMeta.parentMinionId ?? "").length > 0,
  };

  const parsedEvent = EventRowSchema.safeParse(maybeEvent);
  if (!parsedEvent.success) {
    log.warn("[analytics-etl] Skipping invalid analytics row", {
      minionId: params.minionId,
      lineNumber: params.lineNumber,
      issues: parsedEvent.error.issues,
    });
    return null;
  }

  return {
    row: parsedEvent.data,
    sequence,
    date: dateBucket,
  };
}

async function readWatermark(
  conn: DuckDBConnection,
  minionId: string
): Promise<IngestWatermark> {
  const result = await conn.run(
    `SELECT last_sequence, last_modified FROM ingest_watermarks WHERE minion_id = ?`,
    [minionId]
  );
  const rows = await result.getRowObjectsJS();

  if (rows.length === 0) {
    return { lastSequence: -1, lastModified: 0 };
  }

  const row = rows[0];
  const lastSequence = toFiniteNumber(row.last_sequence) ?? -1;
  const lastModified = toFiniteNumber(row.last_modified) ?? 0;

  return {
    lastSequence,
    lastModified,
  };
}

async function readMinionEventRowCount(
  conn: DuckDBConnection,
  minionId: string
): Promise<number> {
  const result = await conn.run(`SELECT COUNT(*) AS row_count FROM events WHERE minion_id = ?`, [
    minionId,
  ]);
  const rows = await result.getRowObjectsJS();
  assert(rows.length === 1, "readMinionEventRowCount: expected exactly one COUNT(*) result row");

  const rowCount = toFiniteInteger(rows[0].row_count);
  assert(
    rowCount !== null && rowCount >= 0,
    "readMinionEventRowCount: expected non-negative integer row_count"
  );

  return rowCount;
}

export async function clearMinionAnalyticsState(
  conn: DuckDBConnection,
  minionId: string
): Promise<void> {
  assert(minionId.trim().length > 0, "clearMinionAnalyticsState: minionId is required");

  await conn.run("BEGIN TRANSACTION");
  try {
    await conn.run("DELETE FROM events WHERE minion_id = ?", [minionId]);
    await conn.run("DELETE FROM ingest_watermarks WHERE minion_id = ?", [minionId]);
    await conn.run("COMMIT");
  } catch (error) {
    await conn.run("ROLLBACK");
    throw error;
  }
}

function serializeHeadSignatureValue(value: string | number | null): string {
  if (value === null) {
    return "null";
  }

  return `${typeof value}:${String(value)}`;
}

function createEventHeadSignature(parts: EventHeadSignatureParts): string {
  return [
    serializeHeadSignatureValue(parts.timestamp),
    serializeHeadSignatureValue(parts.model),
    serializeHeadSignatureValue(parts.totalCostUsd),
  ].join("|");
}

function createEventHeadSignatureFromParsedEvent(event: IngestEvent): string {
  const row = event.row;
  assert(
    Number.isFinite(row.total_cost_usd),
    "createEventHeadSignatureFromParsedEvent: expected finite total_cost_usd"
  );

  return createEventHeadSignature({
    timestamp: row.timestamp,
    model: row.model,
    totalCostUsd: row.total_cost_usd,
  });
}

async function readPersistedMinionHeadSignature(
  conn: DuckDBConnection,
  minionId: string
): Promise<string | null> {
  const result = await conn.run(
    `
    SELECT timestamp, model, total_cost_usd
    FROM events
    WHERE minion_id = ?
    ORDER BY response_index ASC NULLS LAST
    LIMIT 1
    `,
    [minionId]
  );
  const rows = await result.getRowObjectsJS();

  if (rows.length === 0) {
    return null;
  }

  assert(
    rows.length === 1,
    "readPersistedMinionHeadSignature: expected zero or one persisted head row"
  );

  const row = rows[0] as Record<string, unknown>;
  const timestamp = toFiniteNumber(row.timestamp);
  assert(
    timestamp !== null || row.timestamp === null,
    "readPersistedMinionHeadSignature: expected timestamp to be finite number or null"
  );

  const model = row.model;
  assert(
    model === null || typeof model === "string",
    "readPersistedMinionHeadSignature: expected model to be string or null"
  );

  const totalCostUsd = toFiniteNumber(row.total_cost_usd);
  assert(
    totalCostUsd !== null || row.total_cost_usd === null,
    "readPersistedMinionHeadSignature: expected total_cost_usd to be finite number or null"
  );

  return createEventHeadSignature({
    timestamp,
    model,
    totalCostUsd,
  });
}

function hasPersistedWatermark(watermark: IngestWatermark): boolean {
  return watermark.lastSequence >= 0 || watermark.lastModified > 0;
}

async function writeWatermark(
  conn: DuckDBConnection,
  minionId: string,
  watermark: IngestWatermark
): Promise<void> {
  await conn.run(
    `
    INSERT INTO ingest_watermarks (minion_id, last_sequence, last_modified)
    VALUES (?, ?, ?)
    ON CONFLICT(minion_id) DO UPDATE
      SET last_sequence = excluded.last_sequence,
          last_modified = excluded.last_modified
    `,
    [minionId, watermark.lastSequence, watermark.lastModified]
  );
}

async function replaceEventsByResponseIndex(
  conn: DuckDBConnection,
  minionId: string,
  events: IngestEvent[]
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const responseIndexes: number[] = [];
  const seenResponseIndexes = new Set<number>();

  for (const event of events) {
    const row = event.row;
    assert(
      row.minion_id === minionId,
      "replaceEventsByResponseIndex: all rows must belong to the target minion"
    );
    const responseIndex = row.response_index;
    assert(responseIndex !== null, "replaceEventsByResponseIndex: response_index must be present");
    assert(
      Number.isInteger(responseIndex),
      "replaceEventsByResponseIndex: response_index must be an integer"
    );
    if (seenResponseIndexes.has(responseIndex)) {
      continue;
    }

    seenResponseIndexes.add(responseIndex);
    responseIndexes.push(responseIndex);
  }

  assert(
    responseIndexes.length > 0,
    "replaceEventsByResponseIndex: non-empty events must include response indexes"
  );

  const placeholders = responseIndexes.map(() => "?").join(", ");

  await conn.run("BEGIN TRANSACTION");
  try {
    // response_index is stable for in-place rewrites, so delete before insert to
    // ensure rewritten rows replace stale analytics entries instead of appending.
    await conn.run(
      `DELETE FROM events WHERE minion_id = ? AND response_index IN (${placeholders})`,
      [minionId, ...responseIndexes]
    );

    for (const event of events) {
      const row = event.row;
      await conn.run(INSERT_EVENT_SQL, [
        row.minion_id,
        row.project_path,
        row.project_name,
        row.minion_name,
        row.parent_minion_id,
        row.agent_id,
        row.timestamp,
        event.date,
        row.model,
        row.thinking_level,
        row.input_tokens,
        row.output_tokens,
        row.reasoning_tokens,
        row.cached_tokens,
        row.cache_create_tokens,
        row.input_cost_usd,
        row.output_cost_usd,
        row.reasoning_cost_usd,
        row.cached_cost_usd,
        row.total_cost_usd,
        row.duration_ms,
        row.ttft_ms,
        row.streaming_ms,
        row.tool_execution_ms,
        row.output_tps,
        row.response_index,
        row.is_sub_agent,
      ]);
    }

    await conn.run("COMMIT");
  } catch (error) {
    await conn.run("ROLLBACK");
    throw error;
  }
}

async function replaceMinionEvents(
  conn: DuckDBConnection,
  minionId: string,
  events: IngestEvent[]
): Promise<void> {
  await conn.run("BEGIN TRANSACTION");
  try {
    await conn.run("DELETE FROM events WHERE minion_id = ?", [minionId]);

    for (const event of events) {
      const row = event.row;
      assert(
        row.minion_id === minionId,
        "replaceMinionEvents: all rows must belong to the target minion"
      );
      await conn.run(INSERT_EVENT_SQL, [
        row.minion_id,
        row.project_path,
        row.project_name,
        row.minion_name,
        row.parent_minion_id,
        row.agent_id,
        row.timestamp,
        event.date,
        row.model,
        row.thinking_level,
        row.input_tokens,
        row.output_tokens,
        row.reasoning_tokens,
        row.cached_tokens,
        row.cache_create_tokens,
        row.input_cost_usd,
        row.output_cost_usd,
        row.reasoning_cost_usd,
        row.cached_cost_usd,
        row.total_cost_usd,
        row.duration_ms,
        row.ttft_ms,
        row.streaming_ms,
        row.tool_execution_ms,
        row.output_tps,
        row.response_index,
        row.is_sub_agent,
      ]);
    }

    await conn.run("COMMIT");
  } catch (error) {
    await conn.run("ROLLBACK");
    throw error;
  }
}

function getMaxSequence(events: IngestEvent[]): number | null {
  if (events.length === 0) {
    return null;
  }

  let maxSequence = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    maxSequence = Math.max(maxSequence, event.sequence);
  }

  assert(Number.isFinite(maxSequence), "getMaxSequence: expected finite max sequence");
  return maxSequence;
}

function shouldRebuildMinionForSequenceRegression(params: {
  watermark: IngestWatermark;
  parsedMaxSequence: number | null;
  hasTruncation: boolean;
  hasHeadMismatch: boolean;
}): boolean {
  if (params.hasTruncation || params.hasHeadMismatch) {
    return true;
  }

  if (!hasPersistedWatermark(params.watermark)) {
    return false;
  }

  if (params.parsedMaxSequence === null) {
    return true;
  }

  return params.parsedMaxSequence < params.watermark.lastSequence;
}

export async function ingestMinion(
  conn: DuckDBConnection,
  minionId: string,
  sessionDir: string,
  meta: MinionMeta
): Promise<void> {
  assert(minionId.trim().length > 0, "ingestMinion: minionId is required");
  assert(sessionDir.trim().length > 0, "ingestMinion: sessionDir is required");

  const chatPath = path.join(sessionDir, CHAT_FILE_NAME);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(chatPath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      // Remove stale analytics state when the minion history file no longer exists.
      await clearMinionAnalyticsState(conn, minionId);
      return;
    }

    throw error;
  }

  const watermark = await readWatermark(conn, minionId);
  if (stat.mtimeMs <= watermark.lastModified) {
    return;
  }

  const persistedMeta = await readMinionMetaFromDisk(sessionDir);
  const minionMeta = mergeMinionMeta(persistedMeta, meta);

  const chatContents = await fs.readFile(chatPath, "utf-8");
  const lines = chatContents.split("\n").filter((line) => line.trim().length > 0);

  let responseIndex = 0;
  const parsedEvents: IngestEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const message = parsePersistedMessage(lines[i], minionId, lineNumber);
    if (!message) {
      continue;
    }

    const event = extractIngestEvent({
      minionId,
      minionMeta,
      message,
      lineNumber,
      responseIndex,
    });
    if (!event) {
      continue;
    }

    assert(
      Number.isInteger(event.sequence),
      "ingestMinion: expected assistant event sequence to be an integer"
    );

    responseIndex += 1;
    parsedEvents.push(event);
  }

  const parsedMaxSequence = getMaxSequence(parsedEvents);
  const hasExistingWatermark = hasPersistedWatermark(watermark);
  const persistedEventRowCount = await readMinionEventRowCount(conn, minionId);
  // Sequence-only checks miss truncations when the tail keeps the previous max
  // historySequence. If fewer assistant events are parsed than currently stored,
  // stale deleted rows remain unless we force a full minion rebuild.
  const hasTruncation = hasExistingWatermark && parsedEvents.length < persistedEventRowCount;
  const persistedHeadSignature = hasExistingWatermark
    ? await readPersistedMinionHeadSignature(conn, minionId)
    : null;
  const parsedHeadSignature =
    parsedEvents.length > 0 ? createEventHeadSignatureFromParsedEvent(parsedEvents[0]) : null;
  // Count checks can miss head truncation + append rewrites where assistant row
  // totals recover. Head signature drift reveals shifted response indexes.
  const hasHeadMismatch =
    hasExistingWatermark &&
    persistedHeadSignature !== null &&
    parsedHeadSignature !== null &&
    persistedHeadSignature !== parsedHeadSignature;

  const shouldRebuild = shouldRebuildMinionForSequenceRegression({
    watermark,
    parsedMaxSequence,
    hasTruncation,
    hasHeadMismatch,
  });

  if (shouldRebuild) {
    // Rebuild on truncation, head mismatch, or max-sequence rewinds. This removes
    // stale rows, including the zero-assistant-event truncation case.
    await replaceMinionEvents(conn, minionId, parsedEvents);

    await writeWatermark(conn, minionId, {
      lastSequence: parsedMaxSequence ?? -1,
      lastModified: stat.mtimeMs,
    });
    return;
  }

  let maxSequence = watermark.lastSequence;
  const eventsToInsert: IngestEvent[] = [];
  for (const event of parsedEvents) {
    maxSequence = Math.max(maxSequence, event.sequence);

    // Include the current watermark sequence so in-place rewrites with the same
    // historySequence refresh stale analytics rows instead of getting skipped forever.
    if (event.sequence < watermark.lastSequence) {
      continue;
    }

    eventsToInsert.push(event);
  }

  await replaceEventsByResponseIndex(conn, minionId, eventsToInsert);

  await writeWatermark(conn, minionId, {
    lastSequence: maxSequence,
    lastModified: stat.mtimeMs,
  });
}

export async function rebuildAll(
  conn: DuckDBConnection,
  sessionsDir: string,
  minionMetaById: MinionMetaById = {}
): Promise<{ minionsIngested: number }> {
  assert(sessionsDir.trim().length > 0, "rebuildAll: sessionsDir is required");
  assert(
    isRecord(minionMetaById) && !Array.isArray(minionMetaById),
    "rebuildAll: minionMetaById must be an object"
  );

  await conn.run("BEGIN TRANSACTION");
  try {
    // Reset both tables atomically so a crash cannot leave empty events with
    // stale watermarks that would incorrectly suppress initial backfill.
    await conn.run("DELETE FROM events");
    await conn.run("DELETE FROM ingest_watermarks");
    await conn.run("COMMIT");
  } catch (error) {
    await conn.run("ROLLBACK");
    throw error;
  }

  let entries: Dirent[] | null = null;
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { minionsIngested: 0 };
    }

    throw error;
  }

  assert(entries, "rebuildAll expected a directory listing");

  let minionsIngested = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const minionId = entry.name;
    const sessionDir = path.join(sessionsDir, minionId);
    const suppliedMinionMeta = minionMetaById[minionId] ?? {};

    try {
      await ingestMinion(conn, minionId, sessionDir, suppliedMinionMeta);
      minionsIngested += 1;
    } catch (error) {
      log.warn("[analytics-etl] Failed to ingest minion during rebuild", {
        minionId,
        error: getErrorMessage(error),
      });
    }
  }

  return { minionsIngested };
}
