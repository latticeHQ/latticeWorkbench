/**
 * Candlestick chart component using Plotly.js.
 * Bloomberg Terminal-style financial chart with volume bars.
 */

import React, { useMemo } from "react";
import Plot from "react-plotly.js";
import type { OHLCVData } from "./useOpenBB";

interface CandlestickChartProps {
  data: OHLCVData[];
  symbol: string;
  height?: number;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  data,
  symbol,
  height = 400,
}) => {
  const { candlestickTrace, volumeTrace } = useMemo(() => {
    const dates = data.map((d) => d.date);
    const opens = data.map((d) => d.open);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const closes = data.map((d) => d.close);
    const volumes = data.map((d) => d.volume);
    const volumeColors = data.map((d) =>
      d.close >= d.open ? "rgba(0, 172, 255, 0.5)" : "rgba(228, 0, 58, 0.5)"
    );

    return {
      candlestickTrace: {
        x: dates,
        open: opens,
        high: highs,
        low: lows,
        close: closes,
        type: "candlestick" as const,
        name: symbol,
        increasing: { line: { color: "#00ACFF" }, fillcolor: "#00ACFF" },
        decreasing: { line: { color: "#e4003a" }, fillcolor: "#e4003a" },
        xaxis: "x",
        yaxis: "y",
      },
      volumeTrace: {
        x: dates,
        y: volumes,
        type: "bar" as const,
        name: "Volume",
        marker: { color: volumeColors },
        xaxis: "x",
        yaxis: "y2",
        showlegend: false,
      },
    };
  }, [data, symbol]);

  const layout = useMemo(
    () => ({
      title: {
        text: `${symbol} — Price & Volume`,
        font: { color: "#e0e0e0", size: 14, family: "monospace" },
        x: 0.01,
        xanchor: "left" as const,
      },
      paper_bgcolor: "#0a0a0a",
      plot_bgcolor: "#0a0a0a",
      font: { color: "#a0a0a0", size: 11, family: "monospace" },
      xaxis: {
        type: "date" as const,
        rangeslider: { visible: false },
        gridcolor: "#1a1a2e",
        linecolor: "#1a1a2e",
        tickfont: { color: "#888" },
      },
      yaxis: {
        domain: [0.25, 1],
        gridcolor: "#1a1a2e",
        linecolor: "#1a1a2e",
        tickfont: { color: "#888" },
        side: "right" as const,
        tickprefix: "$",
      },
      yaxis2: {
        domain: [0, 0.2],
        gridcolor: "#1a1a2e",
        linecolor: "#1a1a2e",
        tickfont: { color: "#888" },
        side: "right" as const,
      },
      margin: { l: 10, r: 60, t: 35, b: 30 },
      height,
      showlegend: false,
      hovermode: "x unified" as const,
      dragmode: "zoom" as const,
    }),
    [symbol, height]
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
    []
  );

  return (
    <Plot
      data={[candlestickTrace, volumeTrace]}
      layout={layout}
      config={config}
      useResizeHandler
      className="w-full"
      style={{ width: "100%", height }}
    />
  );
};
