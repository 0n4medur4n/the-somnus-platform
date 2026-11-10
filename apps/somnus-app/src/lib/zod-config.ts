import { z } from "zod";

/**
 * Zod 4 compiles each object schema into a function with `new Function(...)`
 * when it can. The site's Content-Security-Policy has no `unsafe-eval`
 * (firebase.json), so that probe is refused: the page still works, because Zod
 * falls back to its interpreter, but every load logs a violation and the
 * Playwright suite (which fails on any violation) cannot tell it from a real one.
 *
 * Turning the compiler off here removes the attempt instead of allowing eval.
 * This module must be the first import of main.tsx: the probe runs on the
 * first object that is parsed, and the environment is parsed at import time.
 */
z.config({ jitless: true });
