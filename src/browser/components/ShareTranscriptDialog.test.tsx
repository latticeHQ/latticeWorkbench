import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { APIClient } from "@/browser/contexts/API";
import type { MinionStore } from "@/browser/stores/MinionStore";
import { useMinionStoreRaw } from "@/browser/stores/MinionStore";
import { APIProvider } from "@/browser/contexts/API";
import { TooltipProvider } from "@/browser/components/ui/tooltip";
import { addEphemeralMessage } from "@/browser/stores/MinionStore";
import * as latticeMd from "@/common/lib/latticeMd";
import { GlobalWindow } from "happy-dom";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

void mock.module("@/browser/components/ui/dialog", () => ({
  Dialog: (props: { open: boolean; children: ReactNode }) =>
    props.open ? <div>{props.children}</div> : null,
  DialogContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogTitle: (props: { children: ReactNode; className?: string }) => (
    <h2 className={props.className}>{props.children}</h2>
  ),
}));

import { ShareTranscriptDialog } from "./ShareTranscriptDialog";

const TEST_MINION_ID = "ws-1";

function getStore(): MinionStore {
  return (useMinionStoreRaw as unknown as () => MinionStore)();
}

function createApiClient(): APIClient {
  return {
    signing: {
      capabilities: () => Promise.resolve({ publicKey: null, githubUser: null, error: null }),
      clearIdentityCache: () => Promise.resolve({ success: true }),
      signMessage: () => Promise.resolve({ sig: "sig", publicKey: "public-key" }),
    },
    minion: {
      getPlanContent: () => Promise.resolve({ success: false, error: "not-needed" }),
    },
  } as unknown as APIClient;
}

function renderDialog() {
  return render(
    <APIProvider client={createApiClient()}>
      <TooltipProvider>
        <ShareTranscriptDialog
          minionId={TEST_MINION_ID}
          minionName="minion-1"
          minionTitle="Minion 1"
          open
          onOpenChange={() => undefined}
        />
      </TooltipProvider>
    </APIProvider>
  );
}

describe("ShareTranscriptDialog", () => {
  let originalWindow: typeof globalThis.window;
  let originalDocument: typeof globalThis.document;
  let originalGetComputedStyle: typeof globalThis.getComputedStyle;

  beforeEach(() => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;

    const dom = new GlobalWindow();
    globalThis.window = dom as unknown as Window & typeof globalThis;
    globalThis.document = globalThis.window.document;

    originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = globalThis.window.getComputedStyle.bind(globalThis.window);

    // Ensure test isolation from other suites that attach a mock ORPC client.
    // Share dialog tests operate on local ephemeral messages and should not race
    // onChat reconnect loops from unrelated MinionStore tests.
    getStore().setClient(null);

    spyOn(console, "error").mockImplementation(() => undefined);

    spyOn(latticeMd, "uploadToLatticeMd").mockResolvedValue({
      url: "https://lattice.md/s/share-1",
      id: "share-1",
      key: "encryption-key",
      mutateKey: "mutate-1",
      expiresAt: Date.now() + 60_000,
    });
    spyOn(latticeMd, "deleteFromLatticeMd").mockResolvedValue(undefined);
    getStore().addMinion({
      id: TEST_MINION_ID,
      name: "minion-1",
      title: "Minion 1",
      projectName: "project",
      projectPath: "/tmp/project",
      namedMinionPath: "/tmp/project/minion-1",
      runtimeConfig: { type: "local" },
      createdAt: new Date().toISOString(),
    });
    addEphemeralMessage(TEST_MINION_ID, {
      id: "user-message-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    });
  });

  afterEach(() => {
    getStore().removeMinion(TEST_MINION_ID);
    cleanup();
    mock.restore();
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  test("deletes an existing shared transcript link and clears the URL", async () => {
    renderDialog();
    const body = within(document.body);

    fireEvent.click(body.getByRole("button", { name: "Generate link" }));

    await waitFor(() => expect(body.getByTestId("share-transcript-url")).toBeTruthy());

    fireEvent.click(body.getByTestId("delete-share-transcript-url"));

    await waitFor(() => expect(latticeMd.deleteFromLatticeMd).toHaveBeenCalledWith("share-1", "mutate-1"));
    await waitFor(() => expect(body.queryByTestId("share-transcript-url")).toBeNull());
  });

  test("keeps shared transcript URL and surfaces an error when delete fails", async () => {
    (latticeMd.deleteFromLatticeMd as unknown as ReturnType<typeof mock>).mockImplementationOnce(() =>
      Promise.reject(new Error("Delete failed"))
    );

    renderDialog();
    const body = within(document.body);

    fireEvent.click(body.getByRole("button", { name: "Generate link" }));

    await waitFor(() => expect(body.getByTestId("share-transcript-url")).toBeTruthy());

    fireEvent.click(body.getByTestId("delete-share-transcript-url"));

    await waitFor(() => expect(latticeMd.deleteFromLatticeMd).toHaveBeenCalledWith("share-1", "mutate-1"));
    await waitFor(() => expect(body.getByRole("alert").textContent).toContain("Delete failed"));
    expect(body.getByTestId("share-transcript-url")).toBeTruthy();
  });
});
