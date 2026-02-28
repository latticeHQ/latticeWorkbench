import { useEffect, useRef, useState } from "react";
import {
  CircleDot,
  GitMerge,
  GitPullRequest,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import type { GitHubIssueItem, GitHubLabel } from "@/common/types/issues";
import { cn } from "@/common/lib/utils";

// How long ago a date was, in compact form
function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** State badge for an issue or PR. */
function StateBadge(props: { item: GitHubIssueItem }) {
  const { type, state, isDraft } = props.item;

  if (type === "pr") {
    if (state === "MERGED") {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: "color-mix(in srgb, var(--color-purple, #8b5cf6), transparent 85%)", color: "var(--color-purple, #8b5cf6)" }}>
          <GitMerge className="h-2.5 w-2.5" />
          Merged
        </span>
      );
    }
    if (isDraft) {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: "color-mix(in srgb, var(--color-muted), transparent 85%)", color: "var(--color-muted)" }}>
          <GitPullRequest className="h-2.5 w-2.5" />
          Draft
        </span>
      );
    }
    if (state === "OPEN") {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: "color-mix(in srgb, var(--color-success), transparent 85%)", color: "var(--color-success)" }}>
          <GitPullRequest className="h-2.5 w-2.5" />
          Open
        </span>
      );
    }
    // CLOSED (not merged)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        style={{ background: "color-mix(in srgb, var(--color-danger, #ef4444), transparent 85%)", color: "var(--color-danger, #ef4444)" }}>
        <GitPullRequest className="h-2.5 w-2.5" />
        Closed
      </span>
    );
  }

  // Issue
  if (state === "OPEN") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        style={{ background: "color-mix(in srgb, var(--color-success), transparent 85%)", color: "var(--color-success)" }}>
        <CircleDot className="h-2.5 w-2.5" />
        Open
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: "color-mix(in srgb, var(--color-purple, #8b5cf6), transparent 85%)", color: "var(--color-purple, #8b5cf6)" }}>
      <CircleDot className="h-2.5 w-2.5" />
      Closed
    </span>
  );
}

/** Colored label chip matching GitHub's label colors. */
function LabelChip(props: { label: GitHubLabel }) {
  // gh CLI returns colors without # prefix
  const hex = props.label.color.startsWith("#") ? props.label.color : `#${props.label.color}`;
  return (
    <span
      className="inline-block max-w-[80px] truncate rounded-full px-1.5 py-px text-[9px] leading-[1.4] font-medium"
      style={{
        background: `${hex}30`,
        color: hex,
        border: `1px solid ${hex}50`,
      }}
      title={props.label.name}
    >
      {props.label.name}
    </span>
  );
}

