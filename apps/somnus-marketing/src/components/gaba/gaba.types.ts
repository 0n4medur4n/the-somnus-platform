export type GabaAtomId =
  | "nitrogen"
  | "carbon-1"
  | "carbon-2"
  | "carbon-3"
  | "carbon-4"
  | "oxygen-1"
  | "oxygen-2";

export type GabaElement = "N" | "C" | "O";
export type GabaAtomLabel = "NH₂" | "CH₂" | "C" | "O" | "OH";

export interface GabaAtomDefinition {
  id: GabaAtomId;
  element: GabaElement;
  label: GabaAtomLabel;
  x: number;
  y: number;
  radius: number;
  depth: "back" | "middle" | "front";
}

export interface GabaBondDefinition {
  id:
    | "bond-1"
    | "bond-2"
    | "bond-3"
    | "bond-4"
    | "bond-carbonyl-primary"
    | "bond-carbonyl-secondary"
    | "bond-hydroxyl";
  path: string;
  connects: readonly [GabaAtomId, GabaAtomId];
}

export interface GabaConnectionStep {
  atomId: GabaAtomId;
  bondIds: readonly GabaBondDefinition["id"][];
  fromX: number;
  fromY: number;
}

export interface GabaBackgroundCopy {
  moleculeTitle: string;
  moleculeDescription: string;
  signalLabels: readonly [string, string, string, string, string];
}

export interface GabaHeroProps {
  copy: GabaBackgroundCopy;
}
