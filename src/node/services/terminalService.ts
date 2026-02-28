import { EventEmitter } from "events";
import { spawn } from "child_process";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { secretsToRecord } from "@/common/types/secrets";
import type { Config } from "@/node/config";
import { getLatticeEnv, getRuntimeType } from "@/node/runtime/initHook";
import type { PTYService } from "@/node/services/ptyService";
import type { TerminalWindowManager } from "@/desktop/terminalWindowManager";
import type {
  TerminalSession,
  TerminalCreateParams,
  TerminalResizeParams,
} from "@/common/types/terminal";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import type { RuntimeConfig } from "@/common/types/runtime";
import { isSSHRuntime, isDockerRuntime, isDevcontainerRuntime } from "@/common/types/runtime";
import { log } from "@/node/services/log";
import { isCommandAvailable, findAvailableCommand } from "@/node/utils/commandDiscovery";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { NO_OSC_IDLE_FALLBACK_MS } from "@/constants/terminalActivity";
import { getErrorMessage } from "@/common/utils/errors";
import { TerminalProfileService } from "@/node/services/terminalProfileService";
import { SessionFileManager } from "@/node/utils/sessionFile";
import type {
  PersistedTerminalState,
  PersistedTerminalSession,
} from "@/common/types/terminal";
import type { KanbanService } from "@/node/services/kanbanService";
/**
 * Configuration for opening a native terminal
 */
type NativeTerminalConfig =
  | { type: "local"; minionPath: string; command?: string }
  | {
      type: "ssh";
      sshConfig: Extract<RuntimeConfig, { type: "ssh" }>;
      remotePath: string;
      command?: string;
    };

/** Internal options for session creation (not exposed via oRPC). */
interface TerminalCreateInternalOptions {
  /** Reuse this session ID instead of generating a new one (for restoring persisted sessions). */
  restoreSessionId?: string;
  /** Seed the headless terminal with this screen buffer so getScreenState() returns old scrollback. */
  restoreScreenBuffer?: string;
}

/** Max screen buffer size to persist (1MB guard against degenerate sessions). */
const MAX_PERSIST_BUFFER_BYTES = 1024 * 1024;

export class TerminalService {
  private readonly config: Config;
  private readonly ptyService: PTYService;
  private terminalWindowManager?: TerminalWindowManager;
  private kanbanService?: KanbanService;

  // Event emitters for each session
  private readonly outputEmitters = new Map<string, EventEmitter>();
  private readonly exitEmitters = new Map<string, EventEmitter>();

  // Headless terminals for maintaining parsed terminal state on the backend.
  // On reconnect, we serialize the screen state (~4KB) instead of replaying raw output (~512KB).
  private readonly headlessTerminals = new Map<string, Terminal>();
  private readonly serializeAddons = new Map<string, SerializeAddon>();
  private readonly headlessOnDataDisposables = new Map<string, { dispose: () => void }>();
  private readonly titleChangeDisposables = new Map<string, { dispose: () => void }>();

  // Per-session activity tracking for sidebar indicator.
  // Maps sessionId -> { minionId, isRunning (derived from terminal title) }.
  private readonly sessionActivity = new Map<string, { minionId: string; isRunning: boolean }>();
  // Tracks sessions that have received at least one OSC signal (0, 2, or 133).
  // OSC-driven sessions rely on shell-provided idle/running signals and skip the fallback timer.
  private readonly sessionsWithOscActivity = new Set<string>();
  // Fallback timers for non-OSC sessions: auto-reset to idle after NO_OSC_IDLE_FALLBACK_MS.
  private readonly noOscIdleFallbacks = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activityChangeEmitter = new EventEmitter();

  // --- Persistence ---
  private readonly sessionFileManager: SessionFileManager<PersistedTerminalState>;
  /** Track profile info per session so we can persist + restore profile-based terminals. */
  private readonly sessionProfiles = new Map<
    string,
    {
      profileId?: string;
      profileCommand?: string;
      profileArgs?: string[];
      profileEnv?: Record<string, string>;
    }
  >();
  /** Gate: minions whose persisted sessions have already been restored. */
  private readonly restoredMinions = new Set<string>();

  constructor(config: Config, ptyService: PTYService) {
    this.config = config;
    this.ptyService = ptyService;
    this.sessionFileManager = new SessionFileManager<PersistedTerminalState>(config, "terminals.json");
  }

  setTerminalWindowManager(manager: TerminalWindowManager) {
    this.terminalWindowManager = manager;
  }

  /** Wire kanban service for terminal session lifecycle tracking (board cards). */
  setKanbanService(service: KanbanService) {
    this.kanbanService = service;
  }

  /**
   * Check if we're running in desktop mode (Electron) vs server mode (browser).
   */
  isDesktopMode(): boolean {
    return !!this.terminalWindowManager;
  }

