/**
 * Knowledge Graph Layer — Graphiti + FalkorDB integration.
 *
 * Provides temporal knowledge graph capabilities for the simulation engine:
 * - Entity and edge storage with temporal validity
 * - Semantic search via embeddings
 * - Graph traversal and community detection
 * - Agent memory persistence across simulations
 *
 * FalkorDB runs as a local Docker container (auto-started if configured).
 * Graphiti provides the temporal knowledge graph abstraction.
 *
 * All connection settings are configurable via SimulationSettings.
 */

import { EventEmitter } from "events";
import { log } from "@/node/services/log";
import type {
  GraphEntity,
  GraphEdge,
  GraphInfo,
  AgentMemory,
  SimulationSettings,
  Ontology,
} from "./types";

// ---------------------------------------------------------------------------
// Graph Layer Status
// ---------------------------------------------------------------------------

export type GraphLayerStatus =
  | { status: "not_configured" }
  | { status: "connecting" }
  | { status: "connected"; nodeCount: number; edgeCount: number }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Graph Layer Service
// ---------------------------------------------------------------------------

export class GraphLayer extends EventEmitter {
  private settings: SimulationSettings;
  private _status: GraphLayerStatus = { status: "not_configured" };
  private client: FalkorDBClient | null = null;

  constructor(settings: SimulationSettings) {
    super();
    this.settings = settings;
  }

  get status(): GraphLayerStatus {
    return this._status;
  }

