/**
 * Types for GitHub issues and PRs displayed in the Issues tab.
 * Data is fetched via `gh issue list` and `gh pr list` CLI commands
 * through the minion's git context (auto-detects the repo).
 */

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubActor {
  login: string;
}

/** Unified type for both issues and PRs in the Issues tab. */
export interface GitHubIssueItem {
  /** Discriminator: "issue" or "pr" */
  type: "issue" | "pr";
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  headRefName?: string;
  labels: GitHubLabel[];
  assignees: GitHubActor[];
  author: GitHubActor;
  createdAt: string;
}
