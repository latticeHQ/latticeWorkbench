import { describe, expect, test } from "bun:test";
import { buildAutoSelectedTemplateConfig } from "./useLatticeMinion";
import type { LatticeTemplate } from "@/common/orpc/schemas/lattice";

const makeTemplate = (name: string, org = "default-org"): LatticeTemplate => ({
  name,
  displayName: name,
  organizationName: org,
});

describe("buildAutoSelectedTemplateConfig", () => {
  test("preserves preset when auto-selecting first template", () => {
    const currentConfig = { preset: "my-preset" };
    const templates = [makeTemplate("template-a")];

    const result = buildAutoSelectedTemplateConfig(currentConfig, templates);

    expect(result).toEqual({
      preset: "my-preset",
      existingMinion: false,
      template: "template-a",
      templateOrg: "default-org",
    });
  });

  test("sets templateOrg when first template name is duplicated across orgs", () => {
    const templates = [makeTemplate("shared-name", "org-1"), makeTemplate("shared-name", "org-2")];

    const result = buildAutoSelectedTemplateConfig(null, templates);

    expect(result).toEqual({
      existingMinion: false,
      template: "shared-name",
      templateOrg: "org-1",
    });
  });

  test("returns null when template is already selected", () => {
    const currentConfig = { template: "existing-template" };
    const templates = [makeTemplate("template-a")];

    expect(buildAutoSelectedTemplateConfig(currentConfig, templates)).toBeNull();
  });

  test("returns null when existingMinion is true", () => {
    const currentConfig = { existingMinion: true };
    const templates = [makeTemplate("template-a")];

    expect(buildAutoSelectedTemplateConfig(currentConfig, templates)).toBeNull();
  });

  test("returns null when templates array is empty", () => {
    expect(buildAutoSelectedTemplateConfig(null, [])).toBeNull();
  });
});
