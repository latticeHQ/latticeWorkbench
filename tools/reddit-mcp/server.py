#!/usr/bin/env python3
"""
Reddit Arctic Data MCP Server

Exposes Arctic Reddit dump data (zstandard NDJSON from NAS Synology DS1525)
as MCP tools for the content machine agents.

Prerequisites:
  pip install mcp zstandard duckdb

NAS mount point (configure in .env or below):
  /Volumes/reddit-data/  (or wherever the DS1525 is mounted)
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# MCP SDK
try:
    from mcp.server import Server
    from mcp.server.stdio import run_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("Install mcp: pip install mcp", file=sys.stderr)
    sys.exit(1)

try:
    import duckdb
except ImportError:
    print("Install duckdb: pip install duckdb", file=sys.stderr)
    sys.exit(1)

# Configuration
NAS_MOUNT = os.environ.get("REDDIT_DATA_PATH", "/Volumes/reddit-data")
DB_PATH = os.environ.get("REDDIT_DB_PATH", os.path.expanduser("~/.lattice/reddit-arctic.duckdb"))

# Priority subreddits for critical minerals content machine
PRIORITY_SUBREDDITS = [
    "RareEarths", "CriticalMinerals", "MineralRights",
    "investing", "stocks", "wallstreetbets",
    "mining", "geology", "commodities",
    "geopolitics", "energy", "EVs",
]

# Keywords for filtering relevant content from broad subreddits
RELEVANCE_KEYWORDS = [
    "rare earth", "critical mineral", "neodymium", "praseodymium", "dysprosium",
    "terbium", "lanthanum", "cerium", "europium", "gadolinium",
    "MP Materials", "Lynas", "Energy Fuels", "UUUU", "NioCorp",
    "REMX", "lithium", "cobalt", "nickel", "graphite", "manganese",
    "supply chain", "China export", "mining", "EV battery", "rare earths",
    "critical minerals", "separation capacity", "processing capacity",
]

server = Server("reddit-arctic-data")


def get_db() -> duckdb.DuckDBPyConnection:
    """Get or create the DuckDB connection with schema."""
    db = duckdb.connect(DB_PATH)
    db.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id VARCHAR PRIMARY KEY,
            subreddit VARCHAR,
            author VARCHAR,
            title VARCHAR,
            selftext VARCHAR,
            score INTEGER,
            num_comments INTEGER,
            created_utc BIGINT,
            permalink VARCHAR,
            url VARCHAR,
            created_date DATE GENERATED ALWAYS AS (EPOCH_MS(created_utc * 1000)::DATE)
        );
        CREATE TABLE IF NOT EXISTS comments (
            id VARCHAR PRIMARY KEY,
            subreddit VARCHAR,
            author VARCHAR,
            body VARCHAR,
            score INTEGER,
            parent_id VARCHAR,
            link_id VARCHAR,
            created_utc BIGINT,
            created_date DATE GENERATED ALWAYS AS (EPOCH_MS(created_utc * 1000)::DATE)
        );
        CREATE INDEX IF NOT EXISTS idx_sub_subreddit ON submissions(subreddit);
        CREATE INDEX IF NOT EXISTS idx_sub_date ON submissions(created_date);
        CREATE INDEX IF NOT EXISTS idx_sub_score ON submissions(score);
        CREATE INDEX IF NOT EXISTS idx_com_subreddit ON comments(subreddit);
        CREATE INDEX IF NOT EXISTS idx_com_date ON comments(created_date);
    """)
    return db


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="reddit_search_posts",
            description="Search Reddit posts by subreddit, keywords, date range, and score threshold",
            inputSchema={
                "type": "object",
                "properties": {
                    "subreddit": {"type": "string", "description": "Subreddit name (without r/)"},
                    "keywords": {"type": "string", "description": "Search keywords (matched against title and selftext)"},
                    "min_score": {"type": "integer", "description": "Minimum score threshold", "default": 0},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "limit": {"type": "integer", "description": "Max results", "default": 25},
                    "sort_by": {"type": "string", "enum": ["score", "num_comments", "created_utc"], "default": "score"},
                },
            },
        ),
        Tool(
            name="reddit_top_posts",
            description="Get top-scoring posts from a subreddit in a date range",
            inputSchema={
                "type": "object",
                "properties": {
                    "subreddit": {"type": "string", "description": "Subreddit name"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["subreddit"],
            },
        ),
        Tool(
            name="reddit_sentiment_trend",
            description="Get weekly post volume and avg score for a subreddit or keyword over time",
            inputSchema={
                "type": "object",
                "properties": {
                    "subreddit": {"type": "string"},
                    "keywords": {"type": "string"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                    "granularity": {"type": "string", "enum": ["day", "week", "month"], "default": "week"},
                },
            },
        ),
        Tool(
            name="reddit_top_authors",
            description="Find the most active/highest-scoring authors in a subreddit",
            inputSchema={
                "type": "object",
                "properties": {
                    "subreddit": {"type": "string", "description": "Subreddit name"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                    "limit": {"type": "integer", "default": 20},
                    "metric": {"type": "string", "enum": ["total_score", "post_count", "avg_score"], "default": "total_score"},
                },
                "required": ["subreddit"],
            },
        ),
        Tool(
            name="reddit_comment_threads",
            description="Get comments for a specific post (by link_id)",
            inputSchema={
                "type": "object",
                "properties": {
                    "link_id": {"type": "string", "description": "Post ID (t3_ prefix)"},
                    "sort_by": {"type": "string", "enum": ["score", "created_utc"], "default": "score"},
                    "limit": {"type": "integer", "default": 50},
                },
                "required": ["link_id"],
            },
        ),
        Tool(
            name="reddit_engagement_analysis",
            description="Analyze which post types get most engagement (by flair, length, time of day)",
            inputSchema={
                "type": "object",
                "properties": {
                    "subreddit": {"type": "string"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                },
                "required": ["subreddit"],
            },
        ),
        Tool(
            name="reddit_ingest_status",
            description="Check ingestion status: which subreddits are loaded, row counts, date ranges",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    db = get_db()

    if name == "reddit_search_posts":
        conditions = ["1=1"]
        params: list[Any] = []
        if arguments.get("subreddit"):
            conditions.append("subreddit = ?")
            params.append(arguments["subreddit"])
        if arguments.get("keywords"):
            kw = f"%{arguments['keywords']}%"
            conditions.append("(title ILIKE ? OR selftext ILIKE ?)")
            params.extend([kw, kw])
        if arguments.get("min_score"):
            conditions.append("score >= ?")
            params.append(arguments["min_score"])
        if arguments.get("start_date"):
            conditions.append("created_date >= ?")
            params.append(arguments["start_date"])
        if arguments.get("end_date"):
            conditions.append("created_date <= ?")
            params.append(arguments["end_date"])

        sort = arguments.get("sort_by", "score")
        limit = arguments.get("limit", 25)

        query = f"""
            SELECT id, subreddit, author, title, score, num_comments,
                   created_date, permalink
            FROM submissions
            WHERE {' AND '.join(conditions)}
            ORDER BY {sort} DESC
            LIMIT ?
        """
        params.append(limit)
        result = db.execute(query, params).fetchall()
        columns = ["id", "subreddit", "author", "title", "score", "num_comments", "created_date", "permalink"]
        rows = [dict(zip(columns, row)) for row in result]
        return [TextContent(type="text", text=json.dumps(rows, default=str, indent=2))]

    elif name == "reddit_top_posts":
        sub = arguments["subreddit"]
        limit = arguments.get("limit", 10)
        conditions = ["subreddit = ?"]
        params = [sub]
        if arguments.get("start_date"):
            conditions.append("created_date >= ?")
            params.append(arguments["start_date"])
        if arguments.get("end_date"):
            conditions.append("created_date <= ?")
            params.append(arguments["end_date"])
        params.append(limit)

        result = db.execute(f"""
            SELECT id, title, author, score, num_comments, created_date, permalink
            FROM submissions WHERE {' AND '.join(conditions)}
            ORDER BY score DESC LIMIT ?
        """, params).fetchall()
        columns = ["id", "title", "author", "score", "num_comments", "created_date", "permalink"]
        rows = [dict(zip(columns, row)) for row in result]
        return [TextContent(type="text", text=json.dumps(rows, default=str, indent=2))]

    elif name == "reddit_sentiment_trend":
        conditions = ["1=1"]
        params = []
        if arguments.get("subreddit"):
            conditions.append("subreddit = ?")
            params.append(arguments["subreddit"])
        if arguments.get("keywords"):
            kw = f"%{arguments['keywords']}%"
            conditions.append("(title ILIKE ? OR selftext ILIKE ?)")
            params.extend([kw, kw])
        if arguments.get("start_date"):
            conditions.append("created_date >= ?")
            params.append(arguments["start_date"])
        if arguments.get("end_date"):
            conditions.append("created_date <= ?")
            params.append(arguments["end_date"])

        gran = arguments.get("granularity", "week")
        trunc = {"day": "day", "week": "week", "month": "month"}[gran]

        result = db.execute(f"""
            SELECT DATE_TRUNC('{trunc}', created_date) as period,
                   COUNT(*) as post_count,
                   AVG(score) as avg_score,
                   SUM(num_comments) as total_comments
            FROM submissions
            WHERE {' AND '.join(conditions)}
            GROUP BY period
            ORDER BY period
        """, params).fetchall()
        columns = ["period", "post_count", "avg_score", "total_comments"]
        rows = [dict(zip(columns, row)) for row in result]
        return [TextContent(type="text", text=json.dumps(rows, default=str, indent=2))]

    elif name == "reddit_top_authors":
        sub = arguments["subreddit"]
        metric = arguments.get("metric", "total_score")
        limit = arguments.get("limit", 20)
        conditions = ["subreddit = ?", "author != '[deleted]'"]
        params = [sub]
        if arguments.get("start_date"):
            conditions.append("created_date >= ?")
            params.append(arguments["start_date"])
        if arguments.get("end_date"):
            conditions.append("created_date <= ?")
            params.append(arguments["end_date"])

        order_col = {"total_score": "total_score", "post_count": "post_count", "avg_score": "avg_score"}[metric]
        params.append(limit)

        result = db.execute(f"""
            SELECT author,
                   COUNT(*) as post_count,
                   SUM(score) as total_score,
                   AVG(score) as avg_score,
                   MAX(score) as best_post_score
            FROM submissions
            WHERE {' AND '.join(conditions)}
            GROUP BY author
            ORDER BY {order_col} DESC
            LIMIT ?
        """, params).fetchall()
        columns = ["author", "post_count", "total_score", "avg_score", "best_post_score"]
        rows = [dict(zip(columns, row)) for row in result]
        return [TextContent(type="text", text=json.dumps(rows, default=str, indent=2))]

    elif name == "reddit_comment_threads":
        link_id = arguments["link_id"]
        if not link_id.startswith("t3_"):
            link_id = f"t3_{link_id}"
        sort = arguments.get("sort_by", "score")
        limit = arguments.get("limit", 50)
        result = db.execute(f"""
            SELECT id, author, body, score, parent_id, created_utc
            FROM comments
            WHERE link_id = ?
            ORDER BY {sort} DESC
            LIMIT ?
        """, [link_id, limit]).fetchall()
        columns = ["id", "author", "body", "score", "parent_id", "created_utc"]
        rows = [dict(zip(columns, row)) for row in result]
        return [TextContent(type="text", text=json.dumps(rows, default=str, indent=2))]

    elif name == "reddit_engagement_analysis":
        sub = arguments["subreddit"]
        conditions = ["subreddit = ?"]
        params = [sub]
        if arguments.get("start_date"):
            conditions.append("created_date >= ?")
            params.append(arguments["start_date"])
        if arguments.get("end_date"):
            conditions.append("created_date <= ?")
            params.append(arguments["end_date"])
        where = ' AND '.join(conditions)

        # By post length
        length_analysis = db.execute(f"""
            SELECT
                CASE
                    WHEN LENGTH(selftext) < 100 THEN 'short (<100 chars)'
                    WHEN LENGTH(selftext) < 500 THEN 'medium (100-500 chars)'
                    WHEN LENGTH(selftext) < 2000 THEN 'long (500-2000 chars)'
                    ELSE 'very_long (2000+ chars)'
                END as post_length,
                COUNT(*) as count,
                AVG(score) as avg_score,
                AVG(num_comments) as avg_comments
            FROM submissions WHERE {where}
            GROUP BY post_length ORDER BY avg_score DESC
        """, params).fetchall()

        # By hour of day
        time_analysis = db.execute(f"""
            SELECT
                EXTRACT(HOUR FROM EPOCH_MS(created_utc * 1000)::TIMESTAMP) as hour_utc,
                COUNT(*) as count,
                AVG(score) as avg_score,
                AVG(num_comments) as avg_comments
            FROM submissions WHERE {where}
            GROUP BY hour_utc ORDER BY avg_score DESC
        """, params).fetchall()

        # By day of week
        dow_analysis = db.execute(f"""
            SELECT
                DAYNAME(EPOCH_MS(created_utc * 1000)::DATE) as day_of_week,
                COUNT(*) as count,
                AVG(score) as avg_score,
                AVG(num_comments) as avg_comments
            FROM submissions WHERE {where}
            GROUP BY day_of_week ORDER BY avg_score DESC
        """, params).fetchall()

        result = {
            "by_length": [dict(zip(["post_length", "count", "avg_score", "avg_comments"], r)) for r in length_analysis],
            "by_hour_utc": [dict(zip(["hour_utc", "count", "avg_score", "avg_comments"], r)) for r in time_analysis],
            "by_day_of_week": [dict(zip(["day_of_week", "count", "avg_score", "avg_comments"], r)) for r in dow_analysis],
        }
        return [TextContent(type="text", text=json.dumps(result, default=str, indent=2))]

    elif name == "reddit_ingest_status":
        try:
            subs = db.execute("""
                SELECT subreddit, COUNT(*) as posts,
                       MIN(created_date) as earliest, MAX(created_date) as latest
                FROM submissions GROUP BY subreddit ORDER BY posts DESC
            """).fetchall()
            comments = db.execute("""
                SELECT subreddit, COUNT(*) as comments
                FROM comments GROUP BY subreddit ORDER BY comments DESC
            """).fetchall()
            result = {
                "submissions": [dict(zip(["subreddit", "posts", "earliest", "latest"], r)) for r in subs],
                "comments": [dict(zip(["subreddit", "comments"], r)) for r in comments],
                "nas_mount": NAS_MOUNT,
                "db_path": DB_PATH,
                "nas_accessible": Path(NAS_MOUNT).exists(),
            }
        except Exception as e:
            result = {"error": str(e), "nas_mount": NAS_MOUNT, "db_path": DB_PATH}
        return [TextContent(type="text", text=json.dumps(result, default=str, indent=2))]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
