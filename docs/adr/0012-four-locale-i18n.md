# ADR 0012 — Four-locale i18n from day one (es, en, ca, fr)

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §3.3 (Internationalization), §22 (Definition of Done — i18n)

## Context

A multilingual platform built in one locale accumulates debt that
matures into a rewrite. Catalan is the most likely locale to be
forgotten because it has the smallest market of the four, and the
build plan explicitly calls it out as the test target for "the
non-default locale".

## Decision

The platform ships in **es, en, ca, fr** from the first commit.
Default is `es`. Every user-facing string — SPA, marketing site,
emails, reports, error messages surfaced to users — lives in locale
files. `packages/i18n` holds the shared infrastructure and the CI
completeness check. Each app holds its own locale files. The user's
locale is stored in their profile, carried in the session context, and
passed to the report service so reports render in the user's
language. Assessment question text is versioned content per locale
inside Morpheo's definition tables, not UI locale files. A missing key
in any of the four locales fails CI.

## Consequences

- Translation debt is impossible to accumulate silently.
- A new language is a translation PR, not a code refactor.
- Lighthouse a11y and SEO audits must be run in `ca` as well as `es`
  to prove the four-locale promise.
- Adding a fifth locale requires a new ADR.