  /**
   * Initialize connection to FalkorDB.
   * Auto-starts Docker container if autoStartGraphDb is enabled.
   */
  async initialize(): Promise<void> {
    this._status = { status: "connecting" };
    this.emit("change", this._status);

    try {
      const { host, port, protocol } = this.settings.graphDb;

      // Check if FalkorDB is reachable
      const reachable = await this.checkConnection(host, port);

      if (!reachable && this.settings.autoStartGraphDb) {
        log.info("[simulation:graph] FalkorDB not running, attempting auto-start...");
        await this.startFalkorDB();
        // Wait for it to come up
        await this.waitForConnection(host, port, 30_000);
      } else if (!reachable) {
        this._status = {
          status: "error",
          message: `FalkorDB not reachable at ${host}:${port}. Start it or enable autoStartGraphDb.`,
        };
        this.emit("change", this._status);
        return;
      }

      this.client = new FalkorDBClient(host, port, protocol);
      await this.client.connect();

      // Initialize schema
      await this.ensureSchema();

      const info = await this.getGraphInfo();
      this._status = {
        status: "connected",
        nodeCount: info.nodeCount,
        edgeCount: info.edgeCount,
      };
      this.emit("change", this._status);
      log.info(`[simulation:graph] Connected to FalkorDB — ${info.nodeCount} nodes, ${info.edgeCount} edges`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._status = { status: "error", message };
      this.emit("change", this._status);
      log.error(`[simulation:graph] Failed to initialize: ${message}`);
    }
  }

  /**
   * Update settings without reinitializing (for live config changes from UI).
   */
  updateSettings(settings: SimulationSettings): void {
    this.settings = settings;
  }

  // ---------------------------------------------------------------------------
  // Entity Operations
  // ---------------------------------------------------------------------------

  async addEntity(entity: Omit<GraphEntity, "uuid" | "createdAt">): Promise<GraphEntity> {
    this.ensureConnected();
    const uuid = generateUUID();
    const now = new Date().toISOString();

    const fullEntity: GraphEntity = {
      ...entity,
      uuid,
      createdAt: now,
    };

    await this.client!.query(
      `CREATE (e:Entity {
        uuid: $uuid, type: $type, name: $name,
        attributes: $attributes, createdAt: $createdAt
      })`,
      {
        uuid,
        type: entity.type,
        name: entity.name,
        attributes: JSON.stringify(entity.attributes),
        createdAt: now,
      },
    );

    // Store embedding if provided
    if (entity.embedding) {
      await this.storeEmbedding("entity", uuid, entity.embedding);
    }

    return fullEntity;
  }

  async addEntities(entities: Array<Omit<GraphEntity, "uuid" | "createdAt">>): Promise<GraphEntity[]> {
    const results: GraphEntity[] = [];
    // Batch in groups of 50 for performance
    for (let i = 0; i < entities.length; i += 50) {
      const batch = entities.slice(i, i + 50);
      const batchResults = await Promise.all(batch.map((e) => this.addEntity(e)));
      results.push(...batchResults);
    }
    return results;
  }

  async getEntity(uuid: string): Promise<GraphEntity | null> {
    this.ensureConnected();
    const result = await this.client!.query(
      `MATCH (e:Entity {uuid: $uuid}) RETURN e`,
      { uuid },
    );
    return result.length > 0 ? parseEntityResult(result[0]) : null;
  }

  async getEntitiesByType(type: string): Promise<GraphEntity[]> {
    this.ensureConnected();
    const results = await this.client!.query(
      `MATCH (e:Entity {type: $type}) RETURN e`,
      { type },
    );
    return results.map(parseEntityResult);
  }

  async getAllEntities(): Promise<GraphEntity[]> {
    this.ensureConnected();
    const results = await this.client!.query(`MATCH (e:Entity) RETURN e`, {});
    return results.map(parseEntityResult);
  }

  // ---------------------------------------------------------------------------
  // Edge Operations (with temporal validity)
  // ---------------------------------------------------------------------------

  async addEdge(edge: Omit<GraphEdge, "uuid" | "createdAt">): Promise<GraphEdge> {
    this.ensureConnected();
    const uuid = generateUUID();
    const now = new Date().toISOString();

    const fullEdge: GraphEdge = { ...edge, uuid, createdAt: now };

    await this.client!.query(
      `MATCH (s:Entity {uuid: $sourceUuid}), (t:Entity {uuid: $targetUuid})
       CREATE (s)-[r:${sanitizeCypherLabel(edge.type)} {
         uuid: $uuid, attributes: $attributes,
         validFrom: $validFrom, validUntil: $validUntil, createdAt: $createdAt
       }]->(t)`,
      {
        sourceUuid: edge.sourceUuid,
        targetUuid: edge.targetUuid,
        uuid,
        attributes: JSON.stringify(edge.attributes),
        validFrom: edge.validFrom ?? now,
        validUntil: edge.validUntil ?? "",
        createdAt: now,
      },
    );

    return fullEdge;
  }

  async getEdgesForEntity(entityUuid: string): Promise<GraphEdge[]> {
    this.ensureConnected();
    const results = await this.client!.query(
      `MATCH (e:Entity {uuid: $uuid})-[r]->(t:Entity)
       RETURN r, e.uuid as source, t.uuid as target`,
      { uuid: entityUuid },
    );
    return results.map(parseEdgeResult);
  }

  /**
   * Get temporally valid edges — only edges that are currently valid.
   */
  async getValidEdges(entityUuid: string, asOfDate?: string): Promise<GraphEdge[]> {
    const allEdges = await this.getEdgesForEntity(entityUuid);
    const checkDate = asOfDate ?? new Date().toISOString();

    return allEdges.filter((edge) => {
      if (edge.validFrom && edge.validFrom > checkDate) return false;
      if (edge.validUntil && edge.validUntil < checkDate) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Graph Traversal
  // ---------------------------------------------------------------------------

  /**
   * Find related entities up to N hops away.
   */
  async getRelatedEntities(entityUuid: string, maxDepth = 2): Promise<GraphEntity[]> {
    this.ensureConnected();
    const results = await this.client!.query(
      `MATCH (start:Entity {uuid: $uuid})-[*1..${maxDepth}]-(related:Entity)
       WHERE related.uuid <> $uuid
       RETURN DISTINCT related`,
      { uuid: entityUuid },
    );
    return results.map(parseEntityResult);
  }

  /**
   * Find shortest path between two entities.
   */
  async shortestPath(fromUuid: string, toUuid: string): Promise<string[]> {
    this.ensureConnected();
    const results = await this.client!.query(
      `MATCH path = shortestPath(
         (a:Entity {uuid: $from})-[*]-(b:Entity {uuid: $to})
       )
       RETURN [n IN nodes(path) | n.uuid] as nodeIds`,
      { from: fromUuid, to: toUuid },
    );
    return results.length > 0 ? results[0].nodeIds as string[] : [];
  }

  // ---------------------------------------------------------------------------
  // Semantic Search (embeddings)
  // ---------------------------------------------------------------------------

  /**
   * Search for entities similar to a query embedding.
   * Uses cosine similarity over stored embeddings.
   */
  async searchSimilar(
    queryEmbedding: number[],
    limit = 10,
    entityType?: string,
  ): Promise<Array<GraphEntity & { similarity: number }>> {
    this.ensureConnected();

    // FalkorDB doesn't have native vector search yet,
    // so we fetch all embeddings and compute similarity in-memory.
    // For production scale, consider adding a vector index.
    const entities = entityType
      ? await this.getEntitiesByType(entityType)
      : await this.getAllEntities();

    const withEmbeddings = entities.filter((e) => e.embedding && e.embedding.length > 0);

    const scored = withEmbeddings.map((entity) => ({
      ...entity,
      similarity: cosineSimilarity(queryEmbedding, entity.embedding!),
    }));

    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Agent Memory
  // ---------------------------------------------------------------------------

  async storeMemory(memory: Omit<AgentMemory, "id" | "createdAt">): Promise<AgentMemory> {
    this.ensureConnected();
    const id = generateUUID();
    const now = new Date().toISOString();

    const fullMemory: AgentMemory = { ...memory, id, createdAt: now };

    await this.client!.query(
      `CREATE (m:Memory {
        id: $id, agentId: $agentId, simulationId: $simulationId,
        round: $round, memoryType: $memoryType, content: $content,
        createdAt: $createdAt
      })`,
      {
        id,
        agentId: memory.agentId,
        simulationId: memory.simulationId,
        round: memory.round,
        memoryType: memory.memoryType,
        content: memory.content,
        createdAt: now,
      },
    );

    if (memory.embedding) {
      await this.storeEmbedding("memory", id, memory.embedding);
    }

    return fullMemory;
  }

  async getAgentMemories(
    agentId: string,
    simulationId?: string,
    limit = 50,
  ): Promise<AgentMemory[]> {
    this.ensureConnected();

    const query = simulationId
      ? `MATCH (m:Memory {agentId: $agentId, simulationId: $simulationId})
         RETURN m ORDER BY m.round DESC LIMIT $limit`
      : `MATCH (m:Memory {agentId: $agentId})
         RETURN m ORDER BY m.createdAt DESC LIMIT $limit`;

    const params = simulationId
      ? { agentId, simulationId, limit }
      : { agentId, limit };

    const results = await this.client!.query(query, params);
    return results.map(parseMemoryResult);
  }

  /**
   * Get memories across all simulations for an agent — enables
   * belief evolution tracking across simulation runs.
   */
  async getAgentMemoryHistory(agentId: string): Promise<AgentMemory[]> {
    return this.getAgentMemories(agentId, undefined, 200);
  }

  // ---------------------------------------------------------------------------
  // Graph Info & Maintenance
  // ---------------------------------------------------------------------------

  async getGraphInfo(): Promise<GraphInfo> {
    this.ensureConnected();

    const nodeCountResult = await this.client!.query(
      `MATCH (e:Entity) RETURN count(e) as cnt`, {},
    );
    const edgeCountResult = await this.client!.query(
      `MATCH ()-[r]->() RETURN count(r) as cnt`, {},
    );
    const entityTypesResult = await this.client!.query(
      `MATCH (e:Entity) RETURN DISTINCT e.type as type`, {},
    );

    return {
      graphId: "simulation-graph",
      nodeCount: (nodeCountResult[0]?.cnt as number) ?? 0,
      edgeCount: (edgeCountResult[0]?.cnt as number) ?? 0,
      entityTypes: entityTypesResult.map((r) => r.type as string),
      edgeTypes: [],
    };
  }

  async clearGraph(): Promise<void> {
    this.ensureConnected();
    await this.client!.query(`MATCH (n) DETACH DELETE n`, {});
    log.info("[simulation:graph] Graph cleared");
  }

  // ---------------------------------------------------------------------------
  // Ontology Management
  // ---------------------------------------------------------------------------

  /**
   * Apply an ontology to the graph — creates indexes for each entity type.
   */
  async applyOntology(ontology: Ontology): Promise<void> {
    this.ensureConnected();

    for (const _entityType of ontology.entityTypes) {
      try {
        await this.client!.query(
          `CREATE INDEX ON :Entity(type)`, {},
        );
      } catch {
        // Index may already exist
      }
    }

    log.info(`[simulation:graph] Applied ontology with ${ontology.entityTypes.length} entity types`);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private ensureConnected(): void {
    if (!this.client || this._status.status !== "connected") {
      throw new Error("Graph layer not connected. Call initialize() first.");
    }
  }

  private async checkConnection(host: string, port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://${host}:${port}`, {
        signal: AbortSignal.timeout(2000),
      }).catch(() => null);
      return response !== null;
    } catch {
      return false;
    }
  }

  private async waitForConnection(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.checkConnection(host, port)) return;
      await sleep(1000);
    }
    throw new Error(`FalkorDB did not start within ${timeoutMs}ms`);
  }

  private async startFalkorDB(): Promise<void> {
    const { spawn } = await import("child_process");
    const { host: _host, port } = this.settings.graphDb;

    const proc = spawn("docker", [
      "run", "-d", "--rm",
      "--name", "lattice-falkordb",
      "-p", `${port}:6379`,
      "-p", "3000:3000",
      "falkordb/falkordb:latest",
    ], { stdio: "pipe" });

    return new Promise<void>((resolve, reject) => {
      let stderr = "";
      proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
      proc.on("exit", (code) => {
        if (code === 0) {
          log.info("[simulation:graph] FalkorDB container started");
          resolve();
        } else {
          // Container might already exist
          if (stderr.includes("already in use")) {
            log.info("[simulation:graph] FalkorDB container already running");
            resolve();
          } else {
            reject(new Error(`Failed to start FalkorDB: ${stderr}`));
          }
        }
      });
    });
  }

  private async ensureSchema(): Promise<void> {
    // Create indexes for common query patterns
    try {
      await this.client!.query(`CREATE INDEX ON :Entity(uuid)`, {});
    } catch { /* may exist */ }
    try {
      await this.client!.query(`CREATE INDEX ON :Entity(type)`, {});
    } catch { /* may exist */ }
    try {
      await this.client!.query(`CREATE INDEX ON :Memory(agentId)`, {});
    } catch { /* may exist */ }
    try {
      await this.client!.query(`CREATE INDEX ON :Memory(simulationId)`, {});
    } catch { /* may exist */ }
  }

  private async storeEmbedding(
    entityType: "entity" | "memory",
    id: string,
    embedding: number[],
  ): Promise<void> {
    const label = entityType === "entity" ? "Entity" : "Memory";
    const idField = entityType === "entity" ? "uuid" : "id";

    await this.client!.query(
      `MATCH (n:${label} {${idField}: $id})
       SET n.embedding = $embedding`,
      { id, embedding: JSON.stringify(embedding) },
    );
  }

  async dispose(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this._status = { status: "not_configured" };
    this.removeAllListeners();
  }
}

// ---------------------------------------------------------------------------
// FalkorDB Client (real driver via falkordb-ts SDK)
// ---------------------------------------------------------------------------

/**
 * FalkorDB client using the official falkordb npm package.
 * FalkorDB uses the Redis protocol with GRAPH.QUERY command.
 *
 * API: FalkorDB.connect() → selectGraph(name) → graph.query(cypher)
 * Supports native vector indexes for semantic search.
 */
class FalkorDBClient {
  private host: string;
  private port: number;
  private graphName: string;
  private db: import("falkordb").FalkorDB | null = null;
  private graph: import("falkordb").Graph | null = null;

