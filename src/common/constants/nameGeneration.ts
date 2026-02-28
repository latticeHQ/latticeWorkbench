import { getKnownModel } from "@/common/constants/knownModels";

/** Small/fast models preferred for AI-generated minion names and titles. */
export const NAME_GEN_PREFERRED_MODELS = [getKnownModel("HAIKU").id, getKnownModel("GPT_MINI").id];
