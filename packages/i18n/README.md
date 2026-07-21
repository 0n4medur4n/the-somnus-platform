# @somnus/i18n

Locale loading and the cross-locale completeness check used to keep
`es / en / ca / fr` in sync. The check is a runtime function and a
test: a missing key in any of the four locales must fail the build.

## How to use

1. Put a flat JSON file per locale in a directory:
   - `es.json`, `en.json`, `ca.json`, `fr.json`
   - Each file is a flat object: `"auth.login.title": "…"`
2. At build time, call:
   ```ts
   import { loadLocaleBundles, checkCompleteness } from "@somnus/i18n";
   const bundles = loadLocaleBundles({ baseDir: "./locales" });
   const r = checkCompleteness(bundles);
   if (!r.ok) {
     console.error(formatCompletenessReport(r));
     process.exit(1);
   }
   ```
3. The frontend (and any service emitting user-facing strings) reads
   the right bundle at runtime and never embeds hardcoded strings.

## Why the check matters

A missing key in `ca` (the tie-breaker locale) is the kind of bug that
survives review and shows up in production. The completeness check
fails the build the moment any locale drifts from the reference
(`es` by default).

## Build plan

Implements build plan §20 Phase 2 / Checkpoint 2.2. The full
i18n coverage requirement (every frontend string translated) is
enforced per service in later phases.