/** Single issue/PR card. */
function IssueCard(props: { item: GitHubIssueItem }) {
  const item = props.item;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border transition-colors hover:border-[var(--color-accent)]"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Header row: number + state badge + time */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{
          background: "color-mix(in srgb, var(--color-bg-secondary), transparent 40%)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]">
          #{item.number}
        </span>
        <StateBadge item={item} />
        <span className="ml-auto shrink-0 text-[10px] text-[var(--color-dim)]">
          {timeAgo(item.createdAt)}
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 text-[var(--color-dim)] opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* Title + labels + meta */}
      <div className="px-3 py-2">
        <div className="text-[11px] leading-[1.4] text-[var(--color-text)]" title={item.title}>
          {item.title}
        </div>

        {/* Branch name for PRs */}
        {item.headRefName && (
          <div className="mt-1 truncate font-mono text-[10px] text-[var(--color-dim)]">
            {item.headRefName}
          </div>
        )}

        {/* Labels + author */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {item.labels.slice(0, 4).map((label) => (
            <LabelChip key={label.name} label={label} />
          ))}
          {item.labels.length > 4 && (
            <span className="text-[9px] text-[var(--color-dim)]">+{item.labels.length - 4}</span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-[var(--color-dim)]">
            {item.author.login}
          </span>
        </div>
      </div>
    </a>
  );
}

/** Parse `gh issue list` JSON output into GitHubIssueItem[]. */
function parseIssues(output: string): GitHubIssueItem[] {
  try {
    const raw = JSON.parse(output) as Array<Record<string, unknown>>;
    return raw.map((r) => ({
      type: "issue" as const,
      number: r.number as number,
      url: r.url as string,
      title: r.title as string,
      state: (r.state as string).toUpperCase() as GitHubIssueItem["state"],
      labels: (r.labels as GitHubLabel[]) ?? [],
      assignees: (r.assignees as GitHubIssueItem["assignees"]) ?? [],
      author: (r.author as GitHubIssueItem["author"]) ?? { login: "unknown" },
      createdAt: r.createdAt as string,
    }));
  } catch {
    return [];
  }
}

/** Parse `gh pr list` JSON output into GitHubIssueItem[]. */
function parsePRs(output: string): GitHubIssueItem[] {
  try {
    const raw = JSON.parse(output) as Array<Record<string, unknown>>;
    return raw.map((r) => ({
      type: "pr" as const,
      number: r.number as number,
      url: r.url as string,
      title: r.title as string,
      state: (r.state as string).toUpperCase() as GitHubIssueItem["state"],
      isDraft: (r.isDraft as boolean) ?? false,
      headRefName: (r.headRefName as string) ?? undefined,
      labels: (r.labels as GitHubLabel[]) ?? [],
      assignees: (r.assignees as GitHubIssueItem["assignees"]) ?? [],
      author: (r.author as GitHubIssueItem["author"]) ?? { login: "unknown" },
      createdAt: r.createdAt as string,
    }));
  } catch {
    return [];
  }
}

interface IssuesTabProps {
  minionId: string;
}

export function IssuesTab(props: IssuesTabProps) {
  const { api } = useAPI();
  const [issues, setIssues] = useState<GitHubIssueItem[]>([]);
  const [prs, setPrs] = useState<GitHubIssueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch issues and PRs from the minion's git repo via gh CLI.
  // Stored in a ref so the effect + refresh button always call the latest version.
  const fetchRef = useRef<(isRefresh?: boolean) => Promise<void>>();
  fetchRef.current = async (isRefresh = false) => {
    if (!api) return;

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Fetch issues and PRs in parallel — gh CLI auto-detects repo from minion git context
      const [issueResult, prResult] = await Promise.all([
        api.minion.executeBash({
          minionId: props.minionId,
          script: `gh issue list --json number,url,title,state,labels,assignees,createdAt,author --limit 30 2>/dev/null || echo '[]'`,
          options: { timeout_secs: 15 },
        }),
        api.minion.executeBash({
          minionId: props.minionId,
          script: `gh pr list --json number,url,title,state,isDraft,headRefName,labels,assignees,createdAt,author --limit 20 2>/dev/null || echo '[]'`,
          options: { timeout_secs: 15 },
        }),
      ]);

      // Parse issue results
      if (issueResult.success && issueResult.data.success && issueResult.data.output) {
        setIssues(parseIssues(issueResult.data.output));
      } else {
        setIssues([]);
      }

      // Parse PR results
      if (prResult.success && prResult.data.success && prResult.data.output) {
        setPrs(parsePRs(prResult.data.output));
      } else {
        setPrs([]);
      }

      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch issues";
      // Detect common failure modes
      if (message.includes("gh") || message.includes("command not found")) {
        setError("gh CLI not available — install GitHub CLI to use this tab");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch on mount and refresh on window focus
  useEffect(() => {
    if (!api) return;

    void fetchRef.current?.();

    const handleFocus = () => {
      void fetchRef.current?.(true);
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [api, props.minionId]);

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--color-muted)]" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <AlertCircle className="text-[var(--color-danger, #ef4444)] h-8 w-8 opacity-50" />
        <p className="max-w-[200px] text-center text-xs text-[var(--color-muted)]">{error}</p>
      </div>
    );
  }

  // Empty state
  if (issues.length === 0 && prs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <CircleDot className="h-8 w-8 text-[var(--color-muted)] opacity-30" />
        <p className="text-xs text-[var(--color-muted)]">No open issues or PRs</p>
        <p className="max-w-[200px] text-center text-[10px] text-[var(--color-dim)]">
          Issues and pull requests from this repo will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Summary header with refresh button */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] tracking-wider text-[var(--color-muted)]">
        {prs.length > 0 && (
          <span>
            {prs.length} PR{prs.length !== 1 ? "s" : ""}
          </span>
        )}
        {issues.length > 0 && (
          <span>
            {issues.length} issue{issues.length !== 1 ? "s" : ""}
          </span>
        )}
        <button
          type="button"
          className="ml-auto rounded p-0.5 text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
          onClick={() => void fetchRef.current?.(true)}
          disabled={refreshing}
          aria-label="Refresh issues"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* Cards list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {/* PRs first, then issues */}
        {prs.map((pr) => (
          <IssueCard key={`pr-${pr.number}`} item={pr} />
        ))}
        {issues.map((issue) => (
          <IssueCard key={`issue-${issue.number}`} item={issue} />
        ))}
      </div>
    </div>
  );
}
