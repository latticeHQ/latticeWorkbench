import assert from "@/common/utils/assert";
import type {
  LatticeReasoningPart,
  LatticeTextPart,
  LatticeToolPart,
} from "@/common/types/message";

export function extractAssistantText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  const textParts = (parts as LatticeTextPart[]).filter(
    (part): part is LatticeTextPart => part.type === "text"
  );
  return textParts
    .map((part) => {
      assert(typeof part.text === "string", "Text part must include text");
      return part.text;
    })
    .join("");
}

export function extractReasoning(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  const reasoningParts = (parts as LatticeReasoningPart[]).filter(
    (part): part is LatticeReasoningPart => part.type === "reasoning"
  );
  return reasoningParts.map((part) => {
    assert(typeof part.text === "string", "Reasoning part must include text");
    return part.text;
  });
}

export function extractToolCalls(parts: unknown): LatticeToolPart[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  return (parts as LatticeToolPart[]).filter(
    (part): part is LatticeToolPart => part.type === "dynamic-tool"
  );
}