  async create(
    params: TerminalCreateParams,
    internalOptions?: TerminalCreateInternalOptions
  ): Promise<TerminalSession> {
    try {
      // 1. Resolve minion
      const allMetadata = await this.config.getAllMinionMetadata();
      const minionMetadata = allMetadata.find((w) => w.id === params.minionId);

      if (!minionMetadata) {
        throw new Error(`Minion not found: ${params.minionId}`);
      }

      // Validate required fields before proceeding - projectPath is required for project-dir runtimes
      if (!minionMetadata.projectPath) {
        log.error("Minion metadata missing projectPath", {
          minionId: params.minionId,
          name: minionMetadata.name,
          runtimeConfig: minionMetadata.runtimeConfig,
          projectName: minionMetadata.projectName,
          metadata: JSON.stringify(minionMetadata),
        });
        throw new Error(
          `Minion "${minionMetadata.name}" (${params.minionId}) is missing projectPath. ` +
            `This may indicate a corrupted config or a minion that was not properly associated with a project.`
        );
      }

      // 2. Create runtime (pass minion info for Docker container name derivation)
      const runtime = createRuntime(minionMetadata.runtimeConfig, {
        projectPath: minionMetadata.projectPath,
        minionName: minionMetadata.name,
      });

      // 3. Compute minion path
      const minionPath = runtime.getMinionPath(
        minionMetadata.projectPath,
        minionMetadata.name
      );

      // Keep integrated terminal context aligned with the bash tool for stable minion metadata.
      // We intentionally skip dynamic values (like cost/model) because long-lived shells would go stale.
      const runtimeType = getRuntimeType(minionMetadata.runtimeConfig);
      const shouldInjectLocalEnv = runtimeType === "local" || runtimeType === "worktree";
      const latticeEnv = shouldInjectLocalEnv
        ? getLatticeEnv(minionMetadata.projectPath, runtimeType, minionMetadata.name)
        : undefined;

      // Secrets are local/worktree only. Remote/docker-style transports would expose env via command args
      // unless we add a dedicated secure propagation path.
      const secrets =
        shouldInjectLocalEnv && minionMetadata.id !== LATTICE_HELP_CHAT_MINION_ID
          ? secretsToRecord(this.config.getEffectiveSecrets(minionMetadata.projectPath))
          : {};

      // Any process launched from this terminal inherits these variables.
      const terminalEnv = latticeEnv ? { ...latticeEnv, ...secrets } : undefined;

      // 4. Setup emitters and buffer
      // We don't know the sessionId yet (PTYService generates it), but PTYService uses a callback.
      // We need to capture the sessionId.
      // Actually PTYService returns the session object with ID.
      // But the callbacks are passed IN to createSession.
      // So we need a way to map the callback to the future sessionId.

      // Hack: We'll create a temporary object to hold the emitter/buffer and assign it to the map once we have the ID.
      // But the callback runs *after* creation usually (when data comes).
      // However, it's safer to create the emitter *before* passing callbacks if we can.
      // We can't key it by sessionId yet.

      let tempSessionId: string | null = null;
      const localBuffer: string[] = [];

      const onData = (data: string) => {
        if (tempSessionId) {
          this.emitOutput(tempSessionId, data);
        } else {
          // Buffer data if session ID is not yet available (race condition during creation)
          localBuffer.push(data);
        }
      };

      const onExit = (code: number) => {
        if (tempSessionId) {
          // Notify kanban board that session process exited (moves card to "completed")
          const activity = this.sessionActivity.get(tempSessionId);
          if (activity) {
            this.kanbanService?.onSessionExited(tempSessionId, activity.minionId)
              .catch((err) => log.error("Kanban: failed to track session exit:", err));
          }
          const emitter = this.exitEmitters.get(tempSessionId);
          emitter?.emit("exit", code);
          this.cleanup(tempSessionId);
        }
      };

      // 5. Create session
      // If a profileId is provided, resolve the command/args from the profile registry.
      // Explicit profileCommand overrides profileId resolution.
      const projectsConfig = this.config.loadConfigOrDefault();

      let profileCommand = params.profileCommand ?? undefined;
      let profileArgs = params.profileArgs ?? undefined;
      let profileEnv = params.profileEnv ?? undefined;

      if (!profileCommand && params.profileId) {
        // Resolve from TerminalProfileService if available
        const profileService = new TerminalProfileService(this.config);
        const resolved = profileService.resolveProfileCommand(params.profileId);
        if (resolved) {
          profileCommand = resolved.command;
          profileArgs = resolved.args;
          profileEnv = resolved.env ? { ...resolved.env, ...profileEnv } : profileEnv;
        }
      }

      const session = await this.ptyService.createSession(
        params,
        runtime,
        minionPath,
        onData,
        onExit,
        minionMetadata.runtimeConfig,
        {
          env: terminalEnv,
          defaultShell: projectsConfig.terminalDefaultShell,
          profileCommand,
          profileArgs,
          profileEnv: profileEnv ? { ...profileEnv } : undefined,
          // Reuse persisted session ID on restore so frontend layout tabs match.
          sessionId: internalOptions?.restoreSessionId,
        }
      );

      tempSessionId = session.sessionId;

      // Initialize emitters and headless terminal for state tracking
      this.outputEmitters.set(session.sessionId, new EventEmitter());
      this.exitEmitters.set(session.sessionId, new EventEmitter());

      // Create headless terminal to maintain parsed state for reconnection
      // allowProposedApi is required for SerializeAddon to access the buffer
      const headless = new Terminal({
        cols: params.cols,
        rows: params.rows,
        allowProposedApi: true,
      });

      // Respond to terminal device queries (DA1/DSR) on the backend.
      //
      // Some TUIs (e.g. Yazi) issue terminal probes like `\x1b[0c` during startup and expect
      // the terminal emulator to reply quickly. When the renderer isn't mounted yet (or IPC
      // is slow), relying on the frontend alone can lead to timeouts.
      const disposeHeadlessOnData = headless.onData((data: string) => {
        if (!data) {
          return;
        }

        try {
          this.ptyService.sendInput(session.sessionId, data);
        } catch (error) {
          log.debug("[TerminalService] Failed to forward terminal response", {
            sessionId: session.sessionId,
            error,
          });
        }
      });
      const serializeAddon = new SerializeAddon();
      headless.loadAddon(serializeAddon);
      this.headlessOnDataDisposables.set(session.sessionId, disposeHeadlessOnData);
      this.headlessTerminals.set(session.sessionId, headless);
      this.serializeAddons.set(session.sessionId, serializeAddon);

      // Track profile info for persistence across restarts.
      if (profileCommand || params.profileId) {
        this.sessionProfiles.set(session.sessionId, {
          profileId: params.profileId ?? undefined,
          profileCommand,
          profileArgs,
          profileEnv,
        });
      }

      // Seed headless terminal with old screen buffer on restore so getScreenState()
      // returns the previous scrollback when the frontend attaches.
      if (internalOptions?.restoreScreenBuffer) {
        headless.write(internalOptions.restoreScreenBuffer);
      }

      // Track session activity and subscribe to title changes for sidebar indicator.
      // Subscribe BEFORE replaying buffered output so early title transitions are not missed.
      this.sessionActivity.set(session.sessionId, {
        minionId: params.minionId,
        isRunning: false,
      });
      // Use parser.registerOscHandler instead of headless.onTitleChange because
      // xterm v6's internal event forwarding chain (InputHandler.setTitle → onTitleChange)
      // doesn't fire despite the parser correctly processing OSC 0/2 sequences.
      const handleTitleOsc = (data: string): boolean => {
        this.markSessionOscDriven(session.sessionId);
        const isRunning = !this.isIdleTitle(data);
        this.updateSessionActivity(session.sessionId, params.minionId, isRunning);
        return false; // don't consume — let xterm's internal handler also process
      };
      const disposeOsc0 = headless.parser.registerOscHandler(0, handleTitleOsc);
      const disposeOsc2 = headless.parser.registerOscHandler(2, handleTitleOsc);
      // OSC 133 (FinalTerm semantic prompt protocol) — fish, zsh with plugins, etc.
      // Marker A = prompt start (idle), C = command start (running).
      const handlePromptOsc = (data: string): boolean => {
        this.markSessionOscDriven(session.sessionId);
        const marker = data.split(";", 1)[0]?.trim();
        if (marker === "A") {
          this.updateSessionActivity(session.sessionId, params.minionId, false);
        } else if (marker === "C") {
          this.updateSessionActivity(session.sessionId, params.minionId, true);
        }
        return false;
      };
      const disposeOsc133 = headless.parser.registerOscHandler(133, handlePromptOsc);
      const disposeOnTitleChange = {
        dispose: () => {
          disposeOsc0.dispose();
          disposeOsc2.dispose();
          disposeOsc133.dispose();
        },
      };
      this.titleChangeDisposables.set(session.sessionId, disposeOnTitleChange);
      this.activityChangeEmitter.emit("change", params.minionId);

      // Replay local buffer that arrived during creation
      for (const data of localBuffer) {
        this.emitOutput(session.sessionId, data);
      }

      // Send initial command if provided
      if (params.initialCommand) {
        this.sendInput(session.sessionId, `${params.initialCommand}\n`);
      }

      // Track session in kanban board — fire and forget, don't block creation
      this.kanbanService?.onSessionCreated({
        sessionId: session.sessionId,
        minionId: params.minionId,
        profileName: profileCommand ?? "Default Terminal",
        profileId: params.profileId ?? undefined,
      }).catch((err) => log.error("Kanban: failed to track session creation:", err));

      return session;
    } catch (err) {
      log.error("Error creating terminal session:", err);
      throw err;
    }
  }

