import { readPersistedState } from "@/browser/hooks/usePersistedState";
import {
  getEditorDeepLink,
  getDockerDeepLink,
  getDevcontainerDeepLink,
  isLocalhost,
  type DeepLinkEditor,
} from "@/browser/utils/editorDeepLinks";
import {
  DEFAULT_EDITOR_CONFIG,
  EDITOR_CONFIG_KEY,
  type EditorConfig,
} from "@/common/constants/storage";
import type { RuntimeConfig } from "@/common/types/runtime";
import { isSSHRuntime, isDockerRuntime, isDevcontainerRuntime } from "@/common/types/runtime";
import type { APIClient } from "@/browser/contexts/API";

export interface OpenInEditorResult {
  success: boolean;
  error?: string;
}

// Browser mode: window.api is not set (only exists in Electron via preload)
const isBrowserMode = typeof window !== "undefined" && !window.api;

// Helper for opening URLs - allows testing in Node environment
function openUrl(url: string): void {
  if (typeof window !== "undefined" && window.open) {
    window.open(url, "_blank");
  }
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

function mapHostPathToContainerPath(options: {
  hostMinionPath: string;
  containerMinionPath: string;
  targetPath: string;
}): string {
  // Normalize backslashes for Windows compatibility
  const hostMinionPath = trimTrailingSlash(normalizePathSeparators(options.hostMinionPath));
  const containerMinionPath = trimTrailingSlash(options.containerMinionPath);
  const targetPath = trimTrailingSlash(normalizePathSeparators(options.targetPath));

  if (targetPath === hostMinionPath) {
    return containerMinionPath || "/";
  }

  const prefix = `${hostMinionPath}/`;
  if (targetPath.startsWith(prefix)) {
    const relative = targetPath.slice(hostMinionPath.length);
    if (!relative) {
      return containerMinionPath || "/";
    }

    if (containerMinionPath === "/") {
      return relative;
    }

    return `${containerMinionPath}${relative}`;
  }

  return containerMinionPath || "/";
}

/**
 * Get parent directory from a path.
 */
function getParentDirectory(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const isRootLevelPath = lastSlash === 0; // e.g., /file.txt at root
  return isRootLevelPath ? "/" : path.substring(0, lastSlash) || "/";
}

export async function openInEditor(args: {
  api: APIClient | null | undefined;
  openSettings?: (section?: string) => void;
  minionId: string;
  targetPath: string;
  runtimeConfig?: RuntimeConfig;
  /**
   * When true, indicates targetPath is a file.
   *
   * Some deep link formats (e.g. VS Code's Docker attached-container URI) can only
   * open folders/minions, so we fall back to opening the parent directory.
   */
  isFile?: boolean;
}): Promise<OpenInEditorResult> {
  const editorConfig = readPersistedState<EditorConfig>(EDITOR_CONFIG_KEY, DEFAULT_EDITOR_CONFIG);

  const isSSH = isSSHRuntime(args.runtimeConfig);
  const isDocker = isDockerRuntime(args.runtimeConfig);

  // For custom editor with no command configured, open settings (if available)
  if (editorConfig.editor === "custom" && !editorConfig.customCommand) {
    args.openSettings?.("general");
    return { success: false, error: "Please configure a custom editor command in Settings" };
  }

  // For SSH minions, validate the editor supports SSH connections
  if (isSSH) {
    if (editorConfig.editor === "custom") {
      return {
        success: false,
        error: "Custom editors do not support SSH connections for SSH minions",
      };
    }
  }

  // Docker minions always use deep links (VS Code connects to container remotely)
  if (isDocker && args.runtimeConfig?.type === "docker") {
    if (editorConfig.editor === "zed") {
      return { success: false, error: "Zed does not support Docker containers" };
    }
    if (editorConfig.editor === "custom") {
      return { success: false, error: "Custom editors do not support Docker containers" };
    }

    const containerName = args.runtimeConfig.containerName;
    if (!containerName) {
      return {
        success: false,
        error: "Container name not available. Try reopening the minion.",
      };
    }

    // VS Code's attached-container URI scheme only supports opening folders as minions,
    // not individual files. Open the parent directory so the file is visible in the file tree.
    const targetDir = args.isFile ? getParentDirectory(args.targetPath) : args.targetPath;
    const deepLink = getDockerDeepLink({
      editor: editorConfig.editor as DeepLinkEditor,
      containerName,
      path: targetDir,
    });

    if (!deepLink) {
      return { success: false, error: `${editorConfig.editor} does not support Docker containers` };
    }

    openUrl(deepLink);
    return { success: true };
  }

  // Devcontainer minions use deep links with container info from backend
  const isDevcontainer = isDevcontainerRuntime(args.runtimeConfig);
  if (isDevcontainer && args.runtimeConfig?.type === "devcontainer") {
    if (editorConfig.editor === "zed") {
      return { success: false, error: "Zed does not support Dev Containers" };
    }
    if (editorConfig.editor === "custom") {
      return { success: false, error: "Custom editors do not support Dev Containers" };
    }

    // Fetch container info from backend (on-demand discovery)
    const info = await args.api?.minion.getDevcontainerInfo({ minionId: args.minionId });
    if (!info) {
      return {
        success: false,
        error: "Dev Container not running. Try reopening the minion.",
      };
    }

    // VS Code's dev-container URI scheme only supports opening folders as minions,
    // not individual files. Open the parent directory so the file is visible in the file tree.
    const normalizedTargetPath = normalizePathSeparators(args.targetPath);
    const targetDir = args.isFile ? getParentDirectory(normalizedTargetPath) : normalizedTargetPath;

    const hostMinionPath = trimTrailingSlash(info.hostMinionPath);
    const containerPath = mapHostPathToContainerPath({
      hostMinionPath,
      containerMinionPath: info.containerMinionPath,
      targetPath: targetDir,
    });

    // Build the config file path if available
    const configFilePath = args.runtimeConfig.configPath
      ? isAbsolutePath(args.runtimeConfig.configPath)
        ? args.runtimeConfig.configPath
        : `${hostMinionPath}/${args.runtimeConfig.configPath}`
      : undefined;

    const deepLink = getDevcontainerDeepLink({
      editor: editorConfig.editor as DeepLinkEditor,
      containerName: info.containerName,
      hostPath: hostMinionPath,
      containerPath,
      configFilePath,
    });

    if (!deepLink) {
      return { success: false, error: `${editorConfig.editor} does not support Dev Containers` };
    }

    openUrl(deepLink);
    return { success: true };
  }

  // VS Code / Cursor / Zed: always use deep links (works in browser + Electron)
  if (editorConfig.editor !== "custom") {
    // Determine SSH host for deep link
    let sshHost: string | undefined;
    if (isSSH && args.runtimeConfig?.type === "ssh") {
      // SSH minion: use the configured SSH host
      sshHost = args.runtimeConfig.host;
      if (editorConfig.editor === "zed" && args.runtimeConfig.port != null) {
        sshHost = sshHost + ":" + args.runtimeConfig.port;
      }
    } else if (isBrowserMode && !isLocalhost(window.location.hostname)) {
      // Remote server + local minion: need SSH to reach server's files
      const serverSshHost = await args.api?.server.getSshHost();
      sshHost = serverSshHost ?? window.location.hostname;
    }
    // else: localhost access to local minion → no SSH needed

    // VS Code/Cursor SSH deep links treat the path as a folder unless a line/column is present.
    const deepLink = getEditorDeepLink({
      editor: editorConfig.editor as DeepLinkEditor,
      path: args.targetPath,
      sshHost,
      line: args.isFile && sshHost ? 1 : undefined,
      column: args.isFile && sshHost ? 1 : undefined,
    });

    if (!deepLink) {
      return {
        success: false,
        error: `${editorConfig.editor} does not support SSH remote connections`,
      };
    }

    openUrl(deepLink);
    return { success: true };
  }

  // Custom editor:
  // - Browser mode: can't spawn processes on the server
  // - Electron mode: spawn via backend API
  if (isBrowserMode) {
    return {
      success: false,
      error: "Custom editors are not supported in browser mode. Use VS Code, Cursor, or Zed.",
    };
  }

  const result = await args.api?.general.openInEditor({
    minionId: args.minionId,
    targetPath: args.targetPath,
    editorConfig,
  });

  if (!result) {
    return { success: false, error: "API not available" };
  }

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}
