# @somnus/admin — internal admin console

The Somnus staff console. **Not** a section of `somnus-app`: a separate SPA on
its own Firebase Hosting site, per Addendum A §A2.1 — smaller consumer bundle,
isolated attack surface, separate deploy cadence, and the option to restrict it
later (IP allowlist, SSO) without touching the consumer app.

This is the addendum explicitly amending the build plan's two-static-frontend
map to three. The five Cloud Run services are unchanged; no new deployable
service exists.

## The gate (Checkpoint 15.1)

Authentication is the **same magic link** as the consumer app. Authorization is
not: anyone can obtain a session, and only an account holding an **internal
role** gets past the gate.

```
/admin/v1/me  ->  200  console shell, rendering the capabilities identity resolved
              ->  403  denial screen, and nothing else
              ->  401  sign-in screen
```

The console holds **no part of the capability matrix**. Addendum A §A2.2 lives
in identity's pure policy (`src/domain/authorization/admin-capability-policy.ts`);
edge-api knows only which capability a route requires, and this app renders from
the answer. So a control for a capability the server would refuse cannot appear.

### The denial screen shows nothing

No navigation, no capability names, no hint of what the console contains, and no
way to request access — internal roles are assigned by a `platform_super_admin`
and are never self-service. The only action is to sign out.

## Locales

**es and en only** (Addendum A §A5.5 decision). Narrower than the platform's
four consumer locales on purpose: ca and fr exist for the people Somnus serves,
not for the staff who operate it. The completeness rule is unchanged — a missing
key fails CI.

## Commands

```bash
pnpm --filter @somnus/admin dev        # http://localhost:5174
pnpm --filter @somnus/admin build
pnpm --filter @somnus/admin test
pnpm --filter @somnus/admin typecheck
```

`VITE_EDGE_API_URL` must point at somnus-edge-api, and that origin must be in
edge-api's `CORS_ORIGINS`.

## Not built yet

The screen behind each capability lands in Checkpoints 15.2–15.5 (users and
organizations, the verification queue, the AI content review queue, statistics
and the audit viewer, break-glass). 15.1 is the shell and the gate, and the
console says so rather than showing empty pages.

**Operational:** no one holds `platform_super_admin` yet — Addendum A §A5.4 is
still an open decision (one named person, ideally two). Until someone does, the
console has no way to grant a first internal role, so every account reaching it
sees the denial screen. That is correct behaviour, not a bug.

## Estadísticas: qué está vivo y qué no (Checkpoint 15.4)

La pantalla de estadísticas lee el export privacy-safe de BigQuery cableado en
14.3. No hay una segunda vía de export ni campos nuevos: los números salen
exactamente de las filas que llegan al almacén, pasadas por `redactForExport`,
así que pantalla y almacén no pueden discrepar.

**Derivadas de payloads `.strict()` de analytics** — registros por rama de rol,
embudo de verificación (abiertos / aprobados / rechazados y mediana hasta la
decisión) y embudo de invitaciones (emitidas / vistas / aceptadas / expiradas).

**Contadas por ocurrencia de evento**, que es lo único fiable en la vía denylist:
assessments creados y completados, informes solicitados y generados,
notificaciones solicitadas y organizaciones creadas.

**Real desde 15.5** — accesos break-glass por administrador **y por mes**
(§A2.3 punto 4). Sale de la misma proyección que todo lo demás: el contador lee
`data.adminId` de las filas exportadas, porque `redactForExport` descarta los
ids de actor y sujeto antes de que nada salga del worker. Por mes y no un total
del periodo: el sentido de la métrica es que un patrón en el uso de una persona
se vea, y un total cambia de significado en cuanto alguien amplía la ventana.

**Declaradas como huecos, no como cero**, porque ningún evento las lleva:
distribución de niveles L0–L4, descargas de PDF, éxito/fallo de entrega de
notificaciones, dead-letter, miembros activos por organización, assessments
reclamados, drop-off por paso, telemetría de coste, y **los filtros por locale y
por producto** que pide §A2.4. La pantalla las lista con su motivo. Un cero es
una medición: mostrarlo donde nadie mide diría que la plataforma está parada
cuando la verdad es que nadie está contando.

**Nota operativa:** hoy todos los números salen a cero en dev, y no es un fallo
del dashboard. Los servicios publican eventos vía `LoggingEventPublisher` — al
log, no a un transporte —, así que nada llega a `somnus_audit` todavía
(production-readiness gap #3). Cuando ese transporte se cablee, estas mismas
pantallas mostrarán datos reales sin cambio alguno.

## Acceso de emergencia (break-glass) — Checkpoint 15.5

`admin_break_glass`, que §A2.2 concede a `clinical_governance_reviewer`,
`platform_admin` y `platform_super_admin`. Para `support_agent` y
`professional_verifier` la sección no existe: no aparece en la navegación, no se
renderiza, y la consola no tiene URL para una sección que no ofreció.

La pantalla es un formulario de justificación que a veces muestra un resultado,
no un visor con una justificación al lado. La única petición que sabe hacer ya
lleva la categoría (soporte / seguridad / legal / otra) y el texto libre con un
mínimo de longitud, así que "abrir primero y explicar después" no es un estado
alcanzable. No hay desbloqueo: nada queda guardado como "abierto", no se emite
cookie ni token, y volver mañana significa escribir otra justificación.

Cada revelación escribe **un** evento de auditoría — el mismo que emite el
interceptor para cualquier ruta admin, enriquecido, no un segundo evento — con
quién, qué registro, cuándo, la categoría y la justificación. La justificación
viaja a una **columna propia** de `audit_records`, nunca dentro de `data`: §17
prohíbe texto libre en el payload de un evento y la fila de export se construye
con una lista fija de campos que no incluye `justification`, así que el texto no
puede llegar a BigQuery por ninguna vía. El visor de auditoría sí lo muestra, a
través de su propio allowlist y junto a la categoría.
