# @somnus/ui-tokens

Product UI tokens for the Somnus SPAs: the three themes in
`apps/somnus-app/src/index.css` (dark, light, high contrast), the Inter
stack, and the Tailwind CSS 4 spacing and radius scale.

`@somnus/design-system` stays the marketing brand package (Satoshi, Okine,
one palette, `--somnus-*` names). It is a different token set. Nox and,
later, the other SPAs consume this package. `somnus-app` is not wired to
it yet.

Import `theme.css` from a Tailwind v4 entry file:

```css
@import "tailwindcss";
@import "@somnus/ui-tokens/theme.css";
```

A drift test reads `apps/somnus-app/src/index.css` and fails if any shared
color or font value differs. Spacing and radius are shared by not overriding
Tailwind's defaults.
