import { useState, useEffect, useCallback, useRef } from "react";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type {
  LatticeMinionConfig,
  RuntimeConfig,
  RuntimeMode,
  ParsedRuntime,
  RuntimeAvailabilityStatus,
} from "@/common/types/runtime";
import type { RuntimeChoice } from "@/browser/utils/runtimeUi";
import { buildRuntimeConfig, RUNTIME_MODE } from "@/common/types/runtime";
import type { ThinkingLevel } from "@/common/types/thinking";
import { useDraftMinionSettings } from "@/browser/hooks/useDraftMinionSettings";
import { setMinionModelWithOrigin } from "@/browser/utils/modelChange";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import { getSendOptionsFromStorage } from "@/browser/utils/messages/sendOptions";
import {
  getAgentIdKey,
  getInputKey,
  getInputAttachmentsKey,
  getModelKey,
  getNotifyOnResponseAutoEnableKey,
  getNotifyOnResponseKey,
  getThinkingLevelKey,
  getMinionAISettingsByAgentKey,
  getPendingScopeId,
  getDraftScopeId,
  getPendingMinionSendErrorKey,
  getProjectScopeId,
  GLOBAL_SCOPE_ID,
} from "@/common/constants/storage";
import type { SendMessageError } from "@/common/types/errors";
import { useOptionalMinionContext } from "@/browser/contexts/MinionContext";
import { useRouter } from "@/browser/contexts/RouterContext";
import type { Toast } from "@/browser/components/ChatInputToast";
import { useAPI } from "@/browser/contexts/API";
import { useProvidersConfig } from "@/browser/hooks/useProvidersConfig";
import type { FilePart, SendMessageOptions } from "@/common/orpc/types";
import type { MinionCreatedOptions } from "@/browser/components/ChatInput/types";
import {
  useMinionName,
  type MinionNameState,
  type MinionIdentity,
} from "@/browser/hooks/useMinionName";

import { KNOWN_MODELS } from "@/common/constants/knownModels";
import {
  getModelCapabilities,
  getModelCapabilitiesResolved,
} from "@/common/utils/ai/modelCapabilities";
import { normalizeModelInput } from "@/browser/utils/models/normalizeModelInput";
import { resolveDevcontainerSelection } from "@/browser/utils/devcontainerSelection";
import { getErrorMessage } from "@/common/utils/errors";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";

export type CreationSendResult = { success: true } | { success: false; error?: SendMessageError };

interface UseCreationMinionOptions {
  projectPath: string;
  onMinionCreated: (
    metadata: FrontendMinionMetadata,
    options?: MinionCreatedOptions
  ) => void;
  /** Current message input for name generation */
  message: string;
  /** Crew ID to assign the new minion to */
  crewId?: string | null;
  /** Draft ID for UI-only minion creation drafts (from URL) */
  draftId?: string | null;
  /** User's currently selected model (for name generation fallback) */
  userModel?: string;
}

function syncCreationPreferences(projectPath: string, minionId: string): void {
  const projectScopeId = getProjectScopeId(projectPath);

  // Sync model from project scope to minion scope
  // This ensures the model used for creation is persisted for future resumes
  const projectModel = readPersistedState<string | null>(getModelKey(projectScopeId), null);
  if (projectModel) {
    setMinionModelWithOrigin(minionId, projectModel, "sync");
  }

  const projectAgentId = readPersistedState<string | null>(getAgentIdKey(projectScopeId), null);
  const globalDefaultAgentId = readPersistedState<string>(
    getAgentIdKey(GLOBAL_SCOPE_ID),
    MINION_DEFAULTS.agentId
  );
  const effectiveAgentId =
    typeof projectAgentId === "string" && projectAgentId.trim().length > 0
      ? projectAgentId.trim().toLowerCase()
      : typeof globalDefaultAgentId === "string" && globalDefaultAgentId.trim().length > 0
        ? globalDefaultAgentId.trim().toLowerCase()
        : MINION_DEFAULTS.agentId;
  updatePersistedState(getAgentIdKey(minionId), effectiveAgentId);

  const projectThinkingLevel = readPersistedState<ThinkingLevel | null>(
    getThinkingLevelKey(projectScopeId),
    null
  );
  if (projectThinkingLevel !== null) {
    updatePersistedState(getThinkingLevelKey(minionId), projectThinkingLevel);
  }

  if (projectModel) {
    const effectiveThinking: ThinkingLevel = projectThinkingLevel ?? "off";

    updatePersistedState<Partial<Record<string, { model: string; thinkingLevel: ThinkingLevel }>>>(
      getMinionAISettingsByAgentKey(minionId),
      (prev) => {
        const record = prev && typeof prev === "object" ? prev : {};
        return {
          ...(record as Partial<Record<string, { model: string; thinkingLevel: ThinkingLevel }>>),
          [effectiveAgentId]: { model: projectModel, thinkingLevel: effectiveThinking },
        };
      },
      {}
    );
  }

  // Auto-enable notifications if the project-level preference is set
  const autoEnableNotifications = readPersistedState<boolean>(
    getNotifyOnResponseAutoEnableKey(projectPath),
    false
  );
  if (autoEnableNotifications) {
    updatePersistedState(getNotifyOnResponseKey(minionId), true);
  }
}

