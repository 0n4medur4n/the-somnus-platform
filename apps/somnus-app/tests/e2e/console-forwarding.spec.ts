import {
  clearCspViolations,
  cspViolations,
  expect,
  isConsoleForwarded,
  test,
} from "./support/console.js";

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

/**
 * The CSP guard's own test. Without it, a broken listener would be silent: no
 * violation reported looks the same as no violation happening. Here a page under
 * a policy that forbids inline script runs one, and the guard must record it.
 */
test("a CSP violation in any page is recorded by the guard", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("http://csp.test/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "content-security-policy": "default-src 'none'" },
      body: "<!doctype html><script>window.ran = true</script><p>x</p>",
    }),
  );
  await page.goto("http://csp.test/");
  await expect.poll(() => cspViolations().length).toBeGreaterThan(0);
  expect(cspViolations().join(" | ")).toContain("script-src");
  expect(await page.evaluate(() => (window as unknown as { ran?: boolean }).ran)).toBeUndefined();
  await context.close();
  // This violation was the point of the test; the guard must not fail it.
  clearCspViolations();
});
