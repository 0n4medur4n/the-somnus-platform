import type { GabaAtomDefinition, GabaBondDefinition, GabaConnectionStep } from "./gaba.types";

export const GABA_ATOMS: readonly GabaAtomDefinition[] = [
  { id: "nitrogen", element: "N", label: "NH₂", x: 92, y: 228, radius: 35, depth: "front" },
  {
    id: "carbon-1",
    element: "C",
    label: "CH₂",
    x: 186,
    y: 184,
    radius: 32,
    depth: "middle",
  },
  {
    id: "carbon-2",
    element: "C",
    label: "CH₂",
    x: 282,
    y: 244,
    radius: 34,
    depth: "front",
  },
  {
    id: "carbon-3",
    element: "C",
    label: "CH₂",
    x: 382,
    y: 190,
    radius: 31,
    depth: "back",
  },
  { id: "carbon-4", element: "C", label: "C", x: 478, y: 246, radius: 35, depth: "front" },
  {
    id: "oxygen-1",
    element: "O",
    label: "O",
    x: 574,
    y: 184,
    radius: 31,
    depth: "middle",
  },
  { id: "oxygen-2", element: "O", label: "OH", x: 580, y: 302, radius: 33, depth: "front" },
] as const;

export const GABA_FORMULA_LABEL = "NH₂–CH₂–CH₂–CH₂–COOH";

export const GABA_BONDS: readonly GabaBondDefinition[] = [
  { id: "bond-1", path: "M118 216 L158 197", connects: ["nitrogen", "carbon-1"] },
  { id: "bond-2", path: "M212 199 L254 226", connects: ["carbon-1", "carbon-2"] },
  { id: "bond-3", path: "M311 228 L354 205", connects: ["carbon-2", "carbon-3"] },
  { id: "bond-4", path: "M409 206 L449 230", connects: ["carbon-3", "carbon-4"] },
  {
    id: "bond-carbonyl-primary",
    path: "M505 226 L548 198",
    connects: ["carbon-4", "oxygen-1"],
  },
  {
    id: "bond-carbonyl-secondary",
    path: "M511 236 L554 208",
    connects: ["carbon-4", "oxygen-1"],
  },
  {
    id: "bond-hydroxyl",
    path: "M506 267 L551 290",
    connects: ["carbon-4", "oxygen-2"],
  },
] as const;

// Each atom begins over the atom that precedes it in the chain. During the
// connection phase, the new bond and its destination atom advance together.
export const GABA_CONNECTION_STEPS: readonly GabaConnectionStep[] = [
  { atomId: "carbon-1", bondIds: ["bond-1"], fromX: -94, fromY: 44 },
  { atomId: "carbon-2", bondIds: ["bond-2"], fromX: -96, fromY: -60 },
  { atomId: "carbon-3", bondIds: ["bond-3"], fromX: -100, fromY: 54 },
  { atomId: "carbon-4", bondIds: ["bond-4"], fromX: -96, fromY: -56 },
  {
    atomId: "oxygen-1",
    bondIds: ["bond-carbonyl-primary", "bond-carbonyl-secondary"],
    fromX: -96,
    fromY: 62,
  },
  { atomId: "oxygen-2", bondIds: ["bond-hydroxyl"], fromX: -102, fromY: -56 },
] as const;

export const GABA_TIMING = {
  intro: 0,
  signals: 0.12,
  connection: 0.36,
  structure: 0.72,
  morpheo: 0.84,
  conversion: 0.96,
} as const;

const signalSlotDuration = (GABA_TIMING.connection - GABA_TIMING.signals) / 5;

export const GABA_SIGNAL_SEQUENCE = ([0, 1, 2, 3, 4] as const).map((signalIndex) => {
  const start = GABA_TIMING.signals + signalSlotDuration * signalIndex;
  return {
    appearDuration: signalSlotDuration * 0.22,
    fadeDuration: signalSlotDuration * 0.28,
    fadeStart: start + signalSlotDuration * 0.62,
    signalIndex,
    start,
  };
});

export const GABA_MEDIA_QUERIES = {
  all: "all",
  reduced: "(prefers-reduced-motion: reduce)",
} as const;
