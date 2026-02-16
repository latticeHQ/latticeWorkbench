// AUTO-GENERATED - DO NOT EDIT
// Run: bun scripts/gen_builtin_plugins.ts
// Source: src/node/builtinPlugins/_registry.json

export interface PluginPackEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  skills: string[];
  commands: string[];
  mcpServers: Record<string, { transport: string; url: string }>;
  connectors: string;
}

export const BUILTIN_PLUGIN_PACKS: Record<string, PluginPackEntry> = {
  "bio-research": {
    name: "bio-research",
    version: "1.0.0",
    description:
      "Connect to preclinical research tools and databases (literature search, genomics analysis, target prioritization) to accelerate early-stage life sciences R&D",
    author: "Anthropic",
    skills: [
      "bio-research-start",
      "bio-research-instrument-data-to-allotrope",
      "bio-research-nextflow-development",
      "bio-research-scientific-problem-selection",
      "bio-research-scvi-tools",
      "bio-research-single-cell-rna-qc",
    ],
    commands: ["bio-research-start"],
    mcpServers: {
      pubmed: {
        transport: "http",
        url: "https://pubmed.mcp.claude.com/mcp",
      },
      biorender: {
        transport: "http",
        url: "https://mcp.services.biorender.com/mcp",
      },
      biorxiv: {
        transport: "http",
        url: "https://mcp.deepsense.ai/biorxiv/mcp",
      },
      "c-trials": {
        transport: "http",
        url: "https://mcp.deepsense.ai/clinical_trials/mcp",
      },
      chembl: {
        transport: "http",
        url: "https://mcp.deepsense.ai/chembl/mcp",
      },
      synapse: {
        transport: "http",
        url: "https://mcp.synapse.org/mcp",
      },
      wiley: {
        transport: "http",
        url: "https://connector.scholargateway.ai/mcp",
      },
      owkin: {
        transport: "http",
        url: "https://mcp.k.owkin.com/mcp",
      },
      ot: {
        transport: "http",
        url: "https://mcp.platform.opentargets.org/mcp",
      },
      benchling: {
        transport: "http",
        url: "",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~literature` might mean PubMed, bioRxiv, or any other literature source with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (literature, clinical trials, chemical database, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Literature | `~~literature` | PubMed, bioRxiv | Google Scholar, Semantic Scholar |\n| Scientific illustration | `~~scientific illustration` | BioRender | — |\n| Clinical trials | `~~clinical trials` | ClinicalTrials.gov | EU Clinical Trials Register |\n| Chemical database | `~~chemical database` | ChEMBL | PubChem, DrugBank |\n| Drug targets | `~~drug targets` | Open Targets | UniProt, STRING |\n| Data repository | `~~data repository` | Synapse | Zenodo, Dryad, Figshare |\n| Journal access | `~~journal access` | Wiley Scholar Gateway | Elsevier, Springer Nature |\n| AI research | `~~AI research` | Owkin | — |\n| Lab platform | `~~lab platform` | Benchling\\* | — |\n\n\\* Placeholder — MCP URL not yet configured\n",
  },
  "cowork-plugin-management": {
    name: "cowork-plugin-management",
    version: "0.1.0",
    description:
      "Create, customize, and manage plugins tailored to your organization's tools and workflows. Configure MCP servers, adjust plugin behavior, and adapt templates to match how your team works.",
    author: "Anthropic",
    skills: ["cowork-plugin-management-cowork-plugin-customizer"],
    commands: [],
    mcpServers: {},
    connectors: "",
  },
  "customer-support": {
    name: "customer-support",
    version: "1.0.0",
    description:
      "Triage tickets, draft responses, escalate issues, and build your knowledge base. Research customer context and turn resolved issues into self-service content.",
    author: "Anthropic",
    skills: [
      "customer-support-draft-response",
      "customer-support-escalate",
      "customer-support-kb-article",
      "customer-support-research",
      "customer-support-triage",
      "customer-support-customer-research",
      "customer-support-escalation",
      "customer-support-knowledge-management",
      "customer-support-response-drafting",
      "customer-support-ticket-triage",
    ],
    commands: [
      "customer-support-draft-response",
      "customer-support-escalate",
      "customer-support-kb-article",
      "customer-support-research",
      "customer-support-triage",
    ],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      intercom: {
        transport: "http",
        url: "https://mcp.intercom.com/mcp",
      },
      hubspot: {
        transport: "http",
        url: "https://mcp.hubspot.com/anthropic",
      },
      guru: {
        transport: "http",
        url: "https://mcp.api.getguru.com/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      notion: {
        transport: "http",
        url: "https://mcp.notion.com/mcp",
      },
      ms365: {
        transport: "http",
        url: "https://microsoft365.mcp.claude.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~support platform` might mean Intercom, Zendesk, or any other support tool with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (support platform, CRM, chat, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Chat | `~~chat` | Slack | Microsoft Teams |\n| Email | `~~email` | Microsoft 365 | — |\n| Cloud storage | `~~cloud storage` | Microsoft 365 | — |\n| Support platform | `~~support platform` | Intercom | Zendesk, Freshdesk, HubSpot Service Hub |\n| CRM | `~~CRM` | HubSpot | Salesforce, Pipedrive |\n| Knowledge base | `~~knowledge base` | Guru, Notion | Confluence, Help Scout |\n| Headquarter tracker | `~~project tracker` | Atlassian (Jira/Confluence) | Linear, Asana |\n",
  },
  data: {
    name: "data",
    version: "1.0.0",
    description:
      "Write SQL, explore datasets, and generate insights faster. Build visualizations and dashboards, and turn raw data into clear stories for stakeholders.",
    author: "Anthropic",
    skills: [
      "data-analyze",
      "data-build-dashboard",
      "data-create-viz",
      "data-explore-data",
      "data-validate",
      "data-write-query",
      "data-data-context-extractor",
      "data-data-exploration",
      "data-data-validation",
      "data-data-visualization",
      "data-interactive-dashboard-builder",
      "data-sql-queries",
      "data-statistical-analysis",
    ],
    commands: [
      "data-analyze",
      "data-build-dashboard",
      "data-create-viz",
      "data-explore-data",
      "data-validate",
      "data-write-query",
    ],
    mcpServers: {
      snowflake: {
        transport: "http",
        url: "",
      },
      databricks: {
        transport: "http",
        url: "",
      },
      bigquery: {
        transport: "http",
        url: "https://bigquery.googleapis.com/mcp",
      },
      hex: {
        transport: "http",
        url: "https://app.hex.tech/mcp",
      },
      amplitude: {
        transport: "http",
        url: "https://mcp.amplitude.com/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~data warehouse` might mean Snowflake, BigQuery, or any other warehouse with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (data warehouse, notebook, product analytics, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Data warehouse | `~~data warehouse` | Snowflake\\*, Databricks\\*, BigQuery | Redshift, PostgreSQL, MySQL |\n| Notebook | `~~notebook` | Hex | Jupyter, Deepnote, Observable |\n| Product analytics | `~~product analytics` | Amplitude | Mixpanel, Heap |\n| Headquarter tracker | `~~project tracker` | Atlassian (Jira/Confluence) | Linear, Asana |\n\n\\* Placeholder — MCP URL not yet configured\n",
  },
  "enterprise-search": {
    name: "enterprise-search",
    version: "1.0.0",
    description:
      "Search across all of your company's tools in one place. Find anything across email, chat, documents, and wikis without switching between apps.",
    author: "Anthropic",
    skills: [
      "enterprise-search-digest",
      "enterprise-search-search",
      "enterprise-search-knowledge-synthesis",
      "enterprise-search-search-strategy",
      "enterprise-search-source-management",
    ],
    commands: ["enterprise-search-digest", "enterprise-search-search"],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      notion: {
        transport: "http",
        url: "https://mcp.notion.com/mcp",
      },
      guru: {
        transport: "http",
        url: "https://mcp.api.getguru.com/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      asana: {
        transport: "http",
        url: "https://mcp.asana.com/v2/mcp",
      },
      ms365: {
        transport: "http",
        url: "https://microsoft365.mcp.claude.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~chat` might mean Slack, Microsoft Teams, or any other chat tool with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (chat, email, cloud storage, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\nThis plugin uses `~~category` references extensively as source labels in search output (e.g. `~~chat:`, `~~email:`). These are intentional — they represent dynamic category markers that resolve to whatever tool is connected.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Chat | `~~chat` | Slack | Microsoft Teams, Discord |\n| Email | `~~email` | Microsoft 365 | — |\n| Cloud storage | `~~cloud storage` | Microsoft 365 | Dropbox |\n| Knowledge base | `~~knowledge base` | Notion, Guru | Confluence, Slite |\n| Headquarter tracker | `~~project tracker` | Atlassian (Jira/Confluence), Asana | Linear, monday.com |\n| CRM | `~~CRM` | *(not pre-configured)* | Salesforce, HubSpot |\n| Office suite | `~~office suite` | Microsoft 365 | Google Workspace |\n",
  },
  finance: {
    name: "finance",
    version: "1.0.0",
    description:
      "Streamline finance and accounting workflows, from journal entries and reconciliation to financial statements and variance analysis. Speed up audit prep, month-end close, and keeping your books clean.",
    author: "Anthropic",
    skills: [
      "finance-income-statement",
      "finance-journal-entry",
      "finance-reconciliation",
      "finance-sox-testing",
      "finance-variance-analysis",
      "finance-audit-support",
      "finance-close-management",
      "finance-financial-statements",
      "finance-journal-entry-prep",
      "finance-reconciliation-guide",
      "finance-variance-analysis-guide",
    ],
    commands: [
      "finance-income-statement",
      "finance-journal-entry",
      "finance-reconciliation",
      "finance-sox-testing",
      "finance-variance-analysis",
    ],
    mcpServers: {
      snowflake: {
        transport: "http",
        url: "",
      },
      databricks: {
        transport: "http",
        url: "",
      },
      bigquery: {
        transport: "http",
        url: "https://bigquery.googleapis.com/mcp",
      },
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      ms365: {
        transport: "http",
        url: "https://microsoft365.mcp.claude.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~data warehouse` might mean Snowflake, BigQuery, or any other warehouse with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (data warehouse, chat, project tracker, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Data warehouse | `~~data warehouse` | Snowflake\\*, Databricks\\*, BigQuery | Redshift, PostgreSQL |\n| Email | `~~email` | Microsoft 365 | — |\n| Office suite | `~~office suite` | Microsoft 365 | — |\n| Chat | `~~chat` | Slack | Microsoft Teams |\n| ERP / Accounting | `~~erp` | — (no supported MCP servers yet) | NetSuite, SAP, QuickBooks, Xero |\n| Analytics / BI | `~~analytics` | — (no supported MCP servers yet) | Tableau, Looker, Power BI |\n\n\\* Placeholder — MCP URL not yet configured\n",
  },
  legal: {
    name: "legal",
    version: "1.0.0",
    description:
      "Speed up contract review, NDA triage, and compliance workflows for in-house legal teams. Draft legal briefs, organize precedent research, and manage institutional knowledge.",
    author: "Anthropic",
    skills: [
      "legal-brief",
      "legal-respond",
      "legal-review-contract",
      "legal-triage-nda",
      "legal-vendor-check",
      "legal-canned-responses",
      "legal-compliance",
      "legal-contract-review",
      "legal-legal-risk-assessment",
      "legal-meeting-briefing",
      "legal-nda-triage",
    ],
    commands: [
      "legal-brief",
      "legal-respond",
      "legal-review-contract",
      "legal-triage-nda",
      "legal-vendor-check",
    ],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      box: {
        transport: "http",
        url: "https://mcp.box.com",
      },
      egnyte: {
        transport: "http",
        url: "https://mcp-server.egnyte.com/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      ms365: {
        transport: "http",
        url: "https://microsoft365.mcp.claude.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~cloud storage` might mean Box, Egnyte, or any other storage provider with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (cloud storage, chat, office suite, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Chat | `~~chat` | Slack | Microsoft Teams |\n| Cloud storage | `~~cloud storage` | Box, Egnyte | Dropbox, SharePoint, Google Drive |\n| CLM | `~~CLM` | — | Ironclad, Agiloft |\n| CRM | `~~CRM` | — | Salesforce, HubSpot |\n| E-signature | `~~e-signature` | — | DocuSign, Adobe Sign |\n| Office suite | `~~office suite` | Microsoft 365 | Google Workspace |\n| Headquarter tracker | `~~project tracker` | Atlassian (Jira/Confluence) | Linear, Asana |\n",
  },
  marketing: {
    name: "marketing",
    version: "1.0.0",
    description:
      "Create content, plan campaigns, and analyze performance across marketing channels. Maintain brand voice consistency, track competitors, and report on what's working.",
    author: "Anthropic",
    skills: [
      "marketing-brand-review",
      "marketing-campaign-plan",
      "marketing-competitive-brief",
      "marketing-draft-content",
      "marketing-email-sequence",
      "marketing-performance-report",
      "marketing-seo-audit",
      "marketing-brand-voice",
      "marketing-campaign-planning",
      "marketing-competitive-analysis",
      "marketing-content-creation",
      "marketing-performance-analytics",
    ],
    commands: [
      "marketing-brand-review",
      "marketing-campaign-plan",
      "marketing-competitive-brief",
      "marketing-draft-content",
      "marketing-email-sequence",
      "marketing-performance-report",
      "marketing-seo-audit",
    ],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      canva: {
        transport: "http",
        url: "https://mcp.canva.com/mcp",
      },
      figma: {
        transport: "http",
        url: "https://mcp.figma.com/mcp",
      },
      hubspot: {
        transport: "http",
        url: "https://mcp.hubspot.com/anthropic",
      },
      amplitude: {
        transport: "http",
        url: "https://mcp.amplitude.com/mcp",
      },
      notion: {
        transport: "http",
        url: "https://mcp.notion.com/mcp",
      },
      ahrefs: {
        transport: "http",
        url: "https://api.ahrefs.com/mcp/mcp",
      },
      similarweb: {
        transport: "http",
        url: "https://mcp.similarweb.com",
      },
      klaviyo: {
        transport: "http",
        url: "https://mcp.klaviyo.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~marketing automation` might mean HubSpot, Marketo, or any other marketing platform with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (design, SEO, email marketing, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Chat | `~~chat` | Slack | Microsoft Teams |\n| Design | `~~design` | Canva, Figma | Adobe Creative Cloud |\n| Marketing automation | `~~marketing automation` | HubSpot | Marketo, Pardot, Mailchimp |\n| Product analytics | `~~product analytics` | Amplitude | Mixpanel, Google Analytics |\n| Knowledge base | `~~knowledge base` | Notion | Confluence, Guru |\n| SEO | `~~SEO` | Ahrefs, Similarweb | Semrush, Moz |\n| Email marketing | `~~email marketing` | Klaviyo | Mailchimp, Brevo, Customer.io |\n",
  },
  "product-management": {
    name: "product-management",
    version: "1.0.0",
    description:
      "Write feature specs, plan roadmaps, and synthesize user research faster. Keep stakeholders updated and stay ahead of the competitive landscape.",
    author: "Anthropic",
    skills: [
      "product-management-competitive-brief",
      "product-management-metrics-review",
      "product-management-roadmap-update",
      "product-management-stakeholder-update",
      "product-management-synthesize-research",
      "product-management-write-spec",
      "product-management-competitive-analysis",
      "product-management-feature-spec",
      "product-management-metrics-tracking",
      "product-management-roadmap-management",
      "product-management-stakeholder-comms",
      "product-management-user-research-synthesis",
    ],
    commands: [
      "product-management-competitive-brief",
      "product-management-metrics-review",
      "product-management-roadmap-update",
      "product-management-stakeholder-update",
      "product-management-synthesize-research",
      "product-management-write-spec",
    ],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      linear: {
        transport: "http",
        url: "https://mcp.linear.app/mcp",
      },
      asana: {
        transport: "http",
        url: "https://mcp.asana.com/v2/mcp",
      },
      monday: {
        transport: "http",
        url: "https://mcp.monday.com/mcp",
      },
      clickup: {
        transport: "http",
        url: "https://mcp.clickup.com/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      notion: {
        transport: "http",
        url: "https://mcp.notion.com/mcp",
      },
      figma: {
        transport: "http",
        url: "https://mcp.figma.com/mcp",
      },
      amplitude: {
        transport: "http",
        url: "https://mcp.amplitude.com/mcp",
      },
      pendo: {
        transport: "http",
        url: "https://app.pendo.io/mcp/v0/shttp",
      },
      intercom: {
        transport: "http",
        url: "https://mcp.intercom.com/mcp",
      },
      fireflies: {
        transport: "http",
        url: "https://api.fireflies.ai/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~project tracker` might mean Linear, Asana, Jira, or any other tracker with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (project tracker, design, product analytics, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Chat | `~~chat` | Slack | Microsoft Teams |\n| Headquarter tracker | `~~project tracker` | Linear, Asana, monday.com, ClickUp, Atlassian (Jira/Confluence) | Shortcut, Basecamp |\n| Knowledge base | `~~knowledge base` | Notion | Confluence, Guru, Coda |\n| Design | `~~design` | Figma | Sketch, Adobe XD |\n| Product analytics | `~~product analytics` | Amplitude, Pendo | Mixpanel, Heap, FullStory |\n| User feedback | `~~user feedback` | Intercom | Productboard, Canny, UserVoice |\n| Meeting transcription | `~~meeting transcription` | Fireflies | Gong, Dovetail, Otter.ai |\n",
  },
  productivity: {
    name: "productivity",
    version: "1.0.0",
    description:
      "Manage tasks, plan your day, and build up memory of important context about your work. Syncs with your calendar, email, and chat to keep everything organized and on track.",
    author: "Anthropic",
    skills: [
      "productivity-start",
      "productivity-update",
      "productivity-memory-management",
      "productivity-task-management",
    ],
    commands: ["productivity-start", "productivity-update"],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      notion: {
        transport: "http",
        url: "https://mcp.notion.com/mcp",
      },
      asana: {
        transport: "http",
        url: "https://mcp.asana.com/v2/mcp",
      },
      linear: {
        transport: "http",
        url: "https://mcp.linear.app/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      ms365: {
        transport: "http",
        url: "https://microsoft365.mcp.claude.com/mcp",
      },
      monday: {
        transport: "http",
        url: "https://mcp.monday.com/mcp",
      },
      clickup: {
        transport: "http",
        url: "https://mcp.clickup.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~project tracker` might mean Asana, Linear, Jira, or any other project tracker with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (chat, project tracker, knowledge base, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Chat | `~~chat` | Slack | Microsoft Teams, Discord |\n| Email | `~~email` | Microsoft 365 | — |\n| Calendar | `~~calendar` | Microsoft 365 | — |\n| Knowledge base | `~~knowledge base` | Notion | Confluence, Guru, Coda |\n| Headquarter tracker | `~~project tracker` | Asana, Linear, Atlassian (Jira/Confluence), monday.com, ClickUp | Shortcut, Basecamp, Wrike |\n| Office suite | `~~office suite` | Microsoft 365 | — |\n",
  },
  sales: {
    name: "sales",
    version: "1.0.0",
    description:
      "Prospect, craft outreach, and build deal strategy faster. Prep for calls, manage your pipeline, and write personalized messaging that moves deals forward.",
    author: "Anthropic",
    skills: [
      "sales-call-summary",
      "sales-forecast",
      "sales-pipeline-review",
      "sales-account-research",
      "sales-call-prep",
      "sales-competitive-intelligence",
      "sales-create-an-asset",
      "sales-daily-briefing",
      "sales-draft-outreach",
    ],
    commands: ["sales-call-summary", "sales-forecast", "sales-pipeline-review"],
    mcpServers: {
      slack: {
        transport: "http",
        url: "https://mcp.slack.com/mcp",
      },
      hubspot: {
        transport: "http",
        url: "https://mcp.hubspot.com/anthropic",
      },
      close: {
        transport: "http",
        url: "https://mcp.close.com/mcp",
      },
      clay: {
        transport: "http",
        url: "https://api.clay.com/v3/mcp",
      },
      zoominfo: {
        transport: "http",
        url: "https://mcp.zoominfo.com/mcp",
      },
      notion: {
        transport: "http",
        url: "https://mcp.notion.com/mcp",
      },
      atlassian: {
        transport: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
      fireflies: {
        transport: "http",
        url: "https://api.fireflies.ai/mcp",
      },
      ms365: {
        transport: "http",
        url: "https://microsoft365.mcp.claude.com/mcp",
      },
    },
    connectors:
      "# Connectors\n\n## How tool references work\n\nPlugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~CRM` might mean Salesforce, HubSpot, or any other CRM with an MCP server.\n\nPlugins are **tool-agnostic** — they describe workflows in terms of categories (CRM, chat, email, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.\n\n## Connectors for this plugin\n\n| Category | Placeholder | Included servers | Other options |\n|----------|-------------|-----------------|---------------|\n| Calendar | `~~calendar` | Microsoft 365 | Google Calendar |\n| Chat | `~~chat` | Slack | Microsoft Teams |\n| CRM | `~~CRM` | HubSpot, Close | Salesforce, Pipedrive, Copper |\n| Data enrichment | `~~data enrichment` | Clay, ZoomInfo | Apollo, Clearbit, Lusha |\n| Email | `~~email` | Microsoft 365 | Gmail |\n| Knowledge base | `~~knowledge base` | Notion | Confluence, Guru |\n| Meeting transcription | `~~conversation intelligence` | Fireflies | Gong, Chorus, Otter.ai |\n| Headquarter tracker | `~~project tracker` | Atlassian (Jira/Confluence) | Linear, Asana |\n",
  },
};
