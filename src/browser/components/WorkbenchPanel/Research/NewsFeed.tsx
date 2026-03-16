/**
 * Financial news feed — displays latest news from OpenBB.
 * Bloomberg-style compact list with source attribution.
 */

import React from "react";
import type { NewsItem } from "./useOpenBB";
import { cn } from "@/common/lib/utils";

interface NewsFeedProps {
  data: NewsItem[] | null;
  loading: boolean;
  error: string | null;
}

export const NewsFeed: React.FC<NewsFeedProps> = ({ data, loading, error }) => {
  if (error) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-neutral-500">
        News feed unavailable
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse space-y-1">
            <div className="h-3 w-3/4 rounded bg-neutral-800" />
            <div className="h-2 w-1/3 rounded bg-neutral-800" />
          </div>
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-neutral-500">
        No news found
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {data.map((item, i) => (
        <a
          key={`${item.url}-${i}`}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block border-b border-neutral-800/50 px-2 py-1.5 transition-colors",
            "hover:bg-neutral-800/30"
          )}
        >
          <div className="text-xs leading-tight text-neutral-200">{item.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-neutral-500">
            <span className="font-medium text-[#00ACFF]">{item.source}</span>
            {item.date && (
              <span>{new Date(item.date).toLocaleDateString()}</span>
            )}
            {item.symbols && item.symbols.length > 0 && (
              <span className="text-neutral-400">
                {item.symbols.map((s) => `$${s}`).join(" ")}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  );
};