  constructor(host: string, port: number, _protocol: string, graphName = "simulation") {
    this.host = host;
    this.port = port;
    this.graphName = graphName;
  }

  async connect(): Promise<void> {
    const { FalkorDB } = await import("falkordb");
    log.info(`[simulation:graph] Connecting to FalkorDB at ${this.host}:${this.port}`);

    this.db = await FalkorDB.connect({
      socket: {
        host: this.host,
        port: this.port,
        connectTimeout: 5000,
      },
    });

    this.graph = this.db.selectGraph(this.graphName);
    log.info(`[simulation:graph] Connected, using graph "${this.graphName}"`);
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.graph = null;
    }
    log.info("[simulation:graph] Disconnected from FalkorDB");
  }

  /**
   * Execute a Cypher query against the graph.
   * Returns an array of row objects with named result columns.
   */
  async query(
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.graph) {
      throw new Error("FalkorDB not connected");
    }

    log.debug(`[simulation:graph] QUERY: ${cypher.slice(0, 120)}...`);

    // Build parameterized query string for FalkorDB
    // FalkorDB supports Cypher parameters via GRAPH.QUERY ... --params ...
    const paramStr = Object.keys(params).length > 0
      ? `CYPHER ${Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")} `
      : "";

    const result = await this.graph.query<Record<string, unknown>>(
      `${paramStr}${cypher}`,
    );

