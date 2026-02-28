/**
 * NotebookLM API constants — RPC IDs, enums, code mappings.
 *
 * Single source of truth for all API constants. Ported from
 * notebooklm-mcp-cli (MIT License, jacob-bd).
 */

// ─── RPC IDs ────────────────────────────────────────────────────────────────

export const RPC = {
  // Notebook operations
  LIST_NOTEBOOKS: "wXbhsf",
  GET_NOTEBOOK: "rLM1Ne",
  CREATE_NOTEBOOK: "CCqFvf",
  RENAME_NOTEBOOK: "s0tc2d",
  DELETE_NOTEBOOK: "WWINqb",

  // Source operations
  ADD_SOURCE: "izAoDd",
  ADD_SOURCE_FILE: "o4cbdc",
  GET_SOURCE: "hizoJc",
  CHECK_FRESHNESS: "yR9Yof",
  SYNC_DRIVE: "FLmJqe",
  DELETE_SOURCE: "tGMBJ",
  RENAME_SOURCE: "b7Wfje",

  // Misc
  GET_CONVERSATIONS: "hPTbtc",
  PREFERENCES: "hT54vc",
  SUBSCRIPTION: "ozz5Z",
  SETTINGS: "ZwVcOc",
  GET_SUMMARY: "VfAZjd",
  GET_SOURCE_GUIDE: "tr032e",

  // Research
  START_FAST_RESEARCH: "Ljjv0c",
  START_DEEP_RESEARCH: "QA9ei",
  POLL_RESEARCH: "e3bVqc",
  IMPORT_RESEARCH: "LBwxtb",

  // Studio content
  CREATE_STUDIO: "R7cb6c",
  POLL_STUDIO: "gArtLc",
  DELETE_STUDIO: "V5N4be",
  RENAME_ARTIFACT: "rc3d8d",
  GET_INTERACTIVE_HTML: "v9rmvd",
  REVISE_SLIDE_DECK: "KmcKPe",

  // Mind maps
  GENERATE_MIND_MAP: "yyryJe",
  SAVE_MIND_MAP: "CYK0Xb",
  LIST_MIND_MAPS: "cFji9",
  DELETE_MIND_MAP: "AH0mwd",

  // Notes (some share RPC IDs with mind maps)
  CREATE_NOTE: "CYK0Xb",
  GET_NOTES: "cFji9",
  UPDATE_NOTE: "cYAfTb",
  DELETE_NOTE: "AH0mwd",

  // Sharing
  SHARE_NOTEBOOK: "QDyure",
  GET_SHARE_STATUS: "JFMDGd",

  // Export
  EXPORT_ARTIFACT: "Krh3pd",
} as const;

/** RPC ID → human-readable name (for debug logging) */
export const RPC_NAMES: Record<string, string> = {
  [RPC.LIST_NOTEBOOKS]: "list_notebooks",
  [RPC.GET_NOTEBOOK]: "get_notebook",
  [RPC.CREATE_NOTEBOOK]: "create_notebook",
  [RPC.RENAME_NOTEBOOK]: "rename_notebook",
  [RPC.DELETE_NOTEBOOK]: "delete_notebook",
  [RPC.ADD_SOURCE]: "add_source",
  [RPC.ADD_SOURCE_FILE]: "add_source_file",
  [RPC.GET_SOURCE]: "get_source",
  [RPC.CHECK_FRESHNESS]: "check_freshness",
  [RPC.SYNC_DRIVE]: "sync_drive",
  [RPC.DELETE_SOURCE]: "delete_source",
  [RPC.RENAME_SOURCE]: "rename_source",
  [RPC.GET_SUMMARY]: "get_summary",
  [RPC.GET_SOURCE_GUIDE]: "get_source_guide",
  [RPC.START_FAST_RESEARCH]: "start_fast_research",
  [RPC.START_DEEP_RESEARCH]: "start_deep_research",
  [RPC.POLL_RESEARCH]: "poll_research",
  [RPC.IMPORT_RESEARCH]: "import_research",
  [RPC.CREATE_STUDIO]: "create_studio",
  [RPC.POLL_STUDIO]: "poll_studio",
  [RPC.DELETE_STUDIO]: "delete_studio",
  [RPC.GET_INTERACTIVE_HTML]: "get_interactive_html",
  [RPC.GENERATE_MIND_MAP]: "generate_mind_map",
  [RPC.SAVE_MIND_MAP]: "save_mind_map",
  [RPC.LIST_MIND_MAPS]: "list_mind_maps",
  [RPC.DELETE_MIND_MAP]: "delete_mind_map",
  [RPC.SHARE_NOTEBOOK]: "share_notebook",
  [RPC.GET_SHARE_STATUS]: "get_share_status",
  [RPC.REVISE_SLIDE_DECK]: "revise_slide_deck",
  [RPC.EXPORT_ARTIFACT]: "export_artifact",
};

// ─── Endpoints ──────────────────────────────────────────────────────────────

export const BASE_URL = "https://notebooklm.google.com";
export const BATCHEXECUTE_URL = `${BASE_URL}/_/LabsTailwindUi/data/batchexecute`;
export const UPLOAD_URL = `${BASE_URL}/upload/_/`;
export const QUERY_ENDPOINT =
  "/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed";

export const BL_FALLBACK = "boq_labs-tailwind-frontend_20260108.06_p0";

// ─── Code Mapper ────────────────────────────────────────────────────────────

