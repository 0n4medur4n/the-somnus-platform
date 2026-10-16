import { expect, type Page } from "@playwright/test";
import es from "../../../src/i18n/locales/es.json" with { type: "json" };

const t = es.assessment.safety;

/**
 * Walks the safety step, which asks one question at a time: "Sí" to every
 * question matching one of `yesTo`, "No" to the rest. Answering the last
 * question moves the flow on by itself (to the concern step, or straight to
 * the result on an emergency stop).
 */
export async function answerSafetyQuestions(page: Page, yesTo: RegExp[] = []): Promise<void> {
  const question = page.getByTestId("safety-question");
  await expect(question).toBeVisible();
  for (let asked = 0; asked < 60; asked += 1) {
    if ((await question.count()) === 0) return;
    const text = (await question.innerText()).trim();
    const answer = yesTo.some((pattern) => pattern.test(text)) ? t.yes : t.no;
    await page
      .getByRole("group", { name: text })
      .getByRole("button", { name: answer, exact: true })
      .click();
    // The next question has replaced this one, or the step is over.
    await expect
      .poll(async () => ((await question.count()) === 0 ? "" : (await question.innerText()).trim()))
      .not.toBe(text);
  }
  throw new Error("the safety step never finished");
}
