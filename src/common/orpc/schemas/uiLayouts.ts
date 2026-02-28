import type {
  WorkbenchPanelLayoutPresetNode,
  WorkbenchPanelPresetTabType,
} from "@/common/types/uiLayouts";
import { z } from "zod";

export const KeybindSchema = z
  // Keep in sync with the Keybind type (including allowShift). Strict schemas will
  // otherwise reject normalized config objects that include optional fields.
  .object({
    key: z.string().min(1),
    allowShift: z.boolean().optional(),
    ctrl: z.boolean().optional(),
    shift: z.boolean().optional(),
    alt: z.boolean().optional(),
    meta: z.boolean().optional(),
    macCtrlBehavior: z.enum(["either", "command", "control"]).optional(),
  })
  .strict();

const WorkbenchPanelPresetBaseTabSchema = z.enum(["costs", "review", "explorer", "stats"]);

export const WorkbenchPanelPresetTabSchema: z.ZodType<WorkbenchPanelPresetTabType> = z.union([
  WorkbenchPanelPresetBaseTabSchema,
  z
    .string()
    .min("terminal_new:".length + 1)
    .regex(/^terminal_new:.+$/),
]) as z.ZodType<WorkbenchPanelPresetTabType>;

export const WorkbenchPanelLayoutPresetNodeSchema: z.ZodType<WorkbenchPanelLayoutPresetNode> = z.lazy(
  () => {
    const tabset = z
      .object({
        type: z.literal("tabset"),
        id: z.string().min(1),
        tabs: z.array(WorkbenchPanelPresetTabSchema),
        activeTab: WorkbenchPanelPresetTabSchema,
      })
      .strict();

    const split = z
      .object({
        type: z.literal("split"),
        id: z.string().min(1),
        direction: z.enum(["horizontal", "vertical"]),
        sizes: z.tuple([z.number(), z.number()]),
        children: z.tuple([WorkbenchPanelLayoutPresetNodeSchema, WorkbenchPanelLayoutPresetNodeSchema]),
      })
      .strict();

    return z.union([split, tabset]);
  }
);

export const WorkbenchPanelLayoutPresetStateSchema = z
  .object({
    version: z.literal(1),
    nextId: z.number().int(),
    focusedTabsetId: z.string().min(1),
    root: WorkbenchPanelLayoutPresetNodeSchema,
  })
  .strict();

export const WorkbenchPanelWidthPresetSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("px"),
      value: z.number().int(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("fraction"),
      value: z.number(),
    })
    .strict(),
]);

export const LayoutPresetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    leftSidebarCollapsed: z.boolean(),
    leftSidebarWidthPx: z.number().int().optional(),
    workbenchPanel: z
      .object({
        collapsed: z.boolean(),
        width: WorkbenchPanelWidthPresetSchema,
        layout: WorkbenchPanelLayoutPresetStateSchema,
      })
      .strict(),
  })
  .strict();

export const LayoutSlotSchema = z
  .object({
    slot: z.number().int().min(1),
    preset: LayoutPresetSchema.optional(),
    keybindOverride: KeybindSchema.optional(),
  })
  .strict();

export const LayoutPresetsConfigSchema = z
  .object({
    version: z.literal(2),
    slots: z.array(LayoutSlotSchema),
  })
  .strict();
