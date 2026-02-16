import { z } from "zod";

// Lattice workspace config - attached to SSH runtime when using Lattice
export const LatticeWorkspaceConfigSchema = z.object({
  /**
   * Lattice workspace name.
   * - For new workspaces: omit or undefined (backend derives from lattice branch name)
   * - For existing workspaces: required (the selected Lattice workspace name)
   * - After creation: populated with the actual Lattice workspace name for reference
   */
  workspaceName: z.string().optional().meta({ description: "Lattice workspace name" }),
  template: z.string().optional().meta({ description: "Template used to create workspace" }),
  templateOrg: z.string().optional().meta({
    description: "Template organization (for disambiguation when templates have same name)",
  }),
  preset: z.string().optional().meta({ description: "Preset used during creation" }),

  /** True if connected to pre-existing Lattice workspace (vs lattice creating one). */
  existingWorkspace: z.boolean().optional().meta({
    description: "True if connected to pre-existing Lattice workspace",
  }),
});

export type LatticeWorkspaceConfig = z.infer<typeof LatticeWorkspaceConfigSchema>;

// Lattice CLI unavailable reason - "missing" or error with message
export const LatticeUnavailableReasonSchema = z.union([
  z.literal("missing"),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);

export type LatticeUnavailableReason = z.infer<typeof LatticeUnavailableReasonSchema>;

// Lattice CLI availability info - discriminated union by state
export const LatticeInfoSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), version: z.string() }),
  z.object({ state: z.literal("outdated"), version: z.string(), minVersion: z.string() }),
  z.object({ state: z.literal("unavailable"), reason: LatticeUnavailableReasonSchema }),
]);

export type LatticeInfo = z.infer<typeof LatticeInfoSchema>;

// Lattice template
export const LatticeTemplateSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  organizationName: z.string(),
});

export type LatticeTemplate = z.infer<typeof LatticeTemplateSchema>;

// Lattice preset for a template
export const LatticePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),
});

export type LatticePreset = z.infer<typeof LatticePresetSchema>;

// Lattice workspace status
export const LatticeWorkspaceStatusSchema = z.enum([
  "running",
  "stopped",
  "starting",
  "stopping",
  "failed",
  "pending",
  "canceling",
  "canceled",
  "deleting",
  "deleted",
]);

export type LatticeWorkspaceStatus = z.infer<typeof LatticeWorkspaceStatusSchema>;

// Lattice workspace
export const LatticeWorkspaceSchema = z.object({
  name: z.string(),
  templateName: z.string(),
  templateDisplayName: z.string(),
  status: LatticeWorkspaceStatusSchema,
});

export type LatticeWorkspace = z.infer<typeof LatticeWorkspaceSchema>;

// Lattice whoami - authentication identity check
export const LatticeWhoamiSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("authenticated"),
    username: z.string(),
    deploymentUrl: z.string(),
  }),
  z.object({
    state: z.literal("unauthenticated"),
    reason: z.string(),
  }),
]);

export type LatticeWhoami = z.infer<typeof LatticeWhoamiSchema>;

// API schemas for lattice namespace
export const lattice = {
  getInfo: {
    input: z.void(),
    output: LatticeInfoSchema,
  },
  listTemplates: {
    input: z.void(),
    output: z.array(LatticeTemplateSchema),
  },
  listPresets: {
    input: z.object({
      template: z.string(),
      org: z.string().optional().meta({ description: "Organization name for disambiguation" }),
    }),
    output: z.array(LatticePresetSchema),
  },
  listWorkspaces: {
    input: z.void(),
    output: z.array(LatticeWorkspaceSchema),
  },
  whoami: {
    input: z.object({
      refresh: z.boolean().optional().meta({ description: "Clear cache and re-check" }),
    }).optional(),
    output: LatticeWhoamiSchema,
  },
};
