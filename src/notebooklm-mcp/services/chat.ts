/**
 * Chat service — query notebooks and manage conversations.
 */

import type { BaseClient } from "../client/base";
import type { QueryResult } from "../client/types";

export class ChatService {
  constructor(private readonly client: BaseClient) {}

  async query(
    notebookId: string,
    queryText: string,
    opts?: {
      sourceIds?: string[];
      conversationId?: string;
      timeout?: number;
    },
  ): Promise<QueryResult> {
    const result = await this.client.streamQuery(notebookId, queryText, opts);
    return {
      answer: result.answer,
      citedSourceIds: result.citedSourceIds,
      conversationId: null,
    };
  }

  clearConversation(): void {
    this.client.clearConversation();
  }

  getHistory(): Array<{ query: string; answer: string }> {
    return this.client.getConversationHistory();
  }
}
