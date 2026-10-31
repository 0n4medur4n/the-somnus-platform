import { describe, expect, it } from "vitest";
import { devPreview, fetchNoxMe, NOX_DEV_MOCK_SENTINEL } from "./nox-me.mock.js";

describe("dev mock for GET /nox/v1/me", () => {
  it("names itself so a production bundle can be scanned", () => {
    expect(NOX_DEV_MOCK_SENTINEL).toBe("NOX_DEV_MOCK_SENTINEL");
  });

  it("returns a denial body for ?preview=denied and a grant otherwise", async () => {
    window.history.pushState({}, "", "/?preview=denied");
    expect(devPreview()).toBe("denied");
    await expect(fetchNoxMe(new AbortController().signal)).resolves.toEqual({
      verifiedProfessional: false,
      noxAccess: false,
    });

    window.history.pushState({}, "", "/?preview=dashboard");
    expect(devPreview()).toBe("dashboard");

    window.history.pushState({}, "", "/");
    expect(devPreview()).toBeNull();
    await expect(fetchNoxMe(new AbortController().signal)).resolves.toEqual({
      verifiedProfessional: true,
      noxAccess: true,
    });
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchNoxMe(controller.signal)).rejects.toThrow(NOX_DEV_MOCK_SENTINEL);
  });
});
