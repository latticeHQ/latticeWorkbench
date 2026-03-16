/**
 * SecFilingsView — SEC filings browser for any equity symbol.
 *
 * Uses /equity/fundamental/filings with provider=sec (free, no API key).
 */

import React, { useState, useEffect } from "react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";

interface Filing {
  type?: string;
  filing_type?: string;
  form_type?: string;
  link?: string;
  url?: string;
  report_url?: string;
  filing_url?: string;
  date?: string;
  filed_date?: string;
  filing_date?: string;
  accepted_date?: string;
  description?: string;
  title?: string;
  cik?: string;
}

interface SecFilingsViewProps {
  baseUrl: string;
}

export const SecFilingsView: React.FC<SecFilingsViewProps> = ({ baseUrl }) => {
  const { activeSymbol } = useResearch();
  const [symbol, setSymbol] = useState(activeSymbol);
  const [input, setInput] = useState(activeSymbol);

  // Sync with context when activeSymbol changes externally
  useEffect(() => {
    if (activeSymbol && activeSymbol !== symbol) {
      setSymbol(activeSymbol);
      setInput(activeSymbol);
    }
  }, [activeSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const filings = useOpenBBQuery<Filing[]>(
    "/equity/fundamental/filings",
    { symbol, provider: "sec", limit: "50" },
    baseUrl,
    { provider: "sec", enabled: !!symbol },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) setSymbol(trimmed);
  };

  const rows = filings.data ?? [];

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Symbol input */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">SEC Filings</span>
        <form onSubmit={handleSubmit} className="flex items-center gap-2 ml-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Symbol..."
            className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-[#00ACFF] focus:outline-none"
          />
          <button type="submit" className="rounded bg-[#00ACFF] px-2 py-1 text-xs font-medium text-black hover:opacity-90">
            Search
          </button>
        </form>
        <span className="ml-auto text-[10px] text-neutral-500">
          {rows.length > 0 ? `${rows.length} filings` : ""}
        </span>
      </div>

      {/* Filings table */}
      <div className="flex-1 overflow-auto">
        {filings.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            Loading SEC filings for {symbol}...
          </div>
        ) : filings.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-neutral-500">
            <p className="text-red-600 dark:text-red-400">{filings.error}</p>
            <p className="text-[10px] text-neutral-600">SEC filings use the SEC provider (free, no API key needed).</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            No filings found for {symbol}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800 text-left">
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Date</th>
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Type</th>
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Description</th>
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((filing, i) => {
                const date = filing.date ?? filing.filed_date ?? filing.filing_date ?? filing.accepted_date;
                const type = filing.type ?? filing.filing_type ?? filing.form_type ?? "--";
                const desc = filing.description ?? filing.title ?? "--";
                const link = filing.link ?? filing.url ?? filing.report_url ?? filing.filing_url;
                return (
                  <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="whitespace-nowrap px-2 py-1.5 text-neutral-400">
                      {date ? new Date(date).toLocaleDateString() : "--"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-[#00ACFF]">
                      {type}
                    </td>
                    <td className="max-w-md truncate px-2 py-1.5 text-neutral-300">
                      {desc}
                    </td>
                    <td className="px-2 py-1.5">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#00ACFF] hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-neutral-600">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