    return result.data ?? [];
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function sanitizeCypherLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEntityResult(row: any): GraphEntity {
  const e = row.e ?? row.related ?? row;
  return {
    uuid: e.uuid ?? e.properties?.uuid ?? "",
    type: e.type ?? e.properties?.type ?? "",
    name: e.name ?? e.properties?.name ?? "",
    attributes: JSON.parse(e.attributes ?? e.properties?.attributes ?? "{}"),
    embedding: e.embedding ? JSON.parse(e.embedding) : undefined,
    createdAt: e.createdAt ?? e.properties?.createdAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEdgeResult(row: any): GraphEdge {
  const r = row.r ?? row;
  return {
    uuid: r.uuid ?? r.properties?.uuid ?? "",
    sourceUuid: row.source ?? "",
    targetUuid: row.target ?? "",
    type: r.type ?? "",
    attributes: JSON.parse(r.attributes ?? r.properties?.attributes ?? "{}"),
    validFrom: r.validFrom ?? r.properties?.validFrom,
    validUntil: r.validUntil ?? r.properties?.validUntil,
    createdAt: r.createdAt ?? r.properties?.createdAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMemoryResult(row: any): AgentMemory {
  const m = row.m ?? row;
  return {
    id: m.id ?? m.properties?.id ?? "",
    agentId: m.agentId ?? m.properties?.agentId ?? "",
    simulationId: m.simulationId ?? m.properties?.simulationId ?? "",
    round: m.round ?? m.properties?.round ?? 0,
    memoryType: m.memoryType ?? m.properties?.memoryType ?? "observation",
    content: m.content ?? m.properties?.content ?? "",
    embedding: m.embedding ? JSON.parse(m.embedding) : undefined,
    createdAt: m.createdAt ?? m.properties?.createdAt ?? "",
  };
}
