import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { GlobalWindow } from "happy-dom";
import React from "react";
import { APIProvider, type APIClient } from "@/browser/contexts/API";
import { ProjectProvider } from "@/browser/contexts/ProjectContext";
import { ThinkingProvider } from "@/browser/contexts/ThinkingContext";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import {
  DEFAULT_RUNTIME_KEY,
  GLOBAL_SCOPE_ID,
  getAgentIdKey,
  getLastRuntimeConfigKey,
  getProjectScopeId,
  getRuntimeKey,
} from "@/common/constants/storage";
import { LATTICE_RUNTIME_PLACEHOLDER } from "@/common/types/runtime";
import { useDraftMinionSettings } from "./useDraftMinionSettings";

function createStubApiClient(): APIClient {
  // useModelLRU() only needs providers.getConfig + providers.onConfigChanged.
  // Provide a minimal stub so tests can run without spinning up a real oRPC client.
  async function* empty() {
    // no-op
  }

  return {
    providers: {
      getConfig: () => Promise.resolve({}),
      onConfigChanged: () => Promise.resolve(empty()),
    },
    // ProjectProvider calls api.projects.list() on mount.
    projects: {
      list: () => Promise.resolve([]),
    },
  } as unknown as APIClient;
}

describe("useDraftMinionSettings", () => {
  beforeEach(() => {
    globalThis.window = new GlobalWindow() as unknown as Window & typeof globalThis;
    globalThis.document = globalThis.window.document;
    globalThis.localStorage = globalThis.window.localStorage;
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    globalThis.window = undefined as unknown as Window & typeof globalThis;
    globalThis.document = undefined as unknown as Document;
  });

  test("uses global default agent when project preference is unset", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(getAgentIdKey(GLOBAL_SCOPE_ID), "ask");

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.settings.agentId).toBe("ask");
    });
  });

  test("prefers project agent over global default", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(getAgentIdKey(GLOBAL_SCOPE_ID), "ask");
    updatePersistedState(getAgentIdKey(getProjectScopeId(projectPath)), "plan");

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.settings.agentId).toBe("plan");
    });
  });

  test("does not reset selected runtime to the default while editing SSH host", async () => {
    const projectPath = "/tmp/project";

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    act(() => {
      result.current.setSelectedRuntime({ mode: "ssh", host: "dev@host" });
    });

    await waitFor(() => {
      expect(result.current.settings.selectedRuntime).toEqual({ mode: "ssh", host: "dev@host" });
    });
  });

  test("seeds SSH host from the remembered value when switching modes", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(getLastRuntimeConfigKey(projectPath), {
      ssh: { host: "remembered@host" },
    });

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    act(() => {
      // Simulate UI switching into ssh mode with an empty field.
      result.current.setSelectedRuntime({ mode: "ssh", host: "" });
    });

    await waitFor(() => {
      expect(result.current.settings.selectedRuntime).toEqual({
        mode: "ssh",
        host: "remembered@host",
      });
    });
  });

  test("seeds Docker image from the remembered value when switching modes", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(getLastRuntimeConfigKey(projectPath), {
      docker: { image: "ubuntu:22.04", shareCredentials: true },
    });

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    act(() => {
      // Simulate UI switching into docker mode with an empty field.
      result.current.setSelectedRuntime({ mode: "docker", image: "" });
    });

    await waitFor(() => {
      expect(result.current.settings.selectedRuntime).toEqual({
        mode: "docker",
        image: "ubuntu:22.04",
        shareCredentials: true,
      });
    });
  });

  test("keeps Lattice default even after plain SSH usage", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(DEFAULT_RUNTIME_KEY, "lattice");
    updatePersistedState(getRuntimeKey(projectPath), "ssh dev@host");
    updatePersistedState(getLastRuntimeConfigKey(projectPath), {
      ssh: {
        host: "dev@host",
        latticeEnabled: false,
        latticeConfig: { existingMinion: false },
      },
    });

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.settings.defaultRuntimeMode).toBe("lattice");
      expect(result.current.settings.selectedRuntime).toEqual({
        mode: "ssh",
        host: LATTICE_RUNTIME_PLACEHOLDER,
        lattice: { existingMinion: false },
      });
    });
  });

  test("persists Lattice default string when toggling default", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(getLastRuntimeConfigKey(projectPath), {
      ssh: {
        host: "dev@host",
        latticeEnabled: false,
        latticeConfig: { existingMinion: false },
      },
    });

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    act(() => {
      result.current.setDefaultRuntimeChoice("lattice");
    });

    await waitFor(() => {
      expect(result.current.settings.selectedRuntime).toEqual({
        mode: "ssh",
        host: LATTICE_RUNTIME_PLACEHOLDER,
        lattice: { existingMinion: false },
      });
    });

    const defaultRuntimeString = readPersistedState<string | undefined>(
      getRuntimeKey(projectPath),
      undefined
    );
    expect(defaultRuntimeString).toBe(`ssh ${LATTICE_RUNTIME_PLACEHOLDER}`);
  });

  test("exposes persisted Lattice config as fallback when re-selecting Lattice", async () => {
    const projectPath = "/tmp/project";
    const savedLatticeConfig = { existingMinion: true, minionName: "saved-minion" };

    updatePersistedState(getLastRuntimeConfigKey(projectPath), {
      ssh: {
        host: "dev@host",
        latticeEnabled: false,
        latticeConfig: savedLatticeConfig,
      },
    });

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.latticeConfigFallback).toEqual(savedLatticeConfig);
    });
  });

  test("exposes persisted SSH host as fallback when leaving Lattice", async () => {
    const projectPath = "/tmp/project";

    updatePersistedState(getLastRuntimeConfigKey(projectPath), {
      ssh: {
        host: "dev@host",
      },
    });

    const wrapper: React.FC<{ children: React.ReactNode }> = (props) => (
      <APIProvider client={createStubApiClient()}>
        <ProjectProvider>
          <ThinkingProvider projectPath={projectPath}>{props.children}</ThinkingProvider>
        </ProjectProvider>
      </APIProvider>
    );

    const { result } = renderHook(() => useDraftMinionSettings(projectPath, ["main"], "main"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.sshHostFallback).toBe("dev@host");
    });
  });
});
