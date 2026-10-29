import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { AppearanceDialog } from "./appearance-ui.js";

const t = i18n.t.bind(i18n);

describe("AppearanceDialog", () => {
  it("saves the colour and the emoji chosen", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "🩺" }));
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.save") }));
    expect(onSave).toHaveBeenCalledWith({ color: "teal", emoji: "🩺" });
  });

  it("takes a typed emoji, refuses text, and can go back to the default look", async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <AppearanceDialog
        name="Nota"
        icon="note"
        initial={{ color: "red", emoji: "📌" }}
        busy={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const field = screen.getByLabelText(t("drive.appearance.typeEmoji"));
    await userEvent.type(field, "hola");
    expect(screen.getByRole("alert")).toHaveTextContent(t("drive.appearance.notAnEmoji"));
    await userEvent.clear(field);
    await userEvent.type(field, "🌙");
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.useEmoji") }));
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.noColor") }));
    await userEvent.click(screen.getByRole("button", { name: t("drive.appearance.save") }));
    expect(onSave).toHaveBeenCalledWith({ emoji: "🌙" });
  });
});
