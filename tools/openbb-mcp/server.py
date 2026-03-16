#!/usr/bin/env python3
"""
OpenBB MCP Server Wrapper

Wraps the OpenBB Python library as an MCP server for the content machine agents.
Provides financial data tools for critical minerals and rare earth analysis.

Prerequisites:
  pip install mcp openbb

Start OpenBB API server first:
  openbb-api  (runs on localhost:6900)

Or use this as a standalone MCP server that calls OpenBB directly via Python.
"""

import json
import os
import sys
from typing import Any

try:
    from mcp.server import Server
    from mcp.types import Tool, TextContent
except ImportError:
    print("Install mcp: pip install mcp", file=sys.stderr)
    sys.exit(1)

# Try to import OpenBB
OBB_AVAILABLE = False
try:
    from openbb import obb
    OBB_AVAILABLE = True
except ImportError:
    pass

server = Server("openbb-financial-data")

# Critical minerals tickers and data points
RARE_EARTH_EQUITIES = {
    "MP": "MP Materials",
    "LYC.AX": "Lynas Rare Earths",
    "UUUU": "Energy Fuels",
    "NB": "NioCorp Developments",
}

CRITICAL_MINERAL_ETFS = {
    "REMX": "VanEck Rare Earth/Strategic Metals ETF",
    "PICK": "iShares MSCI Global Metals & Mining Producers ETF",
    "LIT": "Global X Lithium & Battery Tech ETF",
}


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="get_equity_price",
            description="Get historical price data for a critical mineral equity or ETF",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Ticker symbol (e.g., MP, UUUU, REMX)"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "interval": {"type": "string", "enum": ["1d", "1wk", "1mo"], "default": "1d"},
                },
                "required": ["symbol"],
            },
        ),
        Tool(
            name="get_equity_fundamentals",
            description="Get fundamental data (market cap, P/E, revenue) for a critical mineral company",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Ticker symbol"},
                },
                "required": ["symbol"],
            },
        ),
        Tool(
            name="get_commodity_prices",
            description="Get commodity price data (for metals, minerals)",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Commodity symbol or name"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                },
                "required": ["symbol"],
            },
        ),
        Tool(
            name="get_market_snapshot",
            description="Get a snapshot of all tracked critical mineral equities and ETFs",
            inputSchema={
                "type": "object",
                "properties": {
                    "include_etfs": {"type": "boolean", "default": True},
                },
            },
        ),
        Tool(
            name="get_economic_calendar",
            description="Get upcoming economic events relevant to commodities and mining",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                },
            },
        ),
        Tool(
            name="get_sector_performance",
            description="Get performance metrics for mining/materials sector",
            inputSchema={
                "type": "object",
                "properties": {
                    "period": {"type": "string", "enum": ["1d", "1w", "1m", "3m", "6m", "1y"], "default": "1w"},
                },
            },
        ),
        Tool(
            name="search_news",
            description="Search financial news for critical minerals and rare earth topics",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="list_tracked_symbols",
            description="List all tracked critical mineral equities and ETFs with descriptions",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


def obb_to_json(result) -> str:
    """Convert OpenBB result to JSON string."""
    try:
        if hasattr(result, "to_df"):
            df = result.to_df()
            return df.to_json(orient="records", date_format="iso", indent=2)
        if hasattr(result, "results"):
            return json.dumps(result.results, default=str, indent=2)
        return json.dumps(result, default=str, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if not OBB_AVAILABLE:
        return [TextContent(type="text", text=json.dumps({
            "error": "OpenBB not installed. Run: pip install openbb",
            "fallback": "Use the OpenBB REST API at http://localhost:6900 via browser tools instead."
        }))]

    try:
        if name == "get_equity_price":
            result = obb.equity.price.historical(
                symbol=arguments["symbol"],
                start_date=arguments.get("start_date"),
                end_date=arguments.get("end_date"),
                interval=arguments.get("interval", "1d"),
            )
            return [TextContent(type="text", text=obb_to_json(result))]

        elif name == "get_equity_fundamentals":
            result = obb.equity.fundamental.overview(symbol=arguments["symbol"])
            return [TextContent(type="text", text=obb_to_json(result))]

        elif name == "get_commodity_prices":
            result = obb.commodity.price.historical(
                symbol=arguments["symbol"],
                start_date=arguments.get("start_date"),
                end_date=arguments.get("end_date"),
            )
            return [TextContent(type="text", text=obb_to_json(result))]

        elif name == "get_market_snapshot":
            symbols = list(RARE_EARTH_EQUITIES.keys())
            if arguments.get("include_etfs", True):
                symbols.extend(CRITICAL_MINERAL_ETFS.keys())

            snapshots = []
            for sym in symbols:
                try:
                    result = obb.equity.price.quote(symbol=sym)
                    data = result.results[0] if hasattr(result, "results") and result.results else {}
                    snapshots.append({
                        "symbol": sym,
                        "name": RARE_EARTH_EQUITIES.get(sym, CRITICAL_MINERAL_ETFS.get(sym, sym)),
                        "price": getattr(data, "last_price", None),
                        "change_percent": getattr(data, "change_percent", None),
                        "volume": getattr(data, "volume", None),
                    })
                except Exception as e:
                    snapshots.append({"symbol": sym, "error": str(e)})

            return [TextContent(type="text", text=json.dumps(snapshots, default=str, indent=2))]

        elif name == "get_economic_calendar":
            result = obb.economy.calendar(
                start_date=arguments.get("start_date"),
                end_date=arguments.get("end_date"),
            )
            return [TextContent(type="text", text=obb_to_json(result))]

        elif name == "get_sector_performance":
            result = obb.equity.performance.sector()
            return [TextContent(type="text", text=obb_to_json(result))]

        elif name == "search_news":
            result = obb.news.world(
                query=arguments["query"],
                limit=arguments.get("limit", 10),
            )
            return [TextContent(type="text", text=obb_to_json(result))]

        elif name == "list_tracked_symbols":
            return [TextContent(type="text", text=json.dumps({
                "equities": RARE_EARTH_EQUITIES,
                "etfs": CRITICAL_MINERAL_ETFS,
            }, indent=2))]

    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e)}, indent=2))]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
