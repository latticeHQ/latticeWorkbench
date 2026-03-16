# Content Machine Scheduler Setup

Scheduled tasks to be created via `scheduler_create` MCP tool.
Each task targets a specific minion and runs on a cron schedule.

## Daily Tasks

### Morning Data Pull (6:00 AM EST / 11:00 UTC)
```json
{
  "name": "daily-data-pull",
  "minionId": "<data-engineer-minion-id>",
  "prompt": "Run the daily data pull cycle:\n1. Pull latest equity prices from OpenBB for all tracked symbols (MP, LYC, UUUU, NB, REMX, PICK, LIT)\n2. Scrape breaking news from Reuters Commodities, Mining.com\n3. Scrape market data from Argus Media, Asian Metal\n4. Check for new USGS releases\n5. Store all data and flag any significant moves (>3% daily change)\n6. Report findings to the research-analyst minion",
  "schedule": { "kind": "cron", "expression": "0 11 * * 1-5", "timezone": "UTC" },
  "enabled": true
}
```

### StockTwits Daily Post (9:30 AM EST / 14:30 UTC — market open)
```json
{
  "name": "daily-stocktwits-snippet",
  "minionId": "<content-producer-minion-id>",
  "prompt": "Create and publish today's StockTwits snippet:\n1. Review today's data pull results from the data engineer\n2. Identify the most notable data point or price move\n3. Write a 1-2 sentence snippet with relevant ticker tags\n4. Pass to platform-publisher for posting to StockTwits\nKeep it concise, data-forward, and include cashtags.",
  "schedule": { "kind": "cron", "expression": "30 14 * * 1-5", "timezone": "UTC" },
  "enabled": true
}
```

### Community Engagement Sweep (12:00 PM EST / 17:00 UTC)
```json
{
  "name": "daily-engagement-sweep",
  "minionId": "<community-engager-minion-id>",
  "prompt": "Run the daily engagement cycle:\n1. Check all platforms for new comments on our posts\n2. Check for mentions and tags\n3. Identify high-priority replies (questions, corrections, influencer comments)\n4. Draft and post replies following the engagement guidelines\n5. Identify any DM opportunities\n6. Log all interactions for the performance analyst",
  "schedule": { "kind": "cron", "expression": "0 17 * * 1-5", "timezone": "UTC" },
  "enabled": true
}
```

### Evening Analytics Snapshot (6:00 PM EST / 23:00 UTC)
```json
{
  "name": "daily-analytics-snapshot",
  "minionId": "<performance-analyst-minion-id>",
  "prompt": "Run the daily analytics snapshot:\n1. Collect engagement metrics from all platforms\n2. Compare today's performance to rolling averages\n3. Flag any posts that are significantly over/under-performing\n4. Note any trending topics or viral moments\n5. Store metrics for the weekly report",
  "schedule": { "kind": "cron", "expression": "0 23 * * 1-5", "timezone": "UTC" },
  "enabled": true
}
```

## Weekly Tasks

### Monday Research Sprint (7:00 AM EST / 12:00 UTC)
```json
{
  "name": "weekly-research-sprint",
  "minionId": "<research-analyst-minion-id>",
  "prompt": "Run the weekly research sprint:\n1. Pull weekly price data and chart all tracked rare earth elements and equities\n2. Analyze Reddit communities for trending topics and sentiment shifts\n3. Review all 8-10 reference sites for major developments\n4. Query Arctic Reddit data for historical pattern matching\n5. Identify the top 3 content opportunities for this week\n6. Produce the weekly Research Brief and send to content-strategist",
  "schedule": { "kind": "cron", "expression": "0 12 * * 1", "timezone": "UTC" },
  "enabled": true
}
```

### Tuesday Strategy Session (10:00 AM EST / 15:00 UTC)
```json
{
  "name": "weekly-strategy-session",
  "minionId": "<content-strategist-minion-id>",
  "prompt": "Run the weekly strategy session:\n1. Review the Research Brief from the research analyst\n2. Review last week's performance report from the performance analyst\n3. Run MiroFish simulations on top 2-3 content angle candidates\n4. Determine this week's content plan: Reddit chart analysis topic, blog thesis, daily StockTwits queue\n5. Set engagement priorities and posting schedule\n6. Produce the weekly Content Plan and distribute to content-producer and platform-publisher",
  "schedule": { "kind": "cron", "expression": "0 15 * * 2", "timezone": "UTC" },
  "enabled": true
}
```

### Thursday Content Production (8:00 AM EST / 13:00 UTC)
```json
{
  "name": "weekly-content-production",
  "minionId": "<content-producer-minion-id>",
  "prompt": "Execute this week's content plan:\n1. Write the weekly Reddit chart analysis post (full format with charts, data, sources)\n2. Write the Substack/Medium blog post (1500-2500 words)\n3. Write the LinkedIn adaptation (600-800 words)\n4. Queue the remaining daily StockTwits snippets\n5. Send all content to platform-publisher for formatting review\n6. Flag any content that needs content-strategist review before publishing",
  "schedule": { "kind": "cron", "expression": "0 13 * * 4", "timezone": "UTC" },
  "enabled": true
}
```

### Friday Publishing & Weekly Report (9:00 AM EST / 14:00 UTC)
```json
{
  "name": "weekly-publish-cycle",
  "minionId": "<platform-publisher-minion-id>",
  "prompt": "Execute the weekly publishing cycle:\n1. Publish Reddit chart analysis to r/RareEarths (primary) and cross-post as appropriate\n2. Publish Substack newsletter\n3. Publish Medium article\n4. Publish LinkedIn article/post\n5. Screenshot and log all published posts\n6. Notify community-engager that new content is live",
  "schedule": { "kind": "cron", "expression": "0 14 * * 5", "timezone": "UTC" },
  "enabled": true
}
```

### Sunday Weekly Performance Report (10:00 AM EST / 15:00 UTC)
```json
{
  "name": "weekly-performance-report",
  "minionId": "<performance-analyst-minion-id>",
  "prompt": "Produce the weekly performance report:\n1. Aggregate all daily snapshots into weekly metrics\n2. Compare this week vs. last week across all platforms\n3. Identify best/worst performing content with analysis of why\n4. Validate MiroFish simulation predictions against actual results\n5. Produce strategy recommendations for next week\n6. Send report to content-chief and content-strategist",
  "schedule": { "kind": "cron", "expression": "0 15 * * 0", "timezone": "UTC" },
  "enabled": true
}
```

## Setup Instructions

1. Create a minion for each agent type (content-chief, research-analyst, etc.)
2. Note each minion's ID
3. Replace `<xxx-minion-id>` placeholders above with actual IDs
4. Use `scheduler_create` MCP tool to create each scheduled task
5. Verify with `scheduler_list`
6. Monitor with `scheduler_history`
