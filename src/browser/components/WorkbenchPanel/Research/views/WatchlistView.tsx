/**
 * WatchlistView — Full-page watchlist manager.
 *
 * Add/remove symbols, see your entire watchlist at a glance.
 * Persisted to localStorage via ResearchContext.
 */

import React, { useState } from "react";
import { Plus, X, RotateCcw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { DEFAULT_WATCHLIST } from "../useOpenBB";

interface WatchlistViewProps {
  baseUrl: string;
}

export const WatchlistView: React.FC<WatchlistViewProps> = () => {
  const { watchlist, addToWatchlist, removeFromWatchlist, setWatchlist, setActiveSymbol, setActiveView } = useResearch();
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    addToWatchlist(sym, newName.trim() || undefined);
    setNewSymbol("");
    setNewName("");
  };

  const handleBulkImport = () => {
    const lines = bulkInput.split("\n").map((l) => l.trim()).filter(Boolean);
    const newWl: Record<string, string> = {};
    for (const line of lines) {
      // Support formats: "AAPL" or "AAPL,Apple Inc" or "AAPL Apple Inc"
      const match = line.match(/^([A-Z0-9.\-^=]+)[,\s]*(.*)$/i);
      if (match) {
        const sym = match[1].toUpperCase();
        newWl[sym] = match[2]?.trim() || sym;
      }
    }
    if (Object.keys(newWl).length > 0) {
      setWatchlist({ ...watchlist, ...newWl });
      setBulkInput("");
      setShowBulk(false);
    }
  };

  const handleResetDefaults = () => {
    setWatchlist({ ...DEFAULT_WATCHLIST });
  };

  const handleSymbolClick = (sym: string) => {
    setActiveSymbol(sym);
    setActiveView("equity");
  };

  const symbols = Object.entries(watchlist);

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            Watchlist Manager
          </span>
          <span className="text-[10px] text-neutral-600">{symbols.length} symbols</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBulk((p) => !p)}
            className="rounded px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            {showBulk ? "Single Add" : "Bulk Import"}
          </button>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
            title="Reset to default watchlist"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset Defaults
          </button>
        </div>
      </div>

      {/* Add form */}
      <div className="border-b border-neutral-800 px-3 py-2">
        {showBulk ? (
          <div className="space-y-1.5">
            <p className="text-[10px] text-neutral-500">
              One symbol per line. Optional: SYMBOL,Name or SYMBOL Name
            </p>
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={"AAPL,Apple Inc\nMSFT,Microsoft\nGOOGL"}
              rows={5}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-[#00ACFF] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleBulkImport}
              disabled={!bulkInput.trim()}
              className="rounded bg-[#00ACFF] px-3 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              Import Symbols
            </button>
          </div>
        ) : (
          <form onSubmit={handleAdd} className="flex items-center gap-2">
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Ticker (e.g. AAPL)"
              className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-mono text-white placeholder-neutral-600 focus:border-[#00ACFF] focus:outline-none"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Display name (optional)"
              className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-600 focus:border-[#00ACFF] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newSymbol.trim()}
              className="inline-flex items-center gap-1 rounded bg-[#00ACFF] px-3 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </form>
        )}
      </div>

      {/* Symbol list */}
      <div className="flex-1 overflow-auto">
        {symbols.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-neutral-500">
            <p>No symbols in watchlist</p>
            <p className="text-[10px] text-neutral-600">Add symbols above or reset to defaults.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800 text-left">
                <th className="px-3 py-1.5 font-mono font-medium text-neutral-400">Symbol</th>
                <th className="px-3 py-1.5 font-mono font-medium text-neutral-400">Name</th>
                <th className="px-3 py-1.5 text-right font-mono font-medium text-neutral-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map(([sym, name]) => (
                <tr
                  key={sym}
                  className="border-b border-neutral-800/50 transition-colors hover:bg-neutral-800/30"
                >
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => handleSymbolClick(sym)}
                      className="font-mono font-bold text-[#00ACFF] transition-colors hover:underline"
                    >
                      {sym}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-neutral-400">{name}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeFromWatchlist(sym)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-neutral-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <X className="h-2.5 w-2.5" />
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
