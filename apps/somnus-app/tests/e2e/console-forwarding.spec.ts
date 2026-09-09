import { expect, isConsoleForwarded, test } from "./support/console.js";

/**
 * The diagnostic tooling's own regression test.
 *
 * Console forwarding failed silently once already: it was attached to the
 * built-in `page` fixture, which the specs that matter never use, and the
 * missing log line was indistinguishable from the SPA having logged nothing.
 * A tool whose failure mode is silence needs a test, so these two assert the
 * wiring is present on both routes a context can be created by.
 *
 * No stack required -- neither test navigates anywhere.
 */
test("forwarding is attached to a context a spec builds itself", async ({ browser }) => {
  const context = await browser.newContext();
  expect(isConsoleForwarded(context)).toBe(true);
  await context.close();
});

test("forwarding is attached to the built-in context", async ({ context }) => {
  expect(isConsoleForwarded(context)).toBe(true);
});
