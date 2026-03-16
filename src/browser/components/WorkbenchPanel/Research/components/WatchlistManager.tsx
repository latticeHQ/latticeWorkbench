/**
 * WatchlistManager — UI for adding/removing symbols from the watchlist.
 *
 * Renders inline in the Dashboard watchlist header area.
 * Bloomberg terminal aesthetic: dark, monospace, compact.
 */

import React, { useState } from "react";
import { Plus, X, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { useResearch } from "../ResearchContext";

export const WatchlistManager: React.FC = () => {
  const { watchlist, addToWatchlist, removeFromWatchlist } = useResearch();
  const [expanded, setExpanded] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    addToWatchlist(sym, newName.trim() || undefined);
    setNewSymbol("");
    setNewName("");
  };

  const symbols = Object.entries(watchlist);

  return (
    <div className="border-b border-neutral-800">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500 transition-colors hover:text-neutral-300"
      >
        <Settings className="h-3 w-3" />
        <span>Manage Watchlist</span>
        <span className="ml-auto text-neutral-600">{symbols.length}</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="border-t border-neutral-800/50 px-2 pb-2">
          {/* Add form */}
          <form onSubmit={handleAdd} className="mt-1.5 flex items-center gap-1">
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="AAPL"
              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] font-mono text-white placeholder-neutral-600 focus:border-[#00ACFF] focus:outline-none"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (optional)"
              className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-white placeholder-neutral-600 focus:border-[#00ACFF] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newSymbol.trim()}
              className="inline-flex items-center gap-0.5 rounded bg-[#00ACFF] px-1.5 py-0.5 text-[10px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <Plus className="h-2.5 w-2.5" />
              Add
            </button>
          </form>

          {/* Symbol list */}
          <div className="mt-1.5 max-h-40 overflow-auto">
            {symbols.map(([sym, name]) => (
              <div
                key={sym}
                className="group flex items-center justify-between rounded px-1.5 py-0.5 transition-colors hover:bg-neutral-800/50"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-mono text-[10px] font-bold text-[#00ACFF]">{sym}</span>
                  <span className="truncate text-[10px] text-neutral-500">{name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromWatchlist(sym)}
                  className="ml-1 shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition-all hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 group-hover:opacity-100"
                  title={`Remove ${sym}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