  close(sessionId: string): void {
    try {
      // Grab the minionId before cleanup deletes the activity entry.
      const minionId = this.sessionActivity.get(sessionId)?.minionId;

      // Capture screen buffer and dimensions BEFORE cleanup destroys them.
      // This data is stored in the kanban archived card for read-only replay.
      if (minionId && this.kanbanService) {
        const screenBuffer = this.getScreenState(sessionId);
        const headless = this.headlessTerminals.get(sessionId);
        this.kanbanService.onSessionArchived({
          sessionId,
          minionId,
          screenBuffer: screenBuffer || undefined,
          cols: headless?.cols,
          rows: headless?.rows,
        }).catch((err) => log.error("Kanban: failed to archive session:", err));
      }

      this.terminateTrackedSessions([sessionId]);

      // If no sessions remain for this minion, delete the persistence file
      // so these sessions don't resurrect on next restart.
      if (minionId) {
        const remaining = this.ptyService.getMinionSessionIds(minionId);
        if (remaining.length === 0) {
          this.sessionFileManager.delete(minionId).catch((err) => {
            log.error(`[Persist] Failed to delete terminals.json for ${minionId}:`, err);
          });
        }
      }
    } catch (err) {
      log.error("Error closing terminal session:", err);
      throw err;
    }
  }

  resize(params: TerminalResizeParams): void {
    try {
      this.ptyService.resize(params);

      // Also resize the headless terminal to keep state in sync
      const headless = this.headlessTerminals.get(params.sessionId);
      headless?.resize(params.cols, params.rows);
    } catch (err) {
      log.error("Error resizing terminal:", err);
      throw err;
    }
  }

