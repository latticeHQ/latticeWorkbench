// Bun test file - agent-only architecture
// SDK helper tests (normalizeAnthropicBaseURL, buildAnthropicHeaders, etc.) removed
// as those functions no longer exist in the agents-only architecture.

import { describe, it, expect, beforeEach } from "bun:test";
import { AIService } from "./aiService";
import { HistoryService } from "./historyService";
import { PartialService } from "./partialService";
import { InitStateManager } from "./initStateManager";
import { Config } from "@/node/config";

describe("AIService", () => {
  let service: AIService;

  beforeEach(() => {
    const config = new Config();
    const historyService = new HistoryService(config);
    const partialService = new PartialService(config, historyService);
    const initStateManager = new InitStateManager(config);
    service = new AIService(config, historyService, partialService, initStateManager);
  });

  it("should create an AIService instance", () => {
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AIService);
  });
});
