import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import type { DriveFolderView, DriveSession } from "../drive-session.js";
import { DriveMembers } from "./DriveMembers.js";

const t = i18n.t.bind(i18n);
const ME = "018f0000-0000-7000-8000-0000000000d1";
const ANA = "018f0000-0000-7000-8000-0000000000a1";
const FINGERPRINT = "008D 2C76 808A C8B7 2FEF 17E0 D733 1B12 2C6E 91A1";

function setup(trust: "known" | "verified") {
  const session = {
    me: { userId: ME },
    colleagues: () => [
      { userId: ANA, email: "ana@thesomnus.com", fingerprint: FINGERPRINT, trust },
    ],
    fingerprintOf: () => null,
    trustOf: () => "self",
    markVerified: vi.fn().mockResolvedValue(undefined),
    addMember: vi.fn().mockResolvedValue(undefined),
  } as unknown as DriveSession & {
    markVerified: ReturnType<typeof vi.fn>;
    addMember: ReturnType<typeof vi.fn>;
  };
  const view = {
    shareId: "s1",
    name: "Protocolos",
    role: "owner",
    members: [{ userId: ME, email: "me@thesomnus.com", role: "owner" }],
  } as unknown as DriveFolderView;
  renderWithProviders(
    <DriveMembers
      session={session}
      view={view}
      onChanged={vi.fn()}
      onLeft={vi.fn()}
      onRename={vi.fn()}
    />,
  );
  return session;
}

/**
 * The share form tells the colleague's public fingerprint apart from the
 * person's own secret recovery code -- they were being read as one thing.
 */
describe("DriveMembers: sharing", () => {
  it("presents the colleague's fingerprint as public, and says it is not the recovery code", async () => {
    setup("known");
    await userEvent.selectOptions(screen.getByLabelText(t("drive.members.colleague")), ANA);
    expect(
      screen.getByText(t("drive.members.fingerprintOf", { who: "ana@thesomnus.com" })),
    ).toBeVisible();
    expect(screen.getByText(FINGERPRINT)).toBeVisible();
    expect(screen.getByText(t("drive.members.notRecoveryCode"))).toBeVisible();
  });

  it("records the fingerprint as verified when the box is ticked, then shares", async () => {
    const session = setup("known");
    await userEvent.selectOptions(screen.getByLabelText(t("drive.members.colleague")), ANA);
    await userEvent.click(
      screen.getByLabelText(t("drive.members.confirmMatches", { who: "ana@thesomnus.com" })),
    );
    await userEvent.click(screen.getByRole("button", { name: t("drive.members.addSubmit") }));
    await waitFor(() => expect(session.addMember).toHaveBeenCalledTimes(1));
    expect(session.markVerified).toHaveBeenCalledWith(ANA);
  });

  it("shares without marking anything when the box is left alone", async () => {
    const session = setup("known");
    await userEvent.selectOptions(screen.getByLabelText(t("drive.members.colleague")), ANA);
    await userEvent.click(screen.getByRole("button", { name: t("drive.members.addSubmit") }));
    await waitFor(() => expect(session.addMember).toHaveBeenCalledTimes(1));
    expect(session.markVerified).not.toHaveBeenCalled();
  });
});
