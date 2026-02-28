import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";

import { getAppProxyBasePathFromPathname, getBrowserBackendBaseUrl } from "./backendBaseUrl";

describe("backendBaseUrl", () => {
  test("getAppProxyBasePathFromPathname() returns null outside /apps/<slug>", () => {
    expect(getAppProxyBasePathFromPathname("/")).toBeNull();
    expect(getAppProxyBasePathFromPathname("/settings")).toBeNull();
    expect(getAppProxyBasePathFromPathname("/@u/ws/app/lattice")).toBeNull();
  });

  test("getAppProxyBasePathFromPathname() returns the /.../apps/<slug> prefix", () => {
    expect(getAppProxyBasePathFromPathname("/@u/ws/apps/lattice/")).toBe("/@u/ws/apps/lattice");
    expect(getAppProxyBasePathFromPathname("/@u/ws/apps/lattice")).toBe("/@u/ws/apps/lattice");
    expect(getAppProxyBasePathFromPathname("/@u/ws/apps/lattice/settings")).toBe("/@u/ws/apps/lattice");
  });

  test("getAppProxyBasePathFromPathname() matches the first /apps/<slug> when multiple exist", () => {
    expect(getAppProxyBasePathFromPathname("/@u/ws/apps/lattice/projects/apps/other")).toBe(
      "/@u/ws/apps/lattice"
    );
  });

  describe("getBrowserBackendBaseUrl()", () => {
    beforeEach(() => {
      globalThis.window = new GlobalWindow() as unknown as Window & typeof globalThis;
      globalThis.document = globalThis.window.document;
    });

    afterEach(() => {
      globalThis.window = undefined as unknown as Window & typeof globalThis;
      globalThis.document = undefined as unknown as Document;
    });

    test("returns origin when hosted at root", () => {
      window.location.href = "https://lattice.example.com/";
      expect(getBrowserBackendBaseUrl()).toBe("https://lattice.example.com");
    });

    test("returns origin + app proxy prefix when hosted under /.../apps/<slug>/", () => {
      window.location.href = "https://lattice.example.com/@u/ws/apps/lattice/";
      expect(getBrowserBackendBaseUrl()).toBe("https://lattice.example.com/@u/ws/apps/lattice");
    });

    test("ignores deeper routes under the app proxy prefix", () => {
      window.location.href = "https://lattice.example.com/@u/ws/apps/lattice/projects/123?x=1";
      expect(getBrowserBackendBaseUrl()).toBe("https://lattice.example.com/@u/ws/apps/lattice");
    });

    test("does not get confused by nested /apps/ segments in routes", () => {
      window.location.href = "https://lattice.example.com/@u/ws/apps/lattice/projects/apps/other";
      expect(getBrowserBackendBaseUrl()).toBe("https://lattice.example.com/@u/ws/apps/lattice");
    });
  });
});