const PDF_MEDIA_TYPE = "application/pdf";

function getBaseMediaType(mediaType: string): string {
  return mediaType.toLowerCase().trim().split(";")[0];
}

function estimateBase64DataUrlBytes(dataUrl: string): number | null {
  if (!dataUrl.startsWith("data:")) return null;

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;

  const header = dataUrl.slice("data:".length, commaIndex);
  if (!header.includes(";base64")) return null;

  const base64 = dataUrl.slice(commaIndex + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

interface UseCreationMinionReturn {
  branches: string[];
  /** Whether listBranches has completed (to distinguish loading vs non-git repo) */
  branchesLoaded: boolean;
  trunkBranch: string;
  setTrunkBranch: (branch: string) => void;
  /** Currently selected runtime (discriminated union: SSH has host, Docker has image) */
  selectedRuntime: ParsedRuntime;
  /** Fallback Lattice config used when re-selecting Lattice runtime. */
  latticeConfigFallback: LatticeMinionConfig;
  /** Fallback SSH host used when leaving the Lattice runtime. */
  sshHostFallback: string;
  defaultRuntimeMode: RuntimeChoice;
  /** Set the currently selected runtime (discriminated union) */
  setSelectedRuntime: (runtime: ParsedRuntime) => void;
  /** Set the default runtime choice for this project (persists via checkbox) */
  setDefaultRuntimeChoice: (choice: RuntimeChoice) => void;
  toast: Toast | null;
  setToast: (toast: Toast | null) => void;
  isSending: boolean;
  handleSend: (
    message: string,
    fileParts?: FilePart[],
    optionsOverride?: Partial<SendMessageOptions>
  ) => Promise<CreationSendResult>;
  /** Minion name/title generation state and actions (for CreationControls) */
  nameState: MinionNameState;
  /** The confirmed identity being used for creation (null until generation resolves) */
  creatingWithIdentity: MinionIdentity | null;
  /** Reload branches (e.g., after git init) */
  reloadBranches: () => Promise<void>;
  /** Runtime availability state for each mode (loading/failed/loaded) */
  runtimeAvailabilityState: RuntimeAvailabilityState;
}

/** Runtime availability status for each mode */
export type RuntimeAvailabilityMap = Record<RuntimeMode, RuntimeAvailabilityStatus>;

export type RuntimeAvailabilityState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; data: RuntimeAvailabilityMap };

/**
 * Hook for managing minion creation state and logic
 * Handles:
 * - Branch selection
 * - Runtime configuration (local vs SSH)
 * - Minion name generation
 * - Message sending with minion creation
 */
export function useCreationMinion({
  projectPath,
  onMinionCreated,
  message,
  crewId,
  draftId,
  userModel,
}: UseCreationMinionOptions): UseCreationMinionReturn {
  const minionContext = useOptionalMinionContext();
  const promoteMinionDraft = minionContext?.promoteMinionDraft;
  const deleteMinionDraft = minionContext?.deleteMinionDraft;
  const { currentMinionId, currentProjectId, pendingDraftId } = useRouter();
  const isMountedRef = useRef(true);
  const latestRouteRef = useRef({ currentMinionId, currentProjectId, pendingDraftId });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep router state fresh synchronously so auto-navigation checks don't lag behind route changes.
  latestRouteRef.current = { currentMinionId, currentProjectId, pendingDraftId };
  const { api } = useAPI();
  const { config: providersConfig } = useProvidersConfig();
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [recommendedTrunk, setRecommendedTrunk] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isSending, setIsSending] = useState(false);
  // The confirmed identity being used for minion creation (set after waitForGeneration resolves)
  const [creatingWithIdentity, setCreatingWithIdentity] = useState<MinionIdentity | null>(null);
  const [runtimeAvailabilityState, setRuntimeAvailabilityState] =
    useState<RuntimeAvailabilityState>({ status: "loading" });

  // Centralized draft minion settings with automatic persistence
  const {
    settings,
    latticeConfigFallback,
    sshHostFallback,
    setSelectedRuntime,
    setDefaultRuntimeChoice,
    setTrunkBranch,
  } = useDraftMinionSettings(projectPath, branches, recommendedTrunk);

  // Persist draft minion name generation state per draft (so multiple drafts don't share a
  // single auto-naming/manual-name state).
  const minionNameScopeId =
    projectPath.trim().length > 0
      ? typeof draftId === "string" && draftId.trim().length > 0
        ? getDraftScopeId(projectPath, draftId)
        : getPendingScopeId(projectPath)
      : null;

  // Project scope ID for reading send options at send time
  const projectScopeId = getProjectScopeId(projectPath);

  // Minion name generation with debounce
  // Backend tries cheap models first, then user's model, then any available
  const minionNameState = useMinionName({
    message,
    debounceMs: 500,
    userModel,
    scopeId: minionNameScopeId,
  });

  // Destructure name state functions for use in callbacks
  const { waitForGeneration } = minionNameState;

  // Load branches - used on mount and after git init
  // Returns a cleanup function to track mounted state
  const loadBranches = useCallback(async () => {
    if (!projectPath.length || !api) return;
    setBranchesLoaded(false);
    try {
      const result = await api.projects.listBranches({ projectPath });
      setBranches(result.branches);
      setRecommendedTrunk(result.recommendedTrunk);
    } catch (err) {
      console.error("Failed to load branches:", err);
    } finally {
      setBranchesLoaded(true);
    }
  }, [projectPath, api]);

  // Load branches and runtime availability on mount with mounted guard
  useEffect(() => {
    if (!projectPath.length || !api) return;
    let mounted = true;
    setBranchesLoaded(false);
    setRuntimeAvailabilityState({ status: "loading" });
    const doLoad = async () => {
      try {
        // Use allSettled so failures are independent - branches can load even if availability fails
        const [branchResult, availabilityResult] = await Promise.allSettled([
          api.projects.listBranches({ projectPath }),
          api.projects.runtimeAvailability({ projectPath }),
        ]);
        if (!mounted) return;
        if (branchResult.status === "fulfilled") {
          setBranches(branchResult.value.branches);
          setRecommendedTrunk(branchResult.value.recommendedTrunk);
        } else {
          console.error("Failed to load branches:", branchResult.reason);
        }
        if (availabilityResult.status === "fulfilled") {
          setRuntimeAvailabilityState({ status: "loaded", data: availabilityResult.value });
        } else {
          setRuntimeAvailabilityState({ status: "failed" });
        }
      } finally {
        if (mounted) {
          setBranchesLoaded(true);
        }
      }
    };
    void doLoad();
    return () => {
      mounted = false;
    };
  }, [projectPath, api]);

  const handleSend = useCallback(
    async (
      messageText: string,
      fileParts?: FilePart[],
      optionsOverride?: Partial<SendMessageOptions>
    ): Promise<CreationSendResult> => {
      if (!messageText.trim() || isSending || !api) {
        return { success: false };
      }

      // Build runtime config early (used later for minion creation)
      let runtimeSelection = settings.selectedRuntime;

      if (runtimeSelection.mode === RUNTIME_MODE.DEVCONTAINER) {
        const devcontainerSelection = resolveDevcontainerSelection({
          selectedRuntime: runtimeSelection,
          availabilityState: runtimeAvailabilityState,
        });

        if (!devcontainerSelection.isCreatable) {
          setToast({
            id: Date.now().toString(),
            type: "error",
            message: "Select a devcontainer configuration before creating the minion.",
          });
          return { success: false };
        }

        // Update selection with resolved config if different (persist the resolved value)
        if (devcontainerSelection.configPath !== runtimeSelection.configPath) {
          runtimeSelection = {
            ...runtimeSelection,
            configPath: devcontainerSelection.configPath,
          };
          setSelectedRuntime(runtimeSelection);
        }
      }

      const runtimeConfig: RuntimeConfig | undefined = buildRuntimeConfig(runtimeSelection);

      setIsSending(true);
      setToast(null);
      // If user provided a manual name, show it immediately in the overlay
      // instead of "Generating name…". Auto-generated names still show the
      // loading text until generation resolves.
      setCreatingWithIdentity(
        !minionNameState.autoGenerate && minionNameState.name.trim()
          ? { name: minionNameState.name.trim(), title: minionNameState.name.trim() }
          : null
      );

      try {
        // Wait for identity generation to complete (blocks if still in progress)
        // Returns null if generation failed or manual name is empty (error already set in hook)
        const identity = await waitForGeneration();
        if (!identity) {
          setIsSending(false);
          return { success: false };
        }

        // Set the confirmed identity for splash UI display
        setCreatingWithIdentity(identity);

        const normalizedTitle = typeof identity.title === "string" ? identity.title.trim() : "";
        const createTitle = normalizedTitle || undefined;

        // Read send options fresh from localStorage at send time to avoid
        // race conditions with React state updates (requestAnimationFrame batching
        // in usePersistedState can delay state updates after model selection).
        // Override agentId from current draft settings so first-send uses the same
        // project/global/default resolution chain as the creation UI.
        const sendMessageOptions = {
          ...getSendOptionsFromStorage(projectScopeId),
          agentId: settings.agentId,
        };
        // Use normalized override if provided, otherwise fall back to already-normalized storage model
        const normalizedOverride = optionsOverride?.model
          ? normalizeModelInput(optionsOverride.model)
          : null;
        const baseModel = normalizedOverride?.model ?? sendMessageOptions.model;

        // Preflight: if the first message includes PDFs, ensure the selected model can accept them.
        // This prevents creating an empty minion when the initial send is rejected.
        const pdfFileParts = (fileParts ?? []).filter(
          (part) => getBaseMediaType(part.mediaType) === PDF_MEDIA_TYPE
        );
        if (pdfFileParts.length > 0) {
          const caps = getModelCapabilitiesResolved(baseModel, providersConfig);
          if (caps && !caps.supportsPdfInput) {
            const pdfCapableKnownModels = Object.values(KNOWN_MODELS)
              .map((m) => m.id)
              .filter((model) => getModelCapabilities(model)?.supportsPdfInput);
            const pdfCapableExamples = pdfCapableKnownModels.slice(0, 3);
            const examplesSuffix =
              pdfCapableKnownModels.length > pdfCapableExamples.length ? ", and others." : ".";

            setToast({
              id: Date.now().toString(),
              type: "error",
              title: "PDF not supported",
              message:
                `Model ${baseModel} does not support PDF input.` +
                (pdfCapableExamples.length > 0
                  ? ` Try e.g.: ${pdfCapableExamples.join(", ")}${examplesSuffix}`
                  : " Choose a model with PDF support."),
            });
            setIsSending(false);
            return { success: false };
          }

          if (caps?.maxPdfSizeMb !== undefined) {
            const maxBytes = caps.maxPdfSizeMb * 1024 * 1024;
            for (const part of pdfFileParts) {
              const bytes = estimateBase64DataUrlBytes(part.url);
              if (bytes !== null && bytes > maxBytes) {
                const actualMb = (bytes / (1024 * 1024)).toFixed(1);
                setToast({
                  id: Date.now().toString(),
                  type: "error",
                  title: "PDF too large",
                  message: `${part.filename ?? "PDF"} is ${actualMb}MB, but ${baseModel} allows up to ${caps.maxPdfSizeMb}MB per PDF.`,
                });
                setIsSending(false);
                return { success: false };
              }
            }
          }
        }

        // Create the minion with the generated name and title
        const createResult = await api.minion.create({
          projectPath,
          branchName: identity.name,
          trunkBranch: settings.trunkBranch,
          title: createTitle,
          runtimeConfig,
          crewId: crewId ?? undefined,
        });

        if (!createResult.success) {
          setToast({
            id: Date.now().toString(),
            type: "error",
            message: createResult.error,
          });
          setIsSending(false);
          return { success: false };
        }

        const { metadata } = createResult;

        // Best-effort: persist the initial AI settings to the backend immediately so this minion
        // is portable across devices even before the first stream starts.
        api.minion
          .updateAgentAISettings({
            minionId: metadata.id,
            agentId: settings.agentId,
            aiSettings: {
              model: settings.model,
              thinkingLevel: settings.thinkingLevel,
            },
          })
          .catch(() => {
            // Ignore - sendMessage will persist AI settings as a fallback.
          });

        const isDraftScope = typeof draftId === "string" && draftId.trim().length > 0;
        const pendingScopeId = projectPath
          ? isDraftScope
            ? getDraftScopeId(projectPath, draftId)
            : getPendingScopeId(projectPath)
          : null;

        const clearPendingDraft = () => {
          // Once the minion exists, drop the draft even if the initial send fails
          // so we don't keep a hidden placeholder in the sidebar.
          if (!pendingScopeId) {
            return;
          }

          if (isDraftScope && deleteMinionDraft && typeof draftId === "string") {
            deleteMinionDraft(projectPath, draftId);
            return;
          }

          updatePersistedState(getInputKey(pendingScopeId), "");
          updatePersistedState(getInputAttachmentsKey(pendingScopeId), undefined);
        };

        // Sync preferences before switching (keeps minion settings consistent).
        syncCreationPreferences(projectPath, metadata.id);

        // Switch to the minion immediately after creation unless the user navigated away
        // from the draft that initiated the creation (avoid yanking focus to the new minion).
        const shouldAutoNavigate =
          !isDraftScope ||
          (() => {
            if (!isMountedRef.current) return false;
            const latestRoute = latestRouteRef.current;
            if (latestRoute.currentMinionId) return false;
            return latestRoute.pendingDraftId === draftId;
          })();

        onMinionCreated(metadata, { autoNavigate: shouldAutoNavigate });

        if (typeof draftId === "string" && draftId.trim().length > 0 && promoteMinionDraft) {
          // UI-only: show the created minion in-place where the draft was rendered.
          promoteMinionDraft(projectPath, draftId, metadata);
        }

        // Persistently clear the draft as soon as the minion exists so a refresh
        // during the initial send can't resurrect the draft entry in the sidebar.
        clearPendingDraft();

        setIsSending(false);

        // Wait for the initial send result so we can surface errors.
        const additionalSystemInstructions = [
          sendMessageOptions.additionalSystemInstructions,
          optionsOverride?.additionalSystemInstructions,
        ]
          .filter((part) => typeof part === "string" && part.trim().length > 0)
          .join("\n\n");

        const sendResult = await api.minion.sendMessage({
          minionId: metadata.id,
          message: messageText,
          options: {
            ...sendMessageOptions,
            ...optionsOverride,
            additionalSystemInstructions: additionalSystemInstructions.length
              ? additionalSystemInstructions
              : undefined,
            fileParts: fileParts && fileParts.length > 0 ? fileParts : undefined,
          },
        });

        if (!sendResult.success) {
          if (sendResult.error) {
            // Persist the failure so the minion view can surface a toast after navigation.
            updatePersistedState(getPendingMinionSendErrorKey(metadata.id), sendResult.error);
          }
          return { success: false, error: sendResult.error };
        }

        return { success: true };
      } catch (err) {
        const errorMessage = getErrorMessage(err);
        setToast({
          id: Date.now().toString(),
          type: "error",
          message: `Failed to summon minion: ${errorMessage}`,
        });
        setIsSending(false);
        return { success: false };
      }
    },
    [
      api,
      isSending,
      projectPath,
      projectScopeId,
      onMinionCreated,
      settings.selectedRuntime,
      runtimeAvailabilityState,
      setSelectedRuntime,
      settings.agentId,
      settings.model,
      settings.thinkingLevel,
      settings.trunkBranch,
      waitForGeneration,
      minionNameState.autoGenerate,
      minionNameState.name,
      crewId,
      draftId,
      promoteMinionDraft,
      deleteMinionDraft,
      providersConfig,
    ]
  );

  return {
    branches,
    branchesLoaded,
    trunkBranch: settings.trunkBranch,
    setTrunkBranch,
    selectedRuntime: settings.selectedRuntime,
    latticeConfigFallback,
    sshHostFallback,
    defaultRuntimeMode: settings.defaultRuntimeMode,
    setSelectedRuntime,
    setDefaultRuntimeChoice,
    toast,
    setToast,
    isSending,
    handleSend,
    // Minion name/title state (for CreationControls)
    nameState: minionNameState,
    // The confirmed identity being used for creation (null until generation resolves)
    creatingWithIdentity,
    // Reload branches (e.g., after git init)
    reloadBranches: loadBranches,
    // Runtime availability state for each mode
    runtimeAvailabilityState,
  };
}
