/**
 * NotebookLmClient — main client composing BaseClient with all service modules.
 *
 * Usage:
 *   const client = new NotebookLmClient();
 *   await client.init();
 *   const notebooks = await client.notebooks.list();
 */

import { BaseClient, type BaseClientOptions } from "./base";
import { NotebookService } from "../services/notebooks";
import { SourceService } from "../services/sources";
import { StudioService } from "../services/studio";
import { ChatService } from "../services/chat";
import { ResearchService } from "../services/research";
import { SharingService } from "../services/sharing";
import { NoteService } from "../services/notes";
import { DownloadService } from "../services/downloads";
import { ExportService } from "../services/exports";

export class NotebookLmClient extends BaseClient {
  readonly notebooks: NotebookService;
  readonly sources: SourceService;
  readonly studio: StudioService;
  readonly chat: ChatService;
  readonly research: ResearchService;
  readonly sharing: SharingService;
  readonly notes: NoteService;
  readonly downloads: DownloadService;
  readonly exports: ExportService;

  constructor(opts: BaseClientOptions = {}) {
    super(opts);
    this.notebooks = new NotebookService(this);
    this.sources = new SourceService(this);
    this.studio = new StudioService(this);
    this.chat = new ChatService(this);
    this.research = new ResearchService(this);
    this.sharing = new SharingService(this);
    this.notes = new NoteService(this);
    this.downloads = new DownloadService(this);
    this.exports = new ExportService(this);
  }
}
