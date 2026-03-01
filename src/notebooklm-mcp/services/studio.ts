/**
 * Studio service — create and manage studio artifacts (audio, video, reports, etc.).
 */

import type { BaseClient } from "../client/base";
import {
  RPC,
  StudioTypes,
  AudioFormats,
  AudioLengths,
  VideoFormats,
  VideoStyles,
  InfographicOrientations,
  InfographicDetails,
  SlideDeckFormats,
  SlideDeckLengths,
  FlashcardDifficulties,
  FLASHCARD_COUNT_DEFAULT,
} from "../client/constants";
import type { StudioArtifact, StudioStatus } from "../client/types";

export class StudioService {
  constructor(private readonly client: BaseClient) {}

  async createAudio(
    notebookId: string,
    opts?: {
      focusPrompt?: string;
      format?: string;
      length?: string;
      language?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const formatCode = opts?.format ? AudioFormats.getCode(opts.format) : AudioFormats.getCode("deep_dive");
    const lengthCode = opts?.length ? AudioLengths.getCode(opts.length) : AudioLengths.getCode("default");

    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];
    const audioOpts = [opts?.focusPrompt ?? null, lengthCode, opts?.language ?? null, formatCode];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("audio")];
    // Fill to position 5
    params.push(null); // 4
    params.push(sources); // 5: sources
    params.push(audioOpts); // 6: audio options

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createVideo(
    notebookId: string,
    opts?: {
      focusPrompt?: string;
      format?: string;
      style?: string;
      customStylePrompt?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const formatCode = opts?.format ? VideoFormats.getCode(opts.format) : VideoFormats.getCode("explainer");
    const styleCode = opts?.style ? VideoStyles.getCode(opts.style) : VideoStyles.getCode("auto_select");

    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];
    const videoOpts = [formatCode, styleCode, opts?.customStylePrompt ?? null];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("video")];
    params.push(null); // 4
    params.push(sources); // 5: sources
    params.push([opts?.focusPrompt ?? null]); // 6: focus
    params.push(null); // 7
    params.push(videoOpts); // 8: video options

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createReport(
    notebookId: string,
    opts?: {
      format?: string;
      customPrompt?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];
    const format = opts?.format ?? "Briefing Doc";

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("report")];
    params.push(null); // 4
    params.push(sources); // 5
    params.push(null); // 6
    params.push([format, opts?.customPrompt ?? null]); // 7: report options

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createFlashcards(
    notebookId: string,
    opts?: {
      difficulty?: string;
      count?: number;
      focusPrompt?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const diffCode = opts?.difficulty ? FlashcardDifficulties.getCode(opts.difficulty) : FlashcardDifficulties.getCode("medium");
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("flashcards")];
    // Fill to position 8
    for (let i = 4; i < 9; i++) params.push(null);
    params.push([diffCode, opts?.count ?? FLASHCARD_COUNT_DEFAULT, 1, opts?.focusPrompt ?? null]); // 9: flashcard options (format=1 for flashcards)

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createQuiz(
    notebookId: string,
    opts?: {
      difficulty?: string;
      count?: number;
      focusPrompt?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const diffCode = opts?.difficulty ? FlashcardDifficulties.getCode(opts.difficulty) : FlashcardDifficulties.getCode("medium");
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("flashcards")]; // Quiz shares type with flashcards
    for (let i = 4; i < 9; i++) params.push(null);
    params.push([diffCode, opts?.count ?? FLASHCARD_COUNT_DEFAULT, 2, opts?.focusPrompt ?? null]); // 9: format=2 for quiz

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createInfographic(
    notebookId: string,
    opts?: {
      focusPrompt?: string;
      orientation?: string;
      detail?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const orientCode = opts?.orientation ? InfographicOrientations.getCode(opts.orientation) : InfographicOrientations.getCode("landscape");
    const detailCode = opts?.detail ? InfographicDetails.getCode(opts.detail) : InfographicDetails.getCode("standard");
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("infographic")];
    // Fill to position 13
    for (let i = 4; i < 14; i++) params.push(null);
    params.push([orientCode, detailCode, opts?.focusPrompt ?? null]); // 14: infographic options

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createSlideDeck(
    notebookId: string,
    opts?: {
      focusPrompt?: string;
      format?: string;
      length?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const formatCode = opts?.format ? SlideDeckFormats.getCode(opts.format) : SlideDeckFormats.getCode("detailed_deck");
    const lengthCode = opts?.length ? SlideDeckLengths.getCode(opts.length) : SlideDeckLengths.getCode("default");
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("slide_deck")];
    // Fill to position 15
    for (let i = 4; i < 16; i++) params.push(null);
    params.push([formatCode, lengthCode, opts?.focusPrompt ?? null]); // 16: slide deck options

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createDataTable(
    notebookId: string,
    opts?: {
      focusPrompt?: string;
      sourceIds?: string[];
    },
  ): Promise<unknown> {
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];

    const params: unknown[] = [notebookId, null, null, StudioTypes.getCode("data_table")];
    // Fill to position 17
    for (let i = 4; i < 18; i++) params.push(null);
    params.push([opts?.focusPrompt ?? null]); // 18: data table options

    return this.client.rpcCall(RPC.CREATE_STUDIO, params);
  }

  async createMindMap(
    notebookId: string,
    opts?: { sourceIds?: string[] },
  ): Promise<unknown> {
    const sources = opts?.sourceIds?.map((id) => [id]) ?? [];
    const genResult = await this.client.rpcCall(RPC.GENERATE_MIND_MAP, [
      notebookId, sources,
    ]);

    // Save the generated mind map
    if (genResult) {
      await this.client.rpcCall(RPC.SAVE_MIND_MAP, [notebookId, genResult]);
    }
    return genResult;
  }

  async getStatus(notebookId: string): Promise<StudioStatus> {
    const result = await this.client.rpcCall(RPC.POLL_STUDIO, [notebookId]);

    const artifacts: StudioArtifact[] = [];
    let isGenerating = false;

    if (Array.isArray(result)) {
      // Parse the complex nested artifact structure
      // Audio artifacts at various positions in the result array
      const parseArtifact = (data: unknown[], type: string): StudioArtifact | null => {
        if (!data || !Array.isArray(data)) return null;
        return {
          id: (data[0] as string) ?? null,
          type,
          status: data[2] === 2 ? "complete" : data[2] === 1 ? "generating" : "unknown",
          title: (data[1] as string) ?? "",
          url: null,
          content: null,
          metadata: {},
        };
      };

      // The response structure varies — extract what's available
      if (Array.isArray(result[0])) {
        for (const entry of result[0] as unknown[][]) {
          if (Array.isArray(entry)) {
            const artifact = parseArtifact(entry, "unknown");
            if (artifact) {
              if (artifact.status === "generating") isGenerating = true;
              artifacts.push(artifact);
            }
          }
        }
      }
    }

    return { notebookId, artifacts, isGenerating };
  }

  async delete(artifactId: string): Promise<void> {
    await this.client.rpcCall(RPC.DELETE_STUDIO, [artifactId]);
  }

  async reviseSlide(
    notebookId: string,
    artifactId: string,
    instructions: Array<{ slideIndex: number; instruction: string }>,
  ): Promise<unknown> {
    const slideInstructions = instructions.map((i) => [i.slideIndex, i.instruction]);
    return this.client.rpcCall(RPC.REVISE_SLIDE_DECK, [
      notebookId, artifactId, slideInstructions,
    ]);
  }
}
