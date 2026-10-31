export type NoxModuleId = "assistant" | "evidence-search";

export type NoxModule = {
  readonly id: NoxModuleId;
  readonly titleKey: "modules.assistant.title" | "modules.evidence.title";
  readonly statusKey: "modules.assistant.status" | "modules.evidence.status";
};

/** Typed tool list. Entries are placeholders until later tasks. */
export const NOX_MODULES: readonly NoxModule[] = [
  {
    id: "assistant",
    titleKey: "modules.assistant.title",
    statusKey: "modules.assistant.status",
  },
  {
    id: "evidence-search",
    titleKey: "modules.evidence.title",
    statusKey: "modules.evidence.status",
  },
];
