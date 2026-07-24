/**
 * Build plan §20 Checkpoint 7.1 / ADR 0010: the Consent module is
 * fully isolated inside this service. `consent.service.ts` is the
 * only file under `src/modules/consent/` any other module may import;
 * `consent.module.ts` is also allowed since NestJS's own DI wiring
 * requires importing the module (not just the class) to get
 * `ConsentService` injectable elsewhere -- that file only re-exports
 * `ConsentService`, it does not expose the database, repositories, or
 * event publisher.
 *
 * A whitelist by construction (`to.pathNot` excludes exactly those two
 * files, everything else under consent/ is forbidden), not a
 * blacklist of today's subfolder names -- a new folder added under
 * consent/ later is covered automatically, with no rule update
 * required. Enforced by test/architecture/consent-isolation.test.ts.
 *
 * .cjs extension is deliberate: dependency-cruiser's config loader
 * expects CommonJS even though this package is "type": "module".
 */
module.exports = {
  forbidden: [
    {
      name: "consent-isolation",
      comment:
        "Only consent.service.ts (the public interface) and consent.module.ts (NestJS DI wiring) may be imported from outside src/modules/consent/.",
      severity: "error",
      from: { pathNot: "^src/modules/consent/" },
      to: {
        path: "^src/modules/consent/",
        pathNot: "^src/modules/consent/(consent\\.service\\.ts|consent\\.module\\.ts)$",
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
