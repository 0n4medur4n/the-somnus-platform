import { test as base } from "@playwright/test";

/**
 * Forwards the browser's console errors into the test's own output.
 *
 * Without this, everything the SPA logs lives only inside the page, so a CI
 * failure is diagnosable only by downloading the Playwright HTML report --
 * which is exactly the loop that made a single failing sign-in take three
 * rounds to localise. `reportError` now says which step of the auth callback
 * failed; this is what makes that line readable in the Actions log.
 *
 * Auto fixture: no spec has to remember to opt in.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: Playwright's idiom for a fixture that yields nothing.
export const test = base.extend<{ browserConsole: void }>({
  browserConsole: [
    async ({ page }, use) => {
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        // `text()` renders object arguments as "JSHandle@object", which would
        // drop the whole payload -- the arguments are read individually instead.
        void Promise.all(
          message.args().map((arg) => arg.jsonValue().catch(() => "<unserializable>")),
        )
          .then((args) => {
            const line = args
              .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
              .join(" ");
            console.error(`[browser:error] ${line}`);
          })
          .catch(() => {
            // The page closed before the arguments could be read. A lost log
            // line must never fail a test.
          });
      });
      page.on("pageerror", (error) => {
        console.error(`[browser:pageerror] ${error.message}`);
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
