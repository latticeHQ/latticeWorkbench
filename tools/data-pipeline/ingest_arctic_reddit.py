#!/usr/bin/env python3
"""
Arctic Reddit Data Ingestion Pipeline

Reads zstandard-compressed NDJSON files from the NAS (Synology DS1525)
and loads them into a local DuckDB database for fast querying by agents.

Usage:
  # Ingest all priority subreddits
  python ingest_arctic_reddit.py

  # Ingest specific subreddits
  python ingest_arctic_reddit.py RareEarths CriticalMinerals investing

  # Ingest with keyword filtering (for broad subreddits like r/investing)
  python ingest_arctic_reddit.py --filter-keywords investing stocks wallstreetbets

Prerequisites:
  pip install zstandard duckdb tqdm

NAS should be mounted at /Volumes/reddit-data/ (or set REDDIT_DATA_PATH env var)
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import zstandard as zstd
except ImportError:
    print("pip install zstandard", file=sys.stderr)
    sys.exit(1)

try:
    import duckdb
except ImportError:
    print("pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

NAS_MOUNT = os.environ.get("REDDIT_DATA_PATH", "/Volumes/reddit-data")
DB_PATH = os.environ.get("REDDIT_DB_PATH", os.path.expanduser("~/.lattice/reddit-arctic.duckdb"))

PRIORITY_SUBREDDITS = [
    "RareEarths", "CriticalMinerals", "MineralRights",
    "investing", "stocks", "wallstreetbets",
    "mining", "geology", "commodities",
    "geopolitics", "energy", "EVs",
]

# For broad subreddits, only ingest posts matching these keywords
KEYWORD_FILTER_SUBREDDITS = {"investing", "stocks", "wallstreetbets", "geopolitics", "energy"}

RELEVANCE_KEYWORDS = [
    "rare earth", "critical mineral", "neodymium", "praseodymium", "dysprosium",
    "terbium", "lanthanum", "cerium", "europium", "gadolinium",
    "mp materials", "lynas", "energy fuels", "uuuu", "niocorp",
    "remx", "lithium", "cobalt", "nickel", "graphite", "manganese",
    "supply chain", "china export", "mining", "ev battery",
    "rare earths", "critical minerals", "separation capacity",
    "processing capacity", "mineral", "rare-earth",
]

BATCH_SIZE = 10_000


def init_db(db_path: str) -> duckdb.DuckDBPyConnection:
    """Initialize DuckDB with schema."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    db = duckdb.connect(db_path)
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
    """)
    # Indexes
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_sub_subreddit ON submissions(subreddit)",
        "CREATE INDEX IF NOT EXISTS idx_sub_date ON submissions(created_date)",
        "CREATE INDEX IF NOT EXISTS idx_sub_score ON submissions(score)",
        "CREATE INDEX IF NOT EXISTS idx_com_subreddit ON comments(subreddit)",
        "CREATE INDEX IF NOT EXISTS idx_com_date ON comments(created_date)",
        "CREATE INDEX IF NOT EXISTS idx_com_link ON comments(link_id)",
    ]:
        db.execute(idx_sql)
    return db


def is_relevant(record: dict, subreddit: str) -> bool:
    """Check if a record from a broad subreddit is relevant to critical minerals."""
    if subreddit.lower() not in {s.lower() for s in KEYWORD_FILTER_SUBREDDITS}:
        return True  # Niche subreddits: ingest everything

    text = (
        record.get("title", "") + " " +
        record.get("selftext", record.get("body", ""))
    ).lower()

    return any(kw in text for kw in RELEVANCE_KEYWORDS)


def stream_zst_ndjson(filepath: Path):
    """Stream-decompress a .zst file and yield JSON records line by line."""
    dctx = zstd.ZstdDecompressor()
    with open(filepath, "rb") as fh:
        with dctx.stream_reader(fh) as reader:
            buf = b""
            while True:
                chunk = reader.read(65536)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if line:
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError:
                            continue


def ingest_submissions(db: duckdb.DuckDBPyConnection, subreddit: str, nas_path: Path):
    """Ingest submissions for a subreddit."""
    filepath = nas_path / f"{subreddit}_submissions.zst"
    if not filepath.exists():
        print(f"  [SKIP] {filepath} not found")
        return 0

    print(f"  Ingesting submissions from {filepath.name}...")
    batch = []
    total = 0
    skipped = 0

    for record in stream_zst_ndjson(filepath):
        if not is_relevant(record, subreddit):
            skipped += 1
            continue

        batch.append((
            record.get("id", ""),
            record.get("subreddit", subreddit),
            record.get("author", ""),
            record.get("title", ""),
            record.get("selftext", "")[:10000],  # Cap text length
            record.get("score", 0),
            record.get("num_comments", 0),
            record.get("created_utc", 0),
            record.get("permalink", ""),
            record.get("url", ""),
        ))

        if len(batch) >= BATCH_SIZE:
            db.executemany(
                "INSERT OR IGNORE INTO submissions (id, subreddit, author, title, selftext, score, num_comments, created_utc, permalink, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                batch,
            )
            total += len(batch)
            batch = []
            if tqdm is None:
                print(f"    {total} submissions ingested...", end="\r")

    if batch:
        db.executemany(
            "INSERT OR IGNORE INTO submissions (id, subreddit, author, title, selftext, score, num_comments, created_utc, permalink, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            batch,
        )
        total += len(batch)

    print(f"  ✓ {total} submissions ingested, {skipped} filtered out")
    return total


def ingest_comments(db: duckdb.DuckDBPyConnection, subreddit: str, nas_path: Path):
    """Ingest comments for a subreddit."""
    filepath = nas_path / f"{subreddit}_comments.zst"
    if not filepath.exists():
        print(f"  [SKIP] {filepath} not found")
        return 0

    print(f"  Ingesting comments from {filepath.name}...")
    batch = []
    total = 0
    skipped = 0

    for record in stream_zst_ndjson(filepath):
        if not is_relevant(record, subreddit):
            skipped += 1
            continue

        batch.append((
            record.get("id", ""),
            record.get("subreddit", subreddit),
            record.get("author", ""),
            record.get("body", "")[:10000],
            record.get("score", 0),
            record.get("parent_id", ""),
            record.get("link_id", ""),
            record.get("created_utc", 0),
        ))

        if len(batch) >= BATCH_SIZE:
            db.executemany(
                "INSERT OR IGNORE INTO comments (id, subreddit, author, body, score, parent_id, link_id, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                batch,
            )
            total += len(batch)
            batch = []
            if tqdm is None:
                print(f"    {total} comments ingested...", end="\r")

    if batch:
        db.executemany(
            "INSERT OR IGNORE INTO comments (id, subreddit, author, body, score, parent_id, link_id, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            batch,
        )
        total += len(batch)

    print(f"  ✓ {total} comments ingested, {skipped} filtered out")
    return total


def main():
    parser = argparse.ArgumentParser(description="Ingest Arctic Reddit data into DuckDB")
    parser.add_argument("subreddits", nargs="*", default=PRIORITY_SUBREDDITS,
                        help="Subreddits to ingest (default: all priority subreddits)")
    parser.add_argument("--filter-keywords", action="store_true",
                        help="Apply keyword filtering to specified subreddits")
    parser.add_argument("--nas-path", default=NAS_MOUNT,
                        help=f"Path to NAS mount (default: {NAS_MOUNT})")
    parser.add_argument("--db-path", default=DB_PATH,
                        help=f"DuckDB database path (default: {DB_PATH})")
    args = parser.parse_args()

    nas_path = Path(args.nas_path)
    if not nas_path.exists():
        print(f"ERROR: NAS mount not found at {nas_path}")
        print(f"Mount the Synology DS1525 or set REDDIT_DATA_PATH env var")
        sys.exit(1)

    print(f"NAS path: {nas_path}")
    print(f"DB path: {args.db_path}")
    print(f"Subreddits: {', '.join(args.subreddits)}")
    print()

    db = init_db(args.db_path)
    total_subs = 0
    total_coms = 0

    for subreddit in args.subreddits:
        print(f"\n[{subreddit}]")
        total_subs += ingest_submissions(db, subreddit, nas_path)
        total_coms += ingest_comments(db, subreddit, nas_path)

    print(f"\n{'='*50}")
    print(f"Done! Total: {total_subs} submissions, {total_coms} comments")
    print(f"Database: {args.db_path}")

    # Print summary
    result = db.execute("""
        SELECT subreddit, COUNT(*) as posts FROM submissions
        GROUP BY subreddit ORDER BY posts DESC
    """).fetchall()
    print(f"\nSubmissions by subreddit:")
    for sub, count in result:
        print(f"  r/{sub}: {count:,}")

    db.close()


if __name__ == "__main__":
    main()