/** Bidirectional name↔code mapping with case-insensitive lookup. */
export class CodeMapper<T extends Record<string, number>> {
  private readonly nameToCode: Map<string, number>;
  private readonly codeToName: Map<number, string>;
  private readonly displayNames: string[];

  constructor(
    mapping: T,
    private readonly unknownLabel = "unknown",
  ) {
    this.nameToCode = new Map(
      Object.entries(mapping).map(([k, v]) => [k.toLowerCase(), v]),
    );
    this.codeToName = new Map(
      Object.entries(mapping).map(([k, v]) => [v, k]),
    );
    this.displayNames = Object.keys(mapping).sort();
  }

  getCode(name: string): number {
    const code = this.nameToCode.get(name.toLowerCase());
    if (code === undefined) {
      throw new Error(
        `Unknown name '${name}'. Must be one of: ${this.displayNames.join(", ")}`,
      );
    }
    return code;
  }

  getName(code: number | null | undefined): string {
    if (code == null) return this.unknownLabel;
    return this.codeToName.get(code) ?? this.unknownLabel;
  }

  get options(): string[] {
    return this.displayNames;
  }
}

// ─── Ownership ──────────────────────────────────────────────────────────────

export const OWNERSHIP_MINE = 1;
export const OWNERSHIP_SHARED = 2;

// ─── Chat Configuration ─────────────────────────────────────────────────────

export const ChatGoals = new CodeMapper({
  default: 1,
  custom: 2,
  learning_guide: 3,
});

export const ChatResponseLengths = new CodeMapper({
  default: 1,
  longer: 4,
  shorter: 5,
});

// ─── Research ───────────────────────────────────────────────────────────────

export const ResearchSources = new CodeMapper({
  web: 1,
  drive: 2,
});

export const ResearchModes = new CodeMapper({
  fast: 1,
  deep: 5,
});

export const ResultTypes = new CodeMapper({
  web: 1,
  google_doc: 2,
  google_slides: 3,
  deep_report: 5,
  google_sheets: 8,
});

// ─── Source Types ────────────────────────────────────────────────────────────

export const SourceTypes = new CodeMapper({
  google_docs: 1,
  google_slides_sheets: 2,
  pdf: 3,
  pasted_text: 4,
  web_page: 5,
  generated_text: 8,
  youtube: 9,
  uploaded_file: 11,
  image: 13,
  word_doc: 14,
});

// ─── Studio Types ───────────────────────────────────────────────────────────

export const StudioTypes = new CodeMapper({
  audio: 1,
  report: 2,
  video: 3,
  flashcards: 4,
  infographic: 7,
  slide_deck: 8,
  data_table: 9,
});

// ─── Audio ──────────────────────────────────────────────────────────────────

export const AudioFormats = new CodeMapper({
  deep_dive: 1,
  brief: 2,
  critique: 3,
  debate: 4,
});

export const AudioLengths = new CodeMapper({
  short: 1,
  default: 2,
  long: 3,
});

// ─── Video ──────────────────────────────────────────────────────────────────

export const VideoFormats = new CodeMapper({
  explainer: 1,
  brief: 2,
});

export const VideoStyles = new CodeMapper({
  auto_select: 1,
  custom: 2,
  classic: 3,
  whiteboard: 4,
  kawaii: 5,
  anime: 6,
  watercolor: 7,
  retro_print: 8,
  heritage: 9,
  paper_craft: 10,
});

// ─── Infographic ────────────────────────────────────────────────────────────

export const InfographicOrientations = new CodeMapper({
  landscape: 1,
  portrait: 2,
  square: 3,
});

export const InfographicDetails = new CodeMapper({
  concise: 1,
  standard: 2,
  detailed: 3,
});

// ─── Slide Deck ─────────────────────────────────────────────────────────────

export const SlideDeckFormats = new CodeMapper({
  detailed_deck: 1,
  presenter_slides: 2,
});

export const SlideDeckLengths = new CodeMapper({
  short: 1,
  default: 3,
});

// ─── Flashcards / Quiz ──────────────────────────────────────────────────────

export const FlashcardDifficulties = new CodeMapper({
  easy: 1,
  medium: 2,
  hard: 3,
});

export const FLASHCARD_COUNT_DEFAULT = 2;

// ─── Reports ────────────────────────────────────────────────────────────────

export const ReportFormats = {
  BRIEFING_DOC: "Briefing Doc",
  STUDY_GUIDE: "Study Guide",
  BLOG_POST: "Blog Post",
  CUSTOM: "Create Your Own",
} as const;

// ─── Sharing ────────────────────────────────────────────────────────────────

export const ShareRoles = new CodeMapper({
  owner: 1,
  editor: 2,
  viewer: 3,
});

export const ShareAccessLevels = new CodeMapper({
  restricted: 0,
  public: 1,
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const ExportTypes = new CodeMapper({
  docs: 1,
  sheets: 2,
});

// ─── Page Fetch Headers ─────────────────────────────────────────────────────

export const PAGE_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "sec-ch-ua":
    '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

// ─── Timeouts (ms) ──────────────────────────────────────────────────────────

export const DEFAULT_TIMEOUT = 30_000;
export const SOURCE_ADD_TIMEOUT = 120_000;
export const QUERY_TIMEOUT = 120_000;

// ─── Retry defaults ─────────────────────────────────────────────────────────

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY = 1000;
export const DEFAULT_MAX_DELAY = 30_000;
