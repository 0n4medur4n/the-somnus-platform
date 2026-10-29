import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { AppearanceDialog } from "./appearance-ui.js";

const t = i18n.t.bind(i18n);

describe("AppearanceDialog", () => {
  it("saves the colour and the icon chosen", async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <AppearanceDialog
        name="Protocolos"
        icon="folder"
        initial={{}}
        busy={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.colors.teal") }));
    await userEvent.click(
      screen.getByRole("button", { name: t("drive.appearance.icons.stethoscope") }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.save") }));
    expect(onSave).toHaveBeenCalledWith({ color: "teal", icon: "stethoscope" });
  });

  it("can go back to the default colour and icon", async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <AppearanceDialog
        name="Nota"
        icon="note"
        initial={{ color: "red", icon: "pin" }}
        busy={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.noColor") }));
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.defaultIcon") }));
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.save") }));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it("offers no emoji at all", () => {
    renderWithProviders(
      <AppearanceDialog
        name="Nota"
        icon="note"
        initial={{}}
        busy={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(document.body.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
