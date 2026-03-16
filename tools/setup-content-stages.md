# Content Machine Stage Setup

Use these Lattice MCP commands to create the content machine pipeline stages.
Run these in order via a Lattice minion or the MCP API.

## Stages (in pipeline order)

1. **Data Ingestion** (color: `#0EA5E9`) — Arctic Reddit, OpenBB pulls, web scraping
2. **Research** (color: `#3B82F6`) — Trend analysis, source monitoring, market data
3. **Simulation** (color: `#D946EF`) — MiroFish community reaction predictions
4. **Strategy** (color: `#8B5CF6`) — Content planning, audience analysis, engagement strategy
5. **Production** (color: `#10B981`) — Writing charts, blogs, snippets, replies
6. **Publishing** (color: `#F97316`) — Platform formatting and posting
7. **Engagement** (color: `#EC4899`) — Community replies, DMs, relationship building
8. **Analytics** (color: `#6366F1`) — Performance tracking, strategy adaptation

## Agent → Stage Mapping

| Agent | Primary Stage |
|-------|--------------|
| data-engineer | Data Ingestion |
| research-analyst | Research |
| simulation-runner | Simulation |
| content-strategist | Strategy |
| content-producer | Production |
| platform-publisher | Publishing |
| community-engager | Engagement |
| performance-analyst | Analytics |
| content-chief | (orchestrates all) |

## Weekly Flow

```
Mon: Data Ingestion → Research
Tue: Research → Simulation → Strategy
Wed: Strategy → Production
Thu: Production → Publishing
Fri: Publishing → Engagement → Analytics
Daily: Engagement (ongoing) + StockTwits snippets
Weekend: Analytics → Strategy adaptation for next week
```
