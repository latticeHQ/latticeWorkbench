/**
 * DataTable — generic sortable dark-theme table for tabular data.
 *
 * Bloomberg terminal aesthetic: monospace, right-aligned numbers,
 * sticky header, color-coded positive/negative values.
 */

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/common/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnType = "string" | "number" | "currency" | "percent" | "date";

export interface ColumnDef<T> {
  key: keyof T & string;
  label: string;
  type: ColumnType;
  /** Hide column below this container width (Tailwind @-container). */
  minWidth?: number;
}

type SortDir = "asc" | "desc";

interface DataTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[];
  data: T[];
  /** Optional row click handler. */
  onRowClick?: (row: T) => void;
  /** Key of the active / highlighted row value (matched against first column). */
  activeKey?: string;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatCell(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return "--";
  switch (type) {
    case "currency": {
      const n = Number(value);
      if (Number.isNaN(n)) return "--";
      return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    case "percent": {
      const n = Number(value);
      if (Number.isNaN(n)) return "--";
      return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    }
    case "number": {
      const n = Number(value);
      if (Number.isNaN(n)) return "--";
      if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
      if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    case "date":
      return String(value).slice(0, 10);
    default:
      return String(value);
  }
}

function isNumericType(type: ColumnType): boolean {
  return type === "number" || type === "currency" || type === "percent";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  activeKey,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;
    const mult = sortDir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = a[sortKey as keyof T];
      const vb = b[sortKey as keyof T];
      if (isNumericType(col.type)) {
        return (Number(va ?? 0) - Number(vb ?? 0)) * mult;
      }
      return String(va ?? "").localeCompare(String(vb ?? "")) * mult;
    });
  }, [data, columns, sortKey, sortDir]);

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
          <tr className="border-b border-neutral-800">
            {columns.map((col) => {
              const numeric = isNumericType(col.type);
              const active = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={cn(
                    "cursor-pointer select-none whitespace-nowrap px-2 py-1.5 font-mono font-medium text-neutral-400 transition-colors hover:text-neutral-200",
                    numeric ? "text-right" : "text-left",
                  )}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {active &&
                      (sortDir === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      ))}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const firstVal = String(row[columns[0]?.key as keyof T] ?? "");
            const isActive = activeKey !== undefined && firstVal === activeKey;
            return (
              <tr
                key={idx}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-neutral-800/50 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-neutral-800/50",
                  isActive && "bg-[#00ACFF]/10",
                )}
              >
                {columns.map((col) => {
                  const raw = row[col.key as keyof T];
                  const formatted = formatCell(raw, col.type);
                  const numeric = isNumericType(col.type);
                  const n = Number(raw);
                  const colorClass =
                    col.type === "percent" || col.type === "currency"
                      ? !Number.isNaN(n) && n > 0
                        ? "text-[#00ACFF]"
                        : !Number.isNaN(n) && n < 0
                          ? "text-[#e4003a]"
                          : "text-neutral-400"
                      : "text-neutral-300";
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "whitespace-nowrap px-2 py-1.5 font-mono",
                        numeric ? "text-right" : "text-left",
                        colorClass,
                      )}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
