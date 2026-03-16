/**
 * LineChart — Plotly time-series line chart with Bloomberg dark theme.
 *
 * Matches the same visual language as CandlestickChart.tsx: dark background,
 * monospace fonts, #00ACFF default accent, minimal chrome.
 */

import React, { useMemo } from "react";
import Plot from "react-plotly.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

interface LineChartProps {
  data: TimeSeriesPoint[];
  title?: string;
  color?: string;
  height?: number;
  /** Y-axis tick prefix (e.g. "$" or ""). */
  yPrefix?: string;
  /** Y-axis tick suffix (e.g. "%" or ""). */
  ySuffix?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LineChart: React.FC<LineChartProps> = ({
  data,
  title = "",
  color = "#00ACFF",
  height = 350,
  yPrefix = "",
  ySuffix = "",
}) => {
  const trace = useMemo(
    () => ({
      x: data.map((d) => d.date),
      y: data.map((d) => d.value),
      type: "scatter" as const,
      mode: "lines" as const,
      line: { color, width: 1.5 },
      fill: "tozeroy" as const,
      fillcolor: `${color}10`,
      hovertemplate: `%{x|%b %d, %Y}<br>${yPrefix}%{y:.2f}${ySuffix}<extra></extra>`,
    }),
    [data, color, yPrefix, ySuffix],
  );

  const layout = useMemo(
    () => ({
      title: title
        ? {
            text: title,
            font: { color: "#e0e0e0", size: 14, family: "monospace" },
            x: 0.01,
            xanchor: "left" as const,
          }
        : undefined,
      paper_bgcolor: "#0a0a0a",
      plot_bgcolor: "#0a0a0a",
      font: { color: "#a0a0a0", size: 11, family: "monospace" },
      xaxis: {
        type: "date" as const,
        gridcolor: "#1a1a2e",
        linecolor: "#1a1a2e",
        tickfont: { color: "#888" },
      },
      yaxis: {
        gridcolor: "#1a1a2e",
        linecolor: "#1a1a2e",
        tickfont: { color: "#888" },
        side: "right" as const,
        tickprefix: yPrefix,
        ticksuffix: ySuffix,
      },
      margin: { l: 10, r: 60, t: title ? 35 : 10, b: 30 },
      height,
      showlegend: false,
      hovermode: "x unified" as const,
      dragmode: "zoom" as const,
    }),
    [title, height, yPrefix, ySuffix],
  );

  const config = useMemo(
    () => ({
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: [
        "lasso2d",
        "select2d",
        "autoScale2d",
      ] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
      responsive: true,
    }),
    [],
  );

  return (
    <Plot
      data={[trace]}
      layout={layout}
      config={config}
      useResizeHandler
      className="w-full"
      style={{ width: "100%", height }}
    />
  );
};
