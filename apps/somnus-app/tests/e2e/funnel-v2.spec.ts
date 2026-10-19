import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import es from "../../src/i18n/locales/es.json" with { type: "json" };
import fixture from "./fixtures/funnel-v2-vignettes.json" with { type: "json" };
import { expect, test } from "./support/console.js";

/**
 * The v2 interview (embudo v0.2) through the real UI and the real stack
 * (edge -> morpheo -> MySQL), tagged @v2: scripts/e2e-stack.mjs runs these with
 * FUNNEL_V2_ENABLED=true and the v1 specs with it off.
 *
 * Each screen is answered as the vignette answers it (the plan in
 * fixtures/funnel-v2-vignettes.json, generated from the engine), and the final
 * text must be exactly the vignette runner's. The stack runs morpheo's AI from
 * recorded outputs (AI_FIXTURE_FILE), so the plan is the narrative mode's: after
 * a free text, the confirmation screen («Por lo que nos ha contado,
 * entendemos: … ¿Es correcto?») and the questions it settled are skipped.
 */
const t = es.funnel;

type PlannedStep = {
  key: string;
  kind: string;
  type: string;
  value?: unknown;
  absence?: string;
  text?: string;
  labels?: string[];
  fields?: Record<string, string>;
  decisions?: { id: string; decision: "confirmado" | "corregido" | "quitado" }[];
};
type Plan = { id: string; steps: PlannedStep[]; finalText: string[] };

const PLANS = Object.fromEntries(
  (fixture.vignettes as Plan[]).map((plan) => [plan.id, plan]),
) as Record<string, Plan>;

async function startInterview(page: Page): Promise<void> {
  await page.goto("/assessment?lng=es");
  await page.getByLabel(es.assessment.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.start }).click();
}

async function answer(page: Page, step: PlannedStep): Promise<void> {
  const screen = page.locator(`section[data-step-key="${step.key}"]`);
  await expect(screen).toBeVisible();
  const click = (name: string) => screen.getByRole("button", { name, exact: true }).click();
  const proceed = () => click(t.actions.continue);

  if (step.absence)
    return click(step.absence === "no_lo_se" ? t.actions.unknown : t.actions.prefer);
  if (step.kind === "info") return proceed();
  if (step.kind === "confirm")
    return click(step.value === "sigue_igual" ? t.actions.same : t.actions.changed);
  if (step.kind === "instrument_intro") {
    return click(step.value === "si" ? t.actions.answerInstrument : t.actions.skipInstrument);
  }
  if (step.key === "Z1") return click(t.actions.correct);
  if (step.kind === "confirm_extraction") {
    for (const { id, decision } of step.decisions ?? []) {
      await screen
        .locator(`li[data-item-id="${id}"]`)
        .getByLabel(t.extraction.decisions[decision], { exact: true })
        .check();
    }
    return proceed();
  }

  switch (step.type) {
    case "yes_no":
      return click(step.value === "si" ? t.actions.yes : t.actions.no);
    case "yes_no_note":
      await screen
        .getByLabel(step.value === "si" ? t.actions.yes : t.actions.no, { exact: true })
        .check();
      if (step.text) await screen.getByLabel(t.text.noteLabel).fill(step.text);
      return proceed();
    case "number":
      await screen.locator("input[type=number]").fill(String(step.value));
      return proceed();
    case "free_text":
      await screen.locator("textarea").fill(String(step.value));
      return proceed();
    case "duration": {
      const duration = step.value as { value: number; unit: string };
      await screen.locator("input[type=number]").fill(String(duration.value));
      const unit = screen.locator("select");
      if ((await unit.count()) > 0) await unit.selectOption(duration.unit);
      return proceed();
    }
    case "times":
      for (const [label, time] of Object.entries(step.fields ?? {})) {
        await screen.getByLabel(label, { exact: true }).fill(time);
      }
      return proceed();
    case "multi":
      if ((step.labels ?? []).length === 0) {
        await screen.getByLabel(t.actions.none, { exact: true }).check();
      }
      for (const label of step.labels ?? [])
        await screen.getByLabel(label, { exact: true }).check();
      return proceed();
    default: {
      const label = step.value === "ninguna" ? t.actions.none : ((step.labels ?? [])[0] ?? "");
      await screen.getByLabel(label, { exact: true }).check();
      return proceed();
    }
  }
}

