type HostingConfig = {
  hosting: Array<{
    target: string;
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  }>;
};

export const SITES: ReadonlyArray<{ target: string; origin: string; paths: string[] }>;
export function expectedHeaders(config: HostingConfig, target: string): Map<string, string>;
export function expectedAssetCache(config: HostingConfig, target: string): string;
export function compareHeaders(
  actual: { get(name: string): string | null | undefined },
  expected: Map<string, string>,
  label: string,
): string[];
export function metaPolicy(html: string): string | null;
export function policyProblems(policy: string, label: string): string[];
export function checkLiveHeaders(
  config: HostingConfig,
  options?: {
    attempts?: number;
    delayMs?: number;
    sites?: ReadonlyArray<{ target: string; origin: string; paths: string[] }>;
  },
): Promise<string[]>;