  sendInput(sessionId: string, data: string): void {
    try {
      this.ptyService.sendInput(sessionId, data);

      // Mark session as running when user submits a command (newline detected).
      // OSC handlers will flip it back when the prompt returns.
      if (data.includes("\r") || data.includes("\n")) {
        const activity = this.sessionActivity.get(sessionId);
        if (activity) {
          this.updateSessionActivity(sessionId, activity.minionId, true);
          // Guard against permanent running state in non-OSC shells.
          if (!this.sessionsWithOscActivity.has(sessionId)) {
            this.armNoOscIdleFallback(sessionId, activity.minionId);
          }
        }
      }
    } catch (err) {
      log.error(`Error sending input to terminal ${sessionId}:`, err);
      throw err;
    }
  }

  async openWindow(minionId: string, sessionId?: string): Promise<void> {
    try {
      const allMetadata = await this.config.getAllMinionMetadata();
      const minion = allMetadata.find((w) => w.id === minionId);

      if (!minion) {
        throw new Error(`Minion not found: ${minionId}`);
      }

      const runtimeConfig = minion.runtimeConfig;
      const isSSH = isSSHRuntime(runtimeConfig);
      const isDesktop = !!this.terminalWindowManager;

      if (isDesktop) {
        log.info(
          `Opening terminal window for minion: ${minionId}${sessionId ? ` (session: ${sessionId})` : ""}`
        );
        await this.terminalWindowManager!.openTerminalWindow(minionId, sessionId);
      } else {
        log.info(
          `Browser mode: terminal UI handled by browser for ${isSSH ? "SSH" : "local"} minion: ${minionId}`
        );
      }
    } catch (err) {
      log.error("Error opening terminal window:", err);
      throw err;
    }
  }

  closeWindow(minionId: string): void {
    try {
      if (!this.terminalWindowManager) {
        // Not an error in server mode, just no-op
        return;
      }
      this.terminalWindowManager.closeTerminalWindow(minionId);
    } catch (err) {
      log.error("Error closing terminal window:", err);
      throw err;
    }
  }

  /**
   * Open the native system terminal for a minion.
   * Opens the user's preferred terminal emulator (Ghostty, Terminal.app, etc.)
   * with the working directory set to the minion path.
   *
   * For SSH minions, opens a terminal that SSHs into the remote host.
   */
  async openNative(minionId: string): Promise<void> {
    try {
      const allMetadata = await this.config.getAllMinionMetadata();
      const minion = allMetadata.find((w) => w.id === minionId);

      if (!minion) {
        throw new Error(`Minion not found: ${minionId}`);
      }

      const runtimeConfig = minion.runtimeConfig;

      if (isSSHRuntime(runtimeConfig)) {
        // SSH minion - spawn local terminal that SSHs into remote host
        await this.openNativeTerminal({
          type: "ssh",
          sshConfig: runtimeConfig,
          remotePath: minion.namedMinionPath,
        });
      } else if (isDockerRuntime(runtimeConfig)) {
        // Docker minion - spawn terminal that docker execs into container
        const containerName = runtimeConfig.containerName;
        if (!containerName) {
          throw new Error("Docker container not initialized");
        }
        await this.openNativeTerminal({
          type: "local",
          minionPath: process.cwd(), // cwd doesn't matter, we're running docker exec
          command: `docker exec -it ${containerName} /bin/sh -c "cd ${minion.namedMinionPath} && exec /bin/sh"`,
        });
      } else if (isDevcontainerRuntime(runtimeConfig)) {
        const quotedPath = JSON.stringify(minion.namedMinionPath);
        const configArg = runtimeConfig.configPath
          ? ` --config ${JSON.stringify(runtimeConfig.configPath)}`
          : "";
        await this.openNativeTerminal({
          type: "local",
          minionPath: minion.namedMinionPath,
          command: `devcontainer exec --minion-folder ${quotedPath}${configArg} -- /bin/sh`,
        });
      } else {
        // Local minion - spawn terminal with cwd set
        await this.openNativeTerminal({
          type: "local",
          minionPath: minion.namedMinionPath,
        });
      }
    } catch (err) {
      const message = getErrorMessage(err);
      log.error(`Failed to open native terminal: ${message}`);
      throw err;
    }
  }

  /**
   * Open a native terminal and run a command.
   * Used for opening $EDITOR in a terminal when editing files.
   * @param command The command to run
   * @param minionPath Optional directory to run the command in (defaults to cwd)
   */
  async openNativeWithCommand(command: string, minionPath?: string): Promise<void> {
    await this.openNativeTerminal({
      type: "local",
      minionPath: minionPath ?? process.cwd(),
      command,
    });
  }

  /**
   * Open a native terminal (local or SSH) with platform-specific handling.
   * This spawns the user's native terminal emulator, not a web-based terminal.
   */
  private async openNativeTerminal(config: NativeTerminalConfig): Promise<void> {
    const isSSH = config.type === "ssh";

    // Build SSH args if needed
    let sshArgs: string[] | null = null;
    if (isSSH) {
      sshArgs = [];
      // Add port if specified
      if (config.sshConfig.port) {
        sshArgs.push("-p", String(config.sshConfig.port));
      }
      // Add identity file if specified
      if (config.sshConfig.identityFile) {
        sshArgs.push("-i", config.sshConfig.identityFile);
      }
      // Force pseudo-terminal allocation
      sshArgs.push("-t");
      // Add host
      sshArgs.push(config.sshConfig.host);
      // Add remote command to cd into directory and start shell
      // Use single quotes to prevent local shell expansion
      // exec $SHELL replaces the SSH process with the shell, avoiding nested processes
      sshArgs.push(`cd '${config.remotePath.replace(/'/g, "'\\''")}' && exec $SHELL`);
    }

    const logPrefix = isSSH ? "SSH terminal" : "terminal";

    if (process.platform === "darwin") {
      await this.openNativeTerminalMacOS(config, sshArgs, logPrefix);
    } else if (process.platform === "win32") {
      this.openNativeTerminalWindows(config, sshArgs, logPrefix);
    } else {
      await this.openNativeTerminalLinux(config, sshArgs, logPrefix);
    }
  }

