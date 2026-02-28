import { describe, it, expect } from "bun:test";
import {
  LATTICE_MD_BASE_URL,
  deleteFromLatticeMd,
  downloadFromLatticeMd,
  getLatticeMdBaseUrl,
  isLatticeMdUrl,
  parseLatticeMdUrl,
  uploadToLatticeMd,
} from "./latticeMd";

const itIntegration = process.env.TEST_INTEGRATION === "1" ? it : it.skip;

describe("latticeMd", () => {
  describe("getLatticeMdBaseUrl", () => {
    it("should default to the production lattice.md origin", () => {
      const originalOverride = process.env.LATTICE_MD_URL_OVERRIDE;

      try {
        delete process.env.LATTICE_MD_URL_OVERRIDE;
        expect(getLatticeMdBaseUrl()).toBe(LATTICE_MD_BASE_URL);
      } finally {
        if (originalOverride === undefined) {
          delete process.env.LATTICE_MD_URL_OVERRIDE;
        } else {
          process.env.LATTICE_MD_URL_OVERRIDE = originalOverride;
        }
      }
    });

    it("should normalize and accept a LATTICE_MD_URL_OVERRIDE host", () => {
      const originalOverride = process.env.LATTICE_MD_URL_OVERRIDE;
      process.env.LATTICE_MD_URL_OVERRIDE = "https://lattice-md-staging.test/some/path";

      try {
        expect(getLatticeMdBaseUrl()).toBe("https://lattice-md-staging.test");

        // Override host should be allowed.
        expect(isLatticeMdUrl("https://lattice-md-staging.test/abc123#key456")).toBe(true);

        // Production links should still be recognized while an override is set.
        expect(isLatticeMdUrl("https://lattice.md/abc123#key456")).toBe(true);

        expect(isLatticeMdUrl("https://not-lattice-md.test/abc123#key456")).toBe(false);
      } finally {
        if (originalOverride === undefined) {
          delete process.env.LATTICE_MD_URL_OVERRIDE;
        } else {
          process.env.LATTICE_MD_URL_OVERRIDE = originalOverride;
        }
      }
    });

    it("should prefer window.api.latticeMdUrlOverride over process.env", () => {
      const originalOverride = process.env.LATTICE_MD_URL_OVERRIDE;
      const globalWithWindow = globalThis as unknown as {
        window?: {
          api?: {
            latticeMdUrlOverride?: string;
          };
        };
      };
      const originalWindow = globalWithWindow.window;

      process.env.LATTICE_MD_URL_OVERRIDE = "https://lattice-md-staging.test";
      globalWithWindow.window = {
        api: {
          latticeMdUrlOverride: "http://localhost:8787/foo",
        },
      };

      try {
        expect(getLatticeMdBaseUrl()).toBe("http://localhost:8787");
      } finally {
        if (originalOverride === undefined) {
          delete process.env.LATTICE_MD_URL_OVERRIDE;
        } else {
          process.env.LATTICE_MD_URL_OVERRIDE = originalOverride;
        }

        if (originalWindow === undefined) {
          delete globalWithWindow.window;
        } else {
          globalWithWindow.window = originalWindow;
        }
      }
    });

    it("should use globalThis.__LATTICE_MD_URL_OVERRIDE__ in browser mode without preload", () => {
      const originalOverride = process.env.LATTICE_MD_URL_OVERRIDE;
      const originalDefineOverride = globalThis.__LATTICE_MD_URL_OVERRIDE__;
      const globalWithWindow = globalThis as unknown as {
        window?: Record<string, unknown>;
      };
      const originalWindow = globalWithWindow.window;

      // When running `make dev-server`, the renderer runs in a normal browser where `window.api`
      // is not available, so we rely on the Vite-injected define.
      process.env.LATTICE_MD_URL_OVERRIDE = "https://should-not-be-used.test";
      globalThis.__LATTICE_MD_URL_OVERRIDE__ = "https://lattice-md-staging.test/some/path";
      globalWithWindow.window = {};

      try {
        expect(getLatticeMdBaseUrl()).toBe("https://lattice-md-staging.test");
      } finally {
        if (originalOverride === undefined) {
          delete process.env.LATTICE_MD_URL_OVERRIDE;
        } else {
          process.env.LATTICE_MD_URL_OVERRIDE = originalOverride;
        }

        globalThis.__LATTICE_MD_URL_OVERRIDE__ = originalDefineOverride;

        if (originalWindow === undefined) {
          delete globalWithWindow.window;
        } else {
          globalWithWindow.window = originalWindow;
        }
      }
    });
  });

  describe("isLatticeMdUrl", () => {
    it("should detect valid lattice.md URLs", () => {
      expect(isLatticeMdUrl("https://lattice.md/abc123#key456")).toBe(true);
      expect(isLatticeMdUrl("https://lattice.md/RQJe3#Fbbhosspt9q9Ig")).toBe(true);
    });

    it("should reject URLs without fragment", () => {
      expect(isLatticeMdUrl("https://lattice.md/abc123")).toBe(false);
      expect(isLatticeMdUrl("https://lattice.md/abc123#")).toBe(false);
    });

    it("should reject non-lattice.md URLs", () => {
      expect(isLatticeMdUrl("https://example.com/page#hash")).toBe(false);
    });
  });

  describe("parseLatticeMdUrl", () => {
    it("should extract id and key from URL", () => {
      expect(parseLatticeMdUrl("https://lattice.md/abc123#key456")).toEqual({
        id: "abc123",
        key: "key456",
      });
    });

    it("should return null for invalid URLs", () => {
      expect(parseLatticeMdUrl("https://lattice.md/abc123")).toBeNull();
      expect(parseLatticeMdUrl("https://lattice.md/#key")).toBeNull();
      expect(parseLatticeMdUrl("not-a-url")).toBeNull();
    });
  });

  // Round-trip test: upload then download
  itIntegration("should upload and download content correctly", async () => {
    const testContent = "# Test Message\n\nThis is a test of lattice.md encryption.";
    const testFileInfo = {
      name: "test-message.md",
      type: "text/markdown",
      size: testContent.length,
      model: "test-model",
    };

    // Upload
    const uploadResult = await uploadToLatticeMd(testContent, testFileInfo, {
      expiresAt: new Date(Date.now() + 60000), // Expire in 1 minute
    });

    expect(uploadResult.url).toContain(`${getLatticeMdBaseUrl()}/`);
    expect(uploadResult.url).toContain("#");
    expect(uploadResult.id).toBeTruthy();
    expect(uploadResult.key).toBeTruthy();
    expect(uploadResult.mutateKey).toBeTruthy();

    try {
      // Download and decrypt
      const downloadResult = await downloadFromLatticeMd(uploadResult.id, uploadResult.key);

      expect(downloadResult.content).toBe(testContent);
      expect(downloadResult.fileInfo).toBeDefined();
      expect(downloadResult.fileInfo?.name).toBe("test-message.md");
      expect(downloadResult.fileInfo?.model).toBe("test-model");
    } finally {
      // Clean up - delete the uploaded file
      await deleteFromLatticeMd(uploadResult.id, uploadResult.mutateKey);
    }
  });

  itIntegration("should fail gracefully for non-existent shares", async () => {
    let error: Error | undefined;
    try {
      await downloadFromLatticeMd("nonexistent123", "fakekey456");
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/not found|expired/i);
  });
});
