/**
 * AgentChatPanel — MiroFish-style post-simulation dialogue with any agent.
 *
 * Slide-out panel that lets users click a simulated agent and have a
 * conversation to understand their reasoning, beliefs, and motivations.
 */

import React, { useState, useRef, useEffect } from "react";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import type { AgentChatMessage } from "./useSimulation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function formatAgentName(name: string): string {
  return name
    .replace(/^stat_/, "")
    .replace(/_[a-z0-9]{4,}$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDetail {
  id: string;
  name: string;
  actions: Array<{
    round: number;
    actionType: string;
    content?: string;
    target?: string;
    platform?: string;
    thinking?: string;
    timestamp?: string;
  }>;
  actionCounts: Record<string, number>;
  totalActions: number;
}

interface AgentChatPanelProps {
  agent: AgentDetail;
  scenarioId: string;
  messages: AgentChatMessage[];
  sending: boolean;
  onSend: (scenarioId: string, agentId: string, message: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  agent,
  scenarioId,
  messages,
  sending,
  onSend,
  onClose,
}) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    onSend(scenarioId, agent.id, msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayName = formatAgentName(agent.name);
  const initials = agent.name.replace(/^stat_/, "").slice(0, 2).toUpperCase();
  const avatarColor = agentAvatarColor(agent.name);

  // Determine agent type from name pattern
  const agentType = agent.name
    .replace(/^stat_/, "")
    .replace(/_[a-z0-9]{4,}$/, "")
    .replace(/_/g, " ");

  // Sentiment from action types
  const sentimentScore = (() => {
    let score = 0;
    for (const a of agent.actions) {
      if (a.actionType === "UPVOTE" || a.actionType === "VOTE_FOR") score += 1;
      if (a.actionType === "DOWNVOTE" || a.actionType === "VOTE_AGAINST") score -= 1;
    }
    if (agent.totalActions === 0) return "neutral";
    const avg = score / agent.totalActions;
    if (avg > 0.1) return "positive";
    if (avg < -0.1) return "negative";
    return "neutral";
  })();

  const sentimentColor =
    sentimentScore === "positive"
      ? "text-emerald-400"
      : sentimentScore === "negative"
        ? "text-red-400"
        : "text-amber-400";

  const sentimentLabel =
    sentimentScore === "positive"
      ? "Positive"
      : sentimentScore === "negative"
        ? "Negative"
        : "Neutral";

  return (
    <div className="w-[380px] shrink-0 border-l border-border flex flex-col bg-[#0f1419] h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between bg-card/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ backgroundColor: avatarColor }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold truncate">{displayName}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary/80 font-medium">
                {agentType}
              </span>
              <span className={`text-[9px] ${sentimentColor}`}>
                {sentimentLabel}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Agent profile summary */}
      <div className="px-3 py-2 border-b border-border/40 space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {Object.entries(agent.actionCounts)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 6)
            .map(([type, count]) => (
              <span
                key={type}
                className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-foreground/70"
              >
                {type} <span className="font-semibold">{count as number}</span>
              </span>
            ))}
        </div>
        <div className="text-[9px] text-muted-foreground/50">
          {agent.totalActions} actions across {Object.keys(agent.actionCounts).length} types
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground/20 mb-3" />
            <div className="text-[11px] text-muted-foreground/40 mb-1">
              Chat with {displayName}
            </div>
            <div className="text-[10px] text-muted-foreground/25 leading-relaxed">
              Ask about their reasoning, beliefs, or what they would do differently.
              The agent will respond in character based on their simulation persona.
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary/20 text-foreground/90"
                  : "bg-muted/30 text-foreground/80 border border-border/30"
              }`}
            >
              {msg.role === "agent" && (
                <div className="flex items-center gap-1.5 mb-1">
                  <div
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[6px] font-bold text-white shrink-0"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {initials}
                  </div>
                  <span className="text-[9px] font-semibold text-foreground/60">
                    {displayName}
                  </span>
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 bg-muted/30 border border-border/30">
              <div className="flex items-center gap-1.5 mb-1">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[6px] font-bold text-white shrink-0"
                  style={{ backgroundColor: avatarColor }}
                >
                  {initials}
                </div>
                <span className="text-[9px] font-semibold text-foreground/60">
                  {displayName}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-border bg-card/30">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask ${displayName}...`}
            disabled={sending}
            className="flex-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="p-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
