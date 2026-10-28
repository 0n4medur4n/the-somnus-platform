import { isExplicitNoxGrant } from "./nox-me.temporary.js";

/** How long GET /nox/v1/me may take before the shell denies access. */
export const NOX_ME_TIMEOUT_MS = 8_000;

export class NoxMeTimeoutError extends Error {
  constructor() {
    super("nox-me-timeout");
    this.name = "NoxMeTimeoutError";
  }
}

export type NoxMeReader = (signal: AbortSignal) => Promise<unknown>;

export async function loadNoxMe(
  read: NoxMeReader,
  timeoutMs = NOX_ME_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NoxMeTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([read(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function grantFromBody(body: unknown): boolean {
  return isExplicitNoxGrant(body);
}
