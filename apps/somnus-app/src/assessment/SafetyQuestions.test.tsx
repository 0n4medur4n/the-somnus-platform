import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";
import { type SafetyAnswer, SafetyQuestions } from "./SafetyQuestions.js";

const PROMPTS = [
  { signalId: "a", question: "¿Primera pregunta?" },
  { signalId: "b", question: "¿Segunda pregunta?" },
  { signalId: "c", question: "¿Tercera pregunta?" },
];
const t = (key: string) => i18n.t(key);

function Harness({ onComplete }: { onComplete: (answers: Record<string, SafetyAnswer>) => void }) {
  const [answers, setAnswers] = useState<Record<string, SafetyAnswer>>({});
  return (
    <SafetyQuestions
      prompts={PROMPTS}
      answers={answers}
      onAnswer={(id, answer) => setAnswers((current) => ({ ...current, [id]: answer }))}
      onBack={() => {}}
      onComplete={onComplete}
      busy={false}
    />
  );
}

describe("SafetyQuestions (one at a time)", () => {
  it("shows one question, moves on when it is answered, and hands over every answer -- the last included", async () => {
    const onComplete = vi.fn();
    renderWithProviders(<Harness onComplete={onComplete} />);

    expect(screen.getByText("¿Primera pregunta?")).toBeInTheDocument();
    expect(screen.queryByText("¿Segunda pregunta?")).not.toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("assessment.safety.questionOf", { current: 1, total: 3 })),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("assessment.safety.no") }));
    expect(await screen.findByText("¿Segunda pregunta?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("¿Segunda pregunta?")).toHaveFocus());

    await userEvent.click(screen.getByRole("button", { name: t("assessment.safety.unknown") }));
    await screen.findByText("¿Tercera pregunta?");
    await userEvent.click(screen.getByRole("button", { name: t("assessment.safety.yes") }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({ a: "no", b: "unknown", c: "yes" }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("goes back to the previous question with its answer kept, and forward again without re-answering", async () => {
    renderWithProviders(<Harness onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: t("assessment.safety.yes") }));
    await screen.findByText("¿Segunda pregunta?");

    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.back") }));
    await screen.findByText("¿Primera pregunta?");
    expect(screen.getByRole("button", { name: t("assessment.safety.yes") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));
    expect(await screen.findByText("¿Segunda pregunta?")).toBeInTheDocument();
  });

  it("does not answer on arrow keys: only a deliberate press counts", async () => {
    const onComplete = vi.fn();
    renderWithProviders(<Harness onComplete={onComplete} />);
    screen.getByRole("button", { name: t("assessment.safety.yes") }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    expect(screen.getByText("¿Primera pregunta?")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { pressed: false })) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });
});
