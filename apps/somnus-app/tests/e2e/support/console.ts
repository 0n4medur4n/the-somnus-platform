import { type BrowserContext, test as base } from "@playwright/test";

/**
 * Forwards the browser's console errors into the test's own output.
 *
 * Without this, everything the SPA logs lives only inside the page, so a CI
 * failure is diagnosable only by downloading the Playwright HTML report --
 * which is exactly the loop that made a single failing sign-in take three
 * rounds to localise. `reportError` says which step of the auth callback
 * failed; this is what makes that line readable in the Actions log.
 *
 * The first version of this listened on Playwright's built-in `page` fixture,
 * and that was wrong in a way worth recording: most specs here take `browser`
 * and build their own context (`browser.newContext()` -> `context.newPage()`),
 * so the listener sat on a blank page nothing ever navigated. It forwarded
 * nothing for exactly the tests being investigated, and -- being a silent
 * absence -- looked identical to "the SPA logged nothing".
 *
 * So both routes are covered, and at context level rather than page level so a
 * second tab is included too:
 *
 * * `context` is overridden for specs that use the built-in `page`/`context`.
 * * `newContext` is wrapped for the specs that build their own.
 *
 * `console-forwarding.spec.ts` asserts both routes stay wired.
 *
 * Each context also counts its magic-link redemptions. The Auth emulator
 * returns INVALID_OOB_CODE -- `auth/invalid-action-code`, the copy that says
 * the link expired -- for exactly one reason: the code is no longer in its
 * map, and only a successful redemption removes it. So "how many times did
 * this page redeem the link" is the question that separates the remaining
 * explanations, and one line per call answers it from the Actions log.
 * Status only; the code itself is a one-time credential and is never logged.
 */
const wired = new WeakSet<BrowserContext>();

function forward(context: BrowserContext): void {
  if (wired.has(context)) return;
  wired.add(context);

  context.on("console", (message) => {
    if (message.type() !== "error") return;
    // `text()` renders object arguments as "JSHandle@object", which would drop
    // the whole payload -- the arguments are read individually instead.
    void Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => "<unserializable>")))
      .then((args) => {
        const line = args
          .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
          .join(" ");
        console.error(`[browser:error] ${line}`);
      })
      .catch(() => {
        // The page closed before the arguments could be read. A lost log line
        // must never fail a test.
      });
  });

  context.on("weberror", (webError) => {
    console.error(`[browser:pageerror] ${webError.error().message}`);
  });

  let redemptions = 0;
  context.on("response", (response) => {
    if (!response.url().includes("accounts:signInWithEmailLink")) return;
    redemptions += 1;
    console.error(`[browser:signin] redemption #${redemptions} -> HTTP ${response.status()}`);
  });
}

/** Whether `context` has the forwarding attached. Used by the self-test. */
export function isConsoleForwarded(context: BrowserContext): boolean {
  return wired.has(context);
}

export const test = base.extend({
  context: async ({ context }, use) => {
    forward(context);
    await use(context);
  },

  browser: [
    async ({ browser }, use) => {
      const original = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await original(options);
        forward(context);
        return context;
      };
      try {
        await use(browser);
      } finally {
        // Removing the own property uncovers the prototype method again, so the
        // browser is handed back exactly as it arrived.
        delete (browser as { newContext?: unknown }).newContext;
      }
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