async function play(page: Page, plan: Plan): Promise<void> {
  await startInterview(page);
  for (const step of plan.steps) await answer(page, step);
  const paragraphs = page.getByTestId("funnel-final-text").locator("p");
  await expect(paragraphs).toHaveText(plan.finalText);
}

test("@v2 FT-1: persistent insomnia, through the real UI, ends with the runner's text", async ({
  page,
}) => {
  const plan = PLANS["FT-1"];
  if (!plan) throw new Error("FT-1 missing from the fixture");
  await startInterview(page);
  const firstScan = await new AxeBuilder({ page }).analyze();
  expect(firstScan.violations).toEqual([]);
  for (const step of plan.steps) {
    if (step.key === "Q01#confirmacion") {
      // What the AI took from the narrative, each item with the person's words.
      const screen = page.locator('section[data-step-key="Q01#confirmacion"]');
      await expect(screen.getByRole("heading")).toHaveText(
        "Por lo que nos ha contado, entendemos:",
      );
      await expect(screen).toContainText("«Desde hace unos seis meses»");
      await expect(screen.getByRole("button", { name: t.actions.continue })).toBeDisabled();
      const confirmationScan = await new AxeBuilder({ page }).analyze();
      expect(confirmationScan.violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath("confirmacion-Q01.png"),
        fullPage: true,
      });
    }
    await answer(page, step);
  }
  // The narrative already said it: never asked again.
  for (const key of ["Q03", "Q08", "I2"]) {
    expect(plan.steps.map((s) => s.key)).not.toContain(key);
  }
  await expect(page.getByTestId("funnel-final-text").locator("p")).toHaveText(plan.finalText);
  const resultScan = await new AxeBuilder({ page }).analyze();
  expect(resultScan.violations).toEqual([]);
});

test("@v2 V-10: the night driver sees the S2 warning at that moment, then the runner's text", async ({
  page,
}) => {
  const plan = PLANS["V-10"];
  if (!plan) throw new Error("V-10 missing from the fixture");
  const keys = plan.steps.map((step) => step.key);
  // The warning and the safe-place question come right after the narrative's S2.
  expect(keys.slice(keys.indexOf("S2@exception:Q01") + 1).slice(0, 2)).toEqual([
    "S2_aviso",
    "S2_seguro",
  ]);
  await play(page, plan);
});

test("@v2 back undoes the last answer and the free-text filter stops a phone number", async ({
  page,
}) => {
  await startInterview(page);
  await page.locator('section[data-step-key="AGE"] input[type=number]').fill("44");
  await page.getByRole("button", { name: t.actions.continue }).click();
  await expect(page.locator('section[data-step-key="S1@start"]')).toBeVisible();
  await page.getByRole("button", { name: t.actions.back, exact: true }).click();
  await expect(page.locator('section[data-step-key="AGE"]')).toBeVisible();
  await page.locator('section[data-step-key="AGE"] input[type=number]').fill("44");
  await page.getByRole("button", { name: t.actions.continue }).click();
  for (const key of ["S1@start", "S4@start"]) {
    await page
      .locator(`section[data-step-key="${key}"]`)
      .getByRole("button", { name: t.actions.no, exact: true })
      .click();
  }
  const story = page.locator('section[data-step-key="Q01"]');
  await story.locator("textarea").fill("Duermo mal, llamadme al 612 345 678");
  await expect(story.getByRole("alert")).toHaveText(t.text.identifying);
  await expect(story.getByRole("button", { name: t.actions.continue })).toBeDisabled();
});
