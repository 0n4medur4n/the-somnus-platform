import { ApiRequestError } from "../lib/api.js";

/** A console session the server no longer accepts. Any request on a save can be the one that finds out. */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}
