import type { MeResponse } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import { accountViewOf } from "./account-view.js";

type Overrides = Partial<Omit<MeResponse, "account">> & {
  account?: Partial<MeResponse["account"]>;
};

function me(overrides: Overrides = {}): MeResponse {
  const { account, ...rest } = overrides;
  return {
    user: { id: "u", email: "u@example.com", locale: "es", status: "active" },
    individualProfile: { firstName: "Ada", lastName: "Lovelace" },
    professionalProfile: null,
    ...rest,
    account: { registrationRole: "adult", internalRoles: [], organizations: [], ...account },
  };
}

describe("accountViewOf", () => {
  it("an adult and a parent are Morpheo users", () => {
    expect(accountViewOf(me())).toEqual({ kind: "adult", isStaff: false, isMorpheoUser: true });
    expect(accountViewOf(me({ account: { registrationRole: "parent" } })).isMorpheoUser).toBe(true);
  });

  it("an account with no recorded branch is a Morpheo user, shown as individual", () => {
    expect(accountViewOf(me({ account: { registrationRole: null } }))).toMatchObject({
      kind: "individual",
      isMorpheoUser: true,
    });
  });

  it("a professional is not: they have their own flow", () => {
    const view = accountViewOf(
      me({
        account: { registrationRole: "professional" },
        professionalProfile: {
          specialty: "psychologist",
          licenseNumber: "L-1",
          verificationStatus: "pending",
        },
      }),
    );
    expect(view.isMorpheoUser).toBe(false);
  });

  it("a member of a Nox organization is not, even when registered as an adult", () => {
    const view = accountViewOf(
      me({
        account: { organizations: [{ id: "o", name: "Org", status: "active", roleKeys: [] }] },
      }),
    );
    expect(view.isMorpheoUser).toBe(false);
  });

  it("platform staff are flagged for the console link; that says nothing about their own account", () => {
    const view = accountViewOf(me({ account: { internalRoles: ["platform_super_admin"] } }));
    expect(view).toEqual({ kind: "adult", isStaff: true, isMorpheoUser: true });
  });
});