  private async openNativeTerminalMacOS(
    config: NativeTerminalConfig,
    sshArgs: string[] | null,
    logPrefix: string
  ): Promise<void> {
    const isSSH = config.type === "ssh";
    const command = config.command;
    const minionPath = config.type === "local" ? config.minionPath : config.remotePath;

    // macOS - try Ghostty first, fallback to Terminal.app
    const terminal = await findAvailableCommand(["ghostty", "terminal"]);
    if (terminal === "ghostty") {
      const cmd = "open";
      let args: string[];
      if (isSSH && sshArgs) {
        // Ghostty: Use --command flag to run SSH
        // Build the full SSH command as a single string
        const sshCommand = ["ssh", ...sshArgs].join(" ");
        args = ["-n", "-a", "Ghostty", "--args", `--command=${sshCommand}`];
      } else if (command) {
        // Ghostty: Run command in minion directory
        // Wrap in sh -c to handle cd and command properly
        const escapedPath = minionPath.replace(/'/g, "'\\''");
        const escapedCmd = command.replace(/'/g, "'\\''");
        const fullCommand = `sh -c 'cd "${escapedPath}" && ${escapedCmd}'`;
        args = ["-n", "-a", "Ghostty", "--args", `--command=${fullCommand}`];
      } else {
        // Ghostty: Pass minionPath to 'open -a Ghostty' to avoid regressions
        args = ["-a", "Ghostty", minionPath];
      }
      log.info(`Opening ${logPrefix}: ${cmd} ${args.join(" ")}`);
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else {
      // Terminal.app
      const cmd = isSSH || command ? "osascript" : "open";
      let args: string[];
      if (isSSH && sshArgs) {
        // Terminal.app: Use osascript with proper AppleScript structure
        // Properly escape single quotes in args before wrapping in quotes
        const sshCommand = `ssh ${sshArgs
          .map((arg) => {
            if (arg.includes(" ") || arg.includes("'")) {
              // Escape single quotes by ending quote, adding escaped quote, starting quote again
              return `'${arg.replace(/'/g, "'\\''")}'`;
            }
            return arg;
          })
          .join(" ")}`;
        // Escape double quotes for AppleScript string
        const escapedCommand = sshCommand.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `tell application "Terminal"\nactivate\ndo script "${escapedCommand}"\nend tell`;
        args = ["-e", script];
      } else if (command) {
        // Terminal.app: Run command in minion directory via AppleScript
        const fullCommand = `cd "${minionPath}" && ${command}`;
        const escapedCommand = fullCommand.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `tell application "Terminal"\nactivate\ndo script "${escapedCommand}"\nend tell`;
        args = ["-e", script];
      } else {
        // Terminal.app opens in the directory when passed as argument
        args = ["-a", "Terminal", minionPath];
      }
      log.info(`Opening ${logPrefix}: ${cmd} ${args.join(" ")}`);
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }
  }

  private openNativeTerminalWindows(
    config: NativeTerminalConfig,
    sshArgs: string[] | null,
    logPrefix: string
  ): void {
    const isSSH = config.type === "ssh";
    const command = config.command;
    const minionPath = config.type === "local" ? config.minionPath : config.remotePath;

    // Windows
    const cmd = "cmd";
    let args: string[];
    if (isSSH && sshArgs) {
      // Windows - use cmd to start ssh
      args = ["/c", "start", "cmd", "/K", "ssh", ...sshArgs];
    } else if (command) {
      // Windows - cd to directory and run command
      args = ["/c", "start", "cmd", "/K", `cd /D "${minionPath}" && ${command}`];
    } else {
      // Windows - just cd to directory
      args = ["/c", "start", "cmd", "/K", "cd", "/D", minionPath];
    }
    log.info(`Opening ${logPrefix}: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      detached: true,
      shell: true,
      stdio: "ignore",
    });
    child.unref();
  }

  private async openNativeTerminalLinux(
    config: NativeTerminalConfig,
    sshArgs: string[] | null,
    logPrefix: string
  ): Promise<void> {
    const isSSH = config.type === "ssh";
    const command = config.command;
    const minionPath = config.type === "local" ? config.minionPath : config.remotePath;

    // Linux - try terminal emulators in order of preference
    let terminals: Array<{ cmd: string; args: string[]; cwd?: string }>;

    if (isSSH && sshArgs) {
      // x-terminal-emulator is checked first as it respects user's system-wide preference
      terminals = [
        { cmd: "x-terminal-emulator", args: ["-e", "ssh", ...sshArgs] },
        { cmd: "ghostty", args: ["ssh", ...sshArgs] },
        { cmd: "alacritty", args: ["-e", "ssh", ...sshArgs] },
        { cmd: "kitty", args: ["ssh", ...sshArgs] },
        { cmd: "wezterm", args: ["start", "--", "ssh", ...sshArgs] },
        { cmd: "gnome-terminal", args: ["--", "ssh", ...sshArgs] },
        { cmd: "konsole", args: ["-e", "ssh", ...sshArgs] },
        { cmd: "xfce4-terminal", args: ["-e", `ssh ${sshArgs.join(" ")}`] },
        { cmd: "xterm", args: ["-e", "ssh", ...sshArgs] },
      ];
    } else if (command) {
      // Run command in minion directory
      const fullCommand = `cd "${minionPath}" && ${command}`;
      terminals = [
        { cmd: "x-terminal-emulator", args: ["-e", "sh", "-c", fullCommand] },
        { cmd: "ghostty", args: ["-e", "sh", "-c", fullCommand] },
        { cmd: "alacritty", args: ["-e", "sh", "-c", fullCommand] },
        { cmd: "kitty", args: ["sh", "-c", fullCommand] },
        { cmd: "wezterm", args: ["start", "--", "sh", "-c", fullCommand] },
        { cmd: "gnome-terminal", args: ["--", "sh", "-c", fullCommand] },
        { cmd: "konsole", args: ["-e", "sh", "-c", fullCommand] },
        { cmd: "xfce4-terminal", args: ["-e", `sh -c '${fullCommand.replace(/'/g, "'\\''")}'`] },
        { cmd: "xterm", args: ["-e", "sh", "-c", fullCommand] },
      ];
    } else {
      // Just open terminal in directory
      terminals = [
        { cmd: "x-terminal-emulator", args: [], cwd: minionPath },
        { cmd: "ghostty", args: ["--working-directory=" + minionPath] },
        { cmd: "alacritty", args: ["--working-directory", minionPath] },
        { cmd: "kitty", args: ["--directory", minionPath] },
        { cmd: "wezterm", args: ["start", "--cwd", minionPath] },
        { cmd: "gnome-terminal", args: ["--working-directory", minionPath] },
        { cmd: "konsole", args: ["--workdir", minionPath] },
        { cmd: "xfce4-terminal", args: ["--working-directory", minionPath] },
        { cmd: "xterm", args: [], cwd: minionPath },
      ];
    }

    const availableTerminal = await this.findAvailableTerminal(terminals);

    if (availableTerminal) {
      const cwdInfo = availableTerminal.cwd ? ` (cwd: ${availableTerminal.cwd})` : "";
      log.info(
        `Opening ${logPrefix}: ${availableTerminal.cmd} ${availableTerminal.args.join(" ")}${cwdInfo}`
      );
      const child = spawn(availableTerminal.cmd, availableTerminal.args, {
        cwd: availableTerminal.cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else {
      log.error("No terminal emulator found. Tried: " + terminals.map((t) => t.cmd).join(", "));
      throw new Error("No terminal emulator found");
    }
  }

  /**
   * Find the first available terminal emulator from a list
   */
  private async findAvailableTerminal(
    terminals: Array<{ cmd: string; args: string[]; cwd?: string }>
  ): Promise<{ cmd: string; args: string[]; cwd?: string } | null> {
    for (const terminal of terminals) {
      if (await isCommandAvailable(terminal.cmd)) {
        return terminal;
      }
    }
    return null;
  }

  onOutput(sessionId: string, callback: (data: string) => void): () => void {
    const emitter = this.outputEmitters.get(sessionId);
    if (!emitter) {
      // Session might not exist yet or closed.
      // If it doesn't exist, we can't subscribe.
      return () => {
        /* no-op */
      };
    }

    // Note: The attach stream yields screenState first, then live output.
    // This subscription only provides live output from the point of subscription onward.

    const handler = (data: string) => callback(data);
    emitter.on("data", handler);

    return () => {
      emitter.off("data", handler);
    };
  }

  onExit(sessionId: string, callback: (code: number) => void): () => void {
    const emitter = this.exitEmitters.get(sessionId);
    if (!emitter)
      return () => {
        /* no-op */
      };

    const handler = (code: number) => callback(code);
    emitter.on("exit", handler);

    return () => {
      emitter.off("exit", handler);
    };
  }

  /**
   * Heuristic: classify whether a terminal title indicates an idle shell prompt.
   * Shells typically set title to shell name, cwd, or user@host:path when idle.
   */
  private isIdleTitle(title: string): boolean {
    const trimmed = title.trim();
    if (trimmed.length === 0) return true;

    if (trimmed.startsWith("/") || trimmed.startsWith("~")) return true;
    if (/^[^\s@]+@[^\s:]+:/.test(trimmed)) return true;
    if (/^(bash|zsh|fish|sh|pwsh|powershell)$/i.test(trimmed)) return true;

    return false;
  }

  private markSessionOscDriven(sessionId: string): void {
    this.sessionsWithOscActivity.add(sessionId);
    const fallback = this.noOscIdleFallbacks.get(sessionId);
    if (fallback != null) {
      clearTimeout(fallback);
      this.noOscIdleFallbacks.delete(sessionId);
    }
  }

  private armNoOscIdleFallback(sessionId: string, minionId: string): void {
    const existing = this.noOscIdleFallbacks.get(sessionId);
    if (existing != null) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.noOscIdleFallbacks.delete(sessionId);
      // Only reset if session still exists and hasn't gained OSC capability.
      if (this.sessionActivity.has(sessionId) && !this.sessionsWithOscActivity.has(sessionId)) {
        this.updateSessionActivity(sessionId, minionId, false);
      }
    }, NO_OSC_IDLE_FALLBACK_MS);

    this.noOscIdleFallbacks.set(sessionId, timer);
  }

  private computeMinionAggregate(minionId: string): {
    activeCount: number;
    totalSessions: number;
  } {
    let activeCount = 0;
    let totalSessions = 0;

    for (const entry of this.sessionActivity.values()) {
      if (entry.minionId === minionId) {
        totalSessions++;
        if (entry.isRunning) {
          activeCount++;
        }
      }
    }

    return { activeCount, totalSessions };
  }

  private updateSessionActivity(sessionId: string, minionId: string, isRunning: boolean): void {
    const previousActivity = this.sessionActivity.get(sessionId);
    const previousRunningState = previousActivity?.isRunning ?? false;

    this.sessionActivity.set(sessionId, { minionId, isRunning });

    if (!previousActivity || previousRunningState !== isRunning) {
      this.activityChangeEmitter.emit("change", minionId);

    }
  }

  private removeSessionActivity(sessionId: string): void {
    const activityEntry = this.sessionActivity.get(sessionId);
    if (!activityEntry) {
      return;
    }

    this.sessionActivity.delete(sessionId);
    this.activityChangeEmitter.emit("change", activityEntry.minionId);
  }

  /** Get terminal activity aggregate for a minion. */
  getMinionActivity(minionId: string): { activeCount: number; totalSessions: number } {
    return this.computeMinionAggregate(minionId);
  }

  /** Get all minion activity aggregates (for initial snapshot). */
  getAllMinionActivity(): Record<string, { activeCount: number; totalSessions: number }> {
    const minionActivity: Record<string, { activeCount: number; totalSessions: number }> = {};
    const minionIds = new Set<string>();

    for (const entry of this.sessionActivity.values()) {
      minionIds.add(entry.minionId);
    }

    for (const minionId of minionIds) {
      minionActivity[minionId] = this.computeMinionAggregate(minionId);
    }

    return minionActivity;
  }

  /** Subscribe to minion-level activity changes. Callback receives minionId. */
  onActivityChange(callback: (minionId: string) => void): () => void {
    this.activityChangeEmitter.on("change", callback);

    return () => {
      this.activityChangeEmitter.off("change", callback);
    };
  }

  /**
   * Get serialized screen state for a session.
   * Called by frontend on reconnect to restore terminal view instantly (~4KB vs 512KB raw replay).
   * Returns VT escape sequences that reconstruct the current screen state.
   *
   * Note: @xterm/addon-serialize v0.14+ automatically includes the alternate buffer switch
   * sequence (\x1b[?1049h) when the terminal is in alternate screen mode (htop, vim, etc.).
   */
  getScreenState(sessionId: string): string {
    const addon = this.serializeAddons.get(sessionId);
    return addon?.serialize() ?? "";
  }

  private emitOutput(sessionId: string, data: string) {
    // Write to headless terminal to maintain parsed state (and generate device-query responses)
    const headless = this.headlessTerminals.get(sessionId);
    headless?.write(data);

    const emitter = this.outputEmitters.get(sessionId);
    if (emitter) {
      emitter.emit("data", data);
    }
  }

  /**
   * Get all sessions for a minion with optional profile metadata.
   * Used by frontend to discover existing sessions to reattach to after reload.
   * Includes profileId so the frontend can seed tab titles for profile-based
   * terminals (e.g. "Google Gemini" instead of "Terminal 2").
   *
   * Lazily restores persisted sessions on first call per minion so we don't
   * eagerly spawn shells for minions the user hasn't opened yet.
   */
  async getMinionSessionIds(
    minionId: string
  ): Promise<Array<{ sessionId: string; profileId?: string | null }>> {
    // Lazy restore: only attempt once per minion per app lifetime.
    if (!this.restoredMinions.has(minionId)) {
      this.restoredMinions.add(minionId);
      await this.restoreMinionSessions(minionId);

      // Reconcile kanban: any "active" card whose PTY failed to restore
      // gets moved to "completed" so the board doesn't show stale sessions.
      // Must be awaited so the kanban state is consistent before listSessions returns.
      const liveIds = this.ptyService.getMinionSessionIds(minionId);
      await this.kanbanService?.reconcileActiveCards(minionId, liveIds);
    }

    return this.ptyService.getMinionSessionIds(minionId).map((sessionId) => ({
      sessionId,
      profileId: this.sessionProfiles.get(sessionId)?.profileId ?? null,
    }));
  }

  /**
   * Get live PTY sessions for a minion with profile metadata.
   * No lazy restore — just returns what's currently alive in the PTY layer.
   * Used by kanban reconciliation to sync active cards with live sessions.
   */
  getLiveSessions(minionId: string): Array<{
    sessionId: string;
    profileId?: string;
    profileName: string;
  }> {
    return this.ptyService.getMinionSessionIds(minionId).map((sessionId) => {
      const profile = this.sessionProfiles.get(sessionId);
      return {
        sessionId,
        profileId: profile?.profileId,
        profileName: profile?.profileCommand ?? "Default Terminal",
      };
    });
  }

  private getTrackedSessionIdsForMinion(minionId: string): string[] {
    return Array.from(this.sessionActivity.entries())
      .filter(([, entry]) => entry.minionId === minionId)
      .map(([sessionId]) => sessionId);
  }

  private terminateTrackedSessions(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      try {
        this.ptyService.closeSession(sessionId);
      } finally {
        this.cleanup(sessionId);
      }
    }
  }

  /**
   * Close all terminal sessions for a minion.
   * Called when a minion is removed to prevent resource leaks.
   */
  closeMinionSessions(minionId: string): void {
    const sessionIds = this.getTrackedSessionIdsForMinion(minionId);
    this.terminateTrackedSessions(sessionIds);

    // User explicitly closed all sessions — delete persistence file so they
    // don't resurrect on next restart.
    this.sessionFileManager.delete(minionId).catch((err) => {
      log.error(`[Persist] Failed to delete terminals.json for ${minionId}:`, err);
    });
  }

  /**
   * Close all terminal sessions.
   * Called during server shutdown to prevent orphan PTY processes.
   */
  closeAllSessions(): void {
    const sessionIds = Array.from(this.sessionActivity.keys());
    this.terminateTrackedSessions(sessionIds);
  }

  // ---------------------------------------------------------------------------
  // Persistence — save screen buffers on shutdown, restore on next startup
  // ---------------------------------------------------------------------------

  /**
   * Serialize all live sessions to disk so they survive app restart.
   * Called from ServiceContainer.dispose() BEFORE PTY processes are killed.
   */
  async saveAllSessions(): Promise<void> {
    // Group sessions by minion for per-minion file writes.
    const byMinion = new Map<string, PersistedTerminalSession[]>();

    for (const [sessionId, activity] of this.sessionActivity) {
      const screenBuffer = this.getScreenState(sessionId);

      // Guard against degenerate sessions with huge buffers.
      if (Buffer.byteLength(screenBuffer, "utf-8") > MAX_PERSIST_BUFFER_BYTES) {
        log.info(`[Persist] Skipping session ${sessionId}: screen buffer exceeds 1MB`);
        continue;
      }

      const headless = this.headlessTerminals.get(sessionId);
      const profile = this.sessionProfiles.get(sessionId);

      const persisted: PersistedTerminalSession = {
        sessionId,
        minionId: activity.minionId,
        screenBuffer,
        cols: headless?.cols ?? 80,
        rows: headless?.rows ?? 24,
        profileId: profile?.profileId,
        profileCommand: profile?.profileCommand,
        profileArgs: profile?.profileArgs,
        profileEnv: profile?.profileEnv,
      };

      let list = byMinion.get(activity.minionId);
      if (!list) {
        list = [];
        byMinion.set(activity.minionId, list);
      }
      list.push(persisted);
    }

    // Write one terminals.json per minion (parallel).
    const writes = Array.from(byMinion.entries()).map(async ([minionId, sessions]) => {
      const state: PersistedTerminalState = { version: 1, sessions };
      const result = await this.sessionFileManager.write(minionId, state);
      if (result.success) {
        log.info(`[Persist] Saved ${sessions.length} session(s) for minion ${minionId}`);
      } else {
        log.error(`[Persist] Failed to save sessions for minion ${minionId}: ${result.error}`);
      }
    });

    await Promise.all(writes);
  }

  /**
   * Restore previously persisted sessions for a minion.
   * Creates fresh PTY processes with the same session IDs and seeds headless
   * terminals with old screen buffers so getScreenState() returns scrollback.
   *
   * Called lazily on first getMinionSessionIds() — avoids eagerly spawning
   * shells for minions the user hasn't opened yet.
   */
  private async restoreMinionSessions(minionId: string): Promise<void> {
    let state: PersistedTerminalState | null = null;
    try {
      state = await this.sessionFileManager.read(minionId);
    } catch (error) {
      // Self-healing: corrupted file is silently ignored.
      log.error(`[Persist] Failed to read terminals.json for ${minionId}:`, error);
    }

    if (!state?.sessions?.length) return;

    // Delete file immediately after reading — prevents stale data if app crashes
    // before the next save cycle.
    await this.sessionFileManager.delete(minionId);

    log.info(`[Persist] Restoring ${state.sessions.length} session(s) for minion ${minionId}`);

    for (const persisted of state.sessions) {
      try {
        await this.create(
          {
            minionId,
            cols: persisted.cols,
            rows: persisted.rows,
            // Re-apply profile info so the PTY spawns the right command.
            profileId: persisted.profileId,
            profileCommand: persisted.profileCommand,
            profileArgs: persisted.profileArgs,
            profileEnv: persisted.profileEnv,
          },
          {
            restoreSessionId: persisted.sessionId,
            restoreScreenBuffer: persisted.screenBuffer,
          }
        );
      } catch (error) {
        // Self-healing: skip individual session failures without blocking the rest.
        log.error(`[Persist] Failed to restore session ${persisted.sessionId}:`, error);
      }
    }
  }

  private cleanup(sessionId: string) {
    const disposeHeadlessOnData = this.headlessOnDataDisposables.get(sessionId);
    disposeHeadlessOnData?.dispose();
    this.headlessOnDataDisposables.delete(sessionId);

    // Clean up activity tracking
    const disposeTitleChange = this.titleChangeDisposables.get(sessionId);
    disposeTitleChange?.dispose();
    this.titleChangeDisposables.delete(sessionId);
    this.removeSessionActivity(sessionId);
    this.sessionsWithOscActivity.delete(sessionId);
    const fallback = this.noOscIdleFallbacks.get(sessionId);
    if (fallback != null) {
      clearTimeout(fallback);
      this.noOscIdleFallbacks.delete(sessionId);
    }

    this.outputEmitters.delete(sessionId);
    this.exitEmitters.delete(sessionId);

    // Dispose and clean up headless terminal
    const headless = this.headlessTerminals.get(sessionId);
    headless?.dispose();
    this.headlessTerminals.delete(sessionId);
    this.serializeAddons.delete(sessionId);

    // Clean up profile tracking for persistence.
    this.sessionProfiles.delete(sessionId);
  }
}
