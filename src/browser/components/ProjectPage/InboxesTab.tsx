import React, { useState, useEffect } from "react";
import {
  Inbox,
  MessageCircle,
  Send,
  Hash,
  Phone,
  Radio,
  Wifi,
  WifiOff,
  ArrowLeft,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import {
  getInboxChannelFilterKey,
  getInboxSelectedConversationKey,
} from "@/common/constants/storage";
import { cn } from "@/common/lib/utils";
import type { InboxChannelId, InboxConversation, InboxMessage } from "@/common/types/inbox";
import { INBOX_CHANNELS, INBOX_CHANNEL_LABELS } from "@/common/types/inbox";

// ---------------------------------------------------------------------------
// Channel icon mapping — SVG icons only, no emoji (per CLAUDE.md)
// ---------------------------------------------------------------------------

const CHANNEL_ICONS: Record<InboxChannelId, React.FC<{ className?: string }>> = {
  telegram: Send,
  whatsapp: Phone,
  discord: Hash,
  irc: Hash,
  googlechat: MessageCircle,
  slack: Hash,
  signal: Radio,
  imessage: MessageCircle,
};

// ---------------------------------------------------------------------------
// Conversation summary (without messages) from list API
// ---------------------------------------------------------------------------

type ConversationSummary = Omit<InboxConversation, "messages">;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AdapterStatus {
  channel: string;
  status: string;
  description?: string | null;
  error?: string | null;
}

function ConnectionBanner(props: { adapters: AdapterStatus[] }) {
  if (props.adapters.length === 0) {
    return (
      <div className="flex items-center gap-2 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-400">
        <WifiOff className="h-3 w-3" />
        No channel adapters configured — add telegramBotToken to ~/.lattice/config.json
      </div>
    );
  }

  return (
    <div className="border-border-light flex flex-wrap items-center gap-3 border-b px-3 py-1.5 text-xs">
      {props.adapters.map((adapter) => {
        const isConnected = adapter.status === "connected";
        const isError = adapter.status === "error";
        return (
          <div
            key={adapter.channel}
            className={cn(
              "flex items-center gap-1",
              isConnected
                ? "text-green-400"
                : isError
                  ? "text-red-400"
                  : "text-yellow-400",
            )}
          >
            {isConnected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            <span className="capitalize">{adapter.channel}</span>
            {adapter.description && (
              <span className="text-muted">({adapter.description})</span>
            )}
            {adapter.error && (
              <span className="text-red-400/70">{adapter.error}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChannelFilterBar(props: {
  active: InboxChannelId | null;
  onChange: (channel: InboxChannelId | null) => void;
  counts: Map<InboxChannelId, number>;
}) {
  return (
    <div className="border-border-light flex items-center gap-1 border-b px-3 py-1.5">
      <button
        type="button"
        onClick={() => props.onChange(null)}
        className={cn(
          "rounded px-2 py-0.5 text-xs transition-colors",
          props.active === null
            ? "bg-accent/20 text-foreground"
            : "text-muted hover:text-foreground",
        )}
      >
        All
      </button>
      {INBOX_CHANNELS.map((ch) => {
        const count = props.counts.get(ch) ?? 0;
        if (count === 0) return null;
        const Icon = CHANNEL_ICONS[ch];
        return (
          <button
            key={ch}
            type="button"
            onClick={() => props.onChange(ch)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors",
              props.active === ch
                ? "bg-accent/20 text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            {INBOX_CHANNEL_LABELS[ch]}
            <span className="text-muted">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

function ConversationList(props: {
  conversations: ConversationSummary[];
  selectedKey: string | null;
  onSelect: (sessionKey: string) => void;
}) {
  if (props.conversations.length === 0) {
    return (
      <div className="text-muted flex flex-1 items-center justify-center">
        <div className="text-center">
          <Inbox className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No conversations yet.</p>
          <p className="mt-1 text-xs opacity-70">
            Messages from connected channels will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {props.conversations.map((convo) => {
        const Icon = CHANNEL_ICONS[convo.channel];
        const isSelected = convo.sessionKey === props.selectedKey;
        return (
          <button
            key={convo.sessionKey}
            type="button"
            onClick={() => props.onSelect(convo.sessionKey)}
            className={cn(
              "border-border-light flex w-full items-start gap-2 border-b px-3 py-2 text-left transition-colors",
              isSelected ? "bg-accent/10" : "hover:bg-sidebar-hover",
            )}
          >
            <Icon className="text-muted mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-foreground truncate text-xs font-medium">
                  {convo.displayName}
                </span>
                {convo.unreadCount > 0 && (
                  <span className="bg-accent shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {convo.unreadCount}
                  </span>
                )}
              </div>
              <div className="text-muted flex items-center gap-1 text-[10px]">
                <span>{INBOX_CHANNEL_LABELS[convo.channel]}</span>
                <span>&middot;</span>
                <span>{convo.chatType}</span>
                <span>&middot;</span>
                <StatusIndicator status={convo.status} />
              </div>
              <p className="text-muted mt-0.5 text-[10px] opacity-70">
                {formatTimestamp(convo.lastActivityAt)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function StatusIndicator(props: { status: string }) {
  const colors: Record<string, string> = {
    unread: "text-blue-400",
    processing: "text-yellow-400",
    replied: "text-green-400",
    errored: "text-red-400",
    archived: "text-muted",
  };
  return (
    <span className={cn("capitalize", colors[props.status] ?? "text-muted")}>
      {props.status}
    </span>
  );
}

function ConversationDetail(props: {
  projectPath: string;
  sessionKey: string;
  onBack: () => void;
}) {
  const { api } = useAPI();
  const [convo, setConvo] = useState<InboxConversation | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    api.inbox
      .getConversation({
        projectPath: props.projectPath,
        sessionKey: props.sessionKey,
      })
      .then((result) => {
        if (!cancelled) setConvo(result);
      })
      .catch(() => {
        if (!cancelled) setConvo(null);
      });

    return () => {
      cancelled = true;
    };
  }, [api, props.projectPath, props.sessionKey]);

  const handleSendReply = async () => {
    if (!api || !replyText.trim() || sending) return;
    setSending(true);
    try {
      await api.inbox.sendReply({
        projectPath: props.projectPath,
        sessionKey: props.sessionKey,
        message: replyText.trim(),
      });
      setReplyText("");
      // Refresh conversation
      const updated = await api.inbox.getConversation({
        projectPath: props.projectPath,
        sessionKey: props.sessionKey,
      });
      setConvo(updated);
    } catch (err) {
      console.error("Failed to send reply:", err);
    } finally {
      setSending(false);
    }
  };

  if (!convo) {
    return (
      <div className="text-muted flex flex-1 items-center justify-center">
        <p className="text-sm">Loading conversation...</p>
      </div>
    );
  }

  const Icon = CHANNEL_ICONS[convo.channel];

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-border-light flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={props.onBack}
          className="text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Icon className="text-muted h-4 w-4" />
        <span className="text-foreground text-xs font-medium">
          {convo.displayName}
        </span>
        <span className="text-muted text-[10px]">
          {INBOX_CHANNEL_LABELS[convo.channel]} &middot; {convo.chatType}
        </span>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {convo.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Reply input */}
      <div className="border-border-light flex items-center gap-2 border-t px-3 py-2">
        <input
          type="text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSendReply();
            }
          }}
          placeholder="Send a reply..."
          className="bg-sidebar text-foreground min-w-0 flex-1 rounded px-2 py-1 text-xs outline-none"
          disabled={sending}
        />
        <button
          type="button"
          onClick={() => void handleSendReply()}
          disabled={!replyText.trim() || sending}
          className="text-muted hover:text-foreground disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MessageBubble(props: { message: InboxMessage }) {
  const msg = props.message;
  const isOutbound = msg.direction === "outbound";

  return (
    <div
      className={cn("mb-2 flex", isOutbound ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-1.5",
          isOutbound
            ? "bg-accent/20 text-foreground"
            : "bg-sidebar text-foreground",
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-muted text-[10px] font-medium">
            {msg.senderName}
          </span>
          <span className="text-muted text-[9px] opacity-60">
            {formatTimestamp(msg.timestamp)}
          </span>
        </div>
        <p className="mt-0.5 text-xs whitespace-pre-wrap">{msg.body}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface InboxesTabProps {
  projectPath: string;
}

export function InboxesTab(props: InboxesTabProps) {
  const { api } = useAPI();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [channelFilter, setChannelFilter] =
    usePersistedState<InboxChannelId | null>(
      getInboxChannelFilterKey(props.projectPath),
      null,
    );
  const [selectedSession, setSelectedSession] = usePersistedState<string | null>(
    getInboxSelectedConversationKey(props.projectPath),
    null,
  );
  const [adapterStatuses, setAdapterStatuses] = useState<AdapterStatus[]>([]);

  // Subscribe to inbox updates (same pattern as KanbanBoard)
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const abortController = new AbortController();

    async function subscribe() {
      try {
        const stream = await api!.inbox.subscribe(
          { projectPath: props.projectPath },
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setConversations(snapshot);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("InboxesTab: subscription error:", err);
        }
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api, props.projectPath]);

  // Fetch connection status for all adapters
  useEffect(() => {
    if (!api) return;
    api.inbox.connectionStatus().then((result) => {
      setAdapterStatuses(result.adapters);
    }).catch(() => {
      // Ignore — not connected
    });
  }, [api]);

  // Compute channel counts for filter bar
  const channelCounts = new Map<InboxChannelId, number>();
  for (const convo of conversations) {
    channelCounts.set(convo.channel, (channelCounts.get(convo.channel) ?? 0) + 1);
  }

  // Filter conversations by selected channel
  const filtered = channelFilter
    ? conversations.filter((c) => c.channel === channelFilter)
    : conversations;

  // If a conversation is selected, show the detail view
  if (selectedSession) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ConnectionBanner adapters={adapterStatuses} />
        <ConversationDetail
          projectPath={props.projectPath}
          sessionKey={selectedSession}
          onBack={() => setSelectedSession(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConnectionBanner adapters={adapterStatuses} />
      <ChannelFilterBar
        active={channelFilter}
        onChange={setChannelFilter}
        counts={channelCounts}
      />
      <ConversationList
        conversations={filtered}
        selectedKey={selectedSession}
        onSelect={setSelectedSession}
      />
    </div>
  );
}
