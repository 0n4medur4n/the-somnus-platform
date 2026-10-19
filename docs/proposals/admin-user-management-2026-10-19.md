# Usuarios e invitaciones de la consola

Fecha: 19/10/2026. Estado: propuesta pendiente de aprobación arquitectónica.
Base revisada: `origin/main`, commit `d2250f5`.

## Objetivo

Que el superadministrador pueda invitar a personas desde Usuarios, elegir el
idioma del correo y consultar su ficha administrativa. La identidad es única;
el acceso a un producto y la condición profesional son decisiones distintas.
La cuenta `thesomnus.web@gmail.com` utiliza su rol asignado en Identity: nunca
se concede autoridad comparando el correo con una dirección escrita en código.

## Lo que ya existe

- El catálogo tiene seis roles externos: `individual_user`, `professional`,
  `organization_owner`, `organization_admin`, `professional_manager` y
  `clinical_supervisor`. Hay cinco internos: `support_agent`,
  `professional_verifier`, `clinical_governance_reviewer`, `platform_admin` y
  `platform_super_admin` (`packages/api-contracts/src/identity/roles.ts:4`).
- La especialidad profesional es un campo del perfil, no un rol de autorización
  (plan §11). Registrarse como profesional no concede permisos profesionales:
  hace falta completar la verificación (addendum A §A1).
- `main` ya contiene invitaciones internas con nombre, apellidos, correo, rol
  e idioma es/en/ca/fr. Caducan a los siete días, permiten revocar y reenviar,
  y crean la cuenta cuando el destinatario inicia sesión y acepta. La capacidad
  es `admin_roles_assign`, exclusiva del superadministrador
  (`packages/api-contracts/src/identity/staff-invitation.ts:5`,
  `services/somnus-edge-api/src/modules/admin/admin-staff-invitations.controller.ts:32`).
- El correo interno se genera como enlace de Firebase y se entrega al worker
  mediante la cola existente. El resultado `emailSent` significa **encolado**,
  no prueba de entrega en la bandeja del destinatario
  (`services/somnus-edge-api/src/modules/staff-invitation/staff-invitation-email.service.ts:40`).
- La sección de invitaciones internas está después de toda la tabla y de la
  ficha; puede quedar por debajo de la parte visible de Usuarios. Esto explica
  una posible falta de visibilidad, pero no demuestra el estado del despliegue
  de la captura (`apps/somnus-admin/src/screens/UsersScreen.tsx:230`).
- La ficha devuelve nombre, apellidos, rama de registro y estado profesional,
  pero la pantalla no muestra los tres primeros. Las organizaciones se muestran
  como un número, sin nombres ni estado de las membresías
  (`packages/api-contracts/src/identity/admin-console.ts:54`,
  `apps/somnus-admin/src/screens/UsersScreen.tsx:173`).
- Las invitaciones de organización requieren organización. El proxy actual
  devuelve el token, pero ese método no encola un correo
  (`services/somnus-edge-api/src/modules/organizations/organizations.service.ts:100`).
- Terraform ya declara la cola, el permiso de encolado del edge y la conexión
  al worker. Esta revisión no demuestra que el estado remoto coincida con el
  código (`infrastructure/terraform/environments/dev/main.tf:198`).

## Primera entrega propuesta

Ampliación del checkpoint 15.2; sin motor Nox, nuevos servicios ni dependencias.

1. Encabezar Usuarios con una acción visible «Invitar persona» y dos destinos:
   Morpheo y equipo interno. La segunda mantiene el flujo existente y sus
   permisos. La primera solo la puede emitir `platform_super_admin`, mediante
   una nueva capacidad `admin_users_invite`, resuelta en Identity.
2. En Morpheo, elegir particular o profesional pendiente de verificar, nombre,
   apellidos, correo e idioma. El administrador no acepta consentimientos,
   confirma edad, inventa datos personales ni verifica al profesional en nombre
   de la persona. El destinatario completa esos pasos en el registro existente.
3. Guardar las nuevas invitaciones en `platform_invitations`, dentro de
   `somnus_identity`, con migración reversible: id opaco, correo normalizado,
   nombres propuestos, rama adult/professional, locale, emisor, estado,
   caducidad y aceptación. Propuesta: siete días, como las internas. No se
   reutiliza `staff_invitations` para conceder roles externos ni se crea una
   organización artificial.
4. El correo de Morpheo abre la aplicación. La sesión de Firebase verifica la
   dirección; el servidor busca exclusivamente la invitación de esa dirección.
   Una dirección nueva completa el registro y sus consentimientos. Una cuenta
   existente conserva sus datos, idioma, consentimientos y permisos; aceptar
   nunca los sobrescribe ni eleva su condición profesional. El registro normal
   de Morpheo sigue disponible.
5. Revocar, caducar o sustituir una invitación impide aceptarla. Reenviar crea
   una nueva invitación vigente e invalida la anterior. Una aceptación simultánea
   o un reintento no duplica cuenta, perfil ni permisos. La finalización debe ser
   recuperable si falla una llamada a Consent; no se da por terminado el alta
   después de un efecto parcial.
6. Listar invitaciones con destino, destinatario, rama/rol, idioma, estado y
   fechas. Mostrar «correo encolado» y un aviso recuperable si no pudo encolarse.
   Las cuatro traducciones del correo viven en el worker. No contienen datos de
   salud ni credenciales fuera del enlace seguro.
7. Completar la ficha: id, correo, idioma, estado y fechas; perfil registrado
   (nombre, apellidos, fecha de nacimiento y datos de contacto cuando existan);
   especialidad, número de colegiación y verificación; roles efectivos con su
   ámbito; organizaciones con nombre, estado y membresía. Ausente significa
   «sin informar», nunca un dato supuesto. No se muestran secretos, tokens ni
   respuestas clínicas. Los campos adicionales se declaran primero en Zod y
   se obtienen solo de los repositorios que pertenecen a Identity.
8. Auditar emisión, reenvío, revocación y aceptación sin nombres, direcciones,
   enlaces ni texto de salud en los eventos. Mantener los controles CSRF,
   validación, límites y comprobación del emisor vigente. Un emisor suspendido
   o que perdió autoridad no puede conceder privilegios mediante una invitación
   antigua.

## Nox: requisito recogido y decisión separada

El propietario pide que Nox sea solo para médicos. El addendum actual admite
«researcher / clinician» por organización (§A1), y el plan principal mantiene
Nox fuera de alcance (§1). Esta propuesta registra el nuevo requisito; no
construye un producto futuro ni presenta una membresía genérica como acceso Nox.

Antes de implementar Nox habrá que aprobar su lista exacta de especialidades
médicas, y su autorización propia: cuenta activa + médico verificado +
invitación/adscripción Nox vigente + organización activa cuando corresponda.
Ni una cuenta de Morpheo, ni el rol profesional genérico, ni un rol interno
concederán automáticamente acceso clínico a Nox. No se añaden todavía tablas
de permisos para productos futuros ni un selector que prometa un acceso inexistente.

## Ficheros de implementación previstos

- Plan y decisiones: `THE_SOMNUS_BUILD_PLAN_ADDENDUM_A.md`, nueva ADR de
  invitaciones externas y su índice; READMEs de los componentes afectados.
- Contratos: `packages/api-contracts/src/identity/platform-invitation.ts`
  (nuevo), `identity/admin-console.ts`, `identity/admin.ts`, índices y pruebas.
- Identity: módulo nuevo `src/modules/platform-invitations/`; tabla, repositorio
  y migración up/down propios; `modules/admin/admin-users.service.ts`;
  política de capacidades. No se modifica la suite negativa inmutable.
- Edge: rutas admin y de aceptación, integración con la cola de correo y
  configuración de retorno fija a la aplicación. No accede a TiDB.
- Worker: plantillas localizadas de invitación Morpheo y sus pruebas; se mantiene
  la entrega exclusiva por Brevo.
- App: aceptación y precarga del registro existente, sin persistir tokens en
  almacenamiento del navegador; integración con el flujo de usuario existente.
- Admin: `screens/UsersScreen.tsx`, formulario/lista de invitaciones Morpheo,
  ficha, cliente API, locales y pruebas de componentes.
- Esquemas OpenAPI: regenerados desde Zod por los generadores existentes.
  Revisar también su persistencia: actualmente `.gitignore` excluye los JSON
  generados; no se afirma que queden versionados sin resolver ese punto.

No se propone alterar Terraform por rutina. Si un plan remoto revela una
necesidad concreta, el diff se prepara y revisa antes de aplicarlo. Se mantienen
cinco servicios y mínimo de instancias cero.

## Pruebas y publicación

- Contratos primero: payload válido, locale, correo normalizado, exclusión de
  roles internos en invitaciones Morpheo y rechazo de campos adicionales.
- Autorización: todos los roles frente a la nueva capacidad; dirección distinta,
  emisor inactivo o sin permiso, cuenta suspendida/eliminada, expiración,
  revocación, reuso, aceptación concurrente y ausencia de elevación profesional.
  Aplicar una mutación a un guard nuevo, demostrar que la prueba falla y restaurar.
- Repositorios: MySQL efímero local/CI, migraciones up/down/up, unicidad y
  recuperación tras fallo. Ninguna prueba destructiva apunta a TiDB compartido.
- Flujos es/ca: destinatario nuevo y existente, elección de idioma, correo
  encolado/fallido, aceptación y comprobación del rol final. Plantillas en
  es/en/ca/fr, sin contenido clínico ni secretos en logs.
- Gate: format/lint/typecheck/tests con cobertura/build, aislamiento, todas las
  suites de CI y Docker de los servicios afectados. Informar cualquier resultado
  rojo, omitido o no ejecutable; nunca equiparar un job verde al CI completo.
- Commits pequeños por capa en `feat/admin-user-management`, siempre por rutas,
  sin mezclar `feat/admin-drive` ni los archivos sin commit del directorio raíz.
- Terraform: fmt/validate y plan revisado antes de cualquier apply; ningún
  borrado, reemplazo o eliminación de configuración inesperado es aceptable.
- Despliegue desde commit publicado, imágenes con SHA, migración como Job con
  secretos por referencia, verificación de revisión y Hosting desde CI. El job
  actual de Hosting depende solo de cuatro jobs, no del CI entero
  (`.github/workflows/ci.yml:559`): la publicación debe esperar también a los
  backends, integraciones y Docker. Preparar una corrección del grafo de CI
  antes de publicar este cambio de contratos.
- Comprobación live sin inspeccionar datos personales: rutas de salud/version,
  sesión y controles de consola con cuentas de prueba autorizadas. No enviar
  correos reales a terceros como parte de la prueba sin destinatario autorizado.

## Aprobación necesaria

Se solicita aprobar esta primera entrega: invitaciones Morpheo + ficha completa
administrativa + mejor visibilidad del flujo interno existente, conservando el
alta y los consentimientos a cargo del destinatario. Es una ampliación explícita
del addendum A §A1, que hoy dice que particulares y profesionales se registran
por su cuenta; AGENTS.md y el plan §23 exigen aprobación antes de modificar la
arquitectura. Nox queda recogido como requisito futuro separado.

## Evidencia de esta preparación

Solo se añade esta propuesta y se aplica el formateador a cuatro archivos ya
existentes de invitaciones internas: `migrations/meta/0006_snapshot.json`,
`migrations/meta/_journal.json`,
`src/infrastructure/db/repositories/staff-invitations.repository.ts` y
`test/integration/staff-invitations.integration.test.ts`, todos dentro de
`services/somnus-identity-service`. El diff no cambia las aserciones ni la
lógica. No hay dependencias nuevas, migraciones nuevas ni cambios funcionales.

Comprobaciones ejecutadas en el worktree aislado:

| Comando | Resultado observado |
| --- | --- |
| `pnpm.cmd install --frozen-lockfile` | Exit 0; lockfile sin cambios, 1439 paquetes; pnpm 12.11.2, el fijado actualmente por el repositorio. |
| `pnpm.cmd run format:check` | Inicialmente 4 errores de formato; tras `biome format --write` en esas cuatro rutas: exit 0, `Checked 754 files ... No fixes applied.` |
| `pnpm.cmd run lint` | Exit 0; `Checked 756 files`, `Found 11 warnings. Found 1 info.` Advertencias existentes de CSS `!important` y uso de consola en scripts. |
| `pnpm.cmd run typecheck` | Exit 0, `tsc --noEmit`. |
| `pnpm.cmd --if-present -r --filter './packages/*' run build` | Exit 0; compilación de los paquetes compartidos. |
| `pnpm.cmd run test:run --maxWorkers=1` con Git Bash en PATH del proceso | Exit 0; `Test Files 36 passed (36)`, `Tests 473 passed (473)`. No se cambian límites ni pruebas. |
| `pnpm.cmd run build` | Exit 0, `tsc -p tsconfig.build.json`. |
| `node scripts/check-terraform-least-privilege.mjs` | Exit 0; `OK: no owner/editor/IAM-admin/wildcard roles granted anywhere in infrastructure/terraform.` |
| `git diff --check` | Exit 0. |

Limitaciones observadas, sin ocultar intentos fallidos:

- Antes de instalar el lockfile, los scripts no encontraban Biome/Vitest y el
  sandbox no permitía el lock del almacén de pnpm. La instalación congelada
  con permisos normales resolvió el problema.
- El primer intento de pruebas dentro del sandbox terminó con 440 pasadas,
  14 fallidas y 19 omitidas por problemas de arranque de procesos. Fuera del
  sandbox quedaron 460 pasadas y 13 fallidas: `bash` resolvía al ejecutable WSL
  sin `/bin/bash`. Usar el Git Bash instalado, solo en PATH de ese proceso,
  resolvió esas trece.
- La ejecución paralela posterior y `pnpm.cmd run ci` terminaron con 472
  pasadas y un timeout de 5000 ms en el escáner de aislamiento, que recorre
  dependencias instaladas. El gate serial completo indicado arriba pasa sin
  modificar el escáner, su alcance, su límite ni las aserciones. El `ci` literal
  local no se presenta como verde.
- Dos comprobaciones auxiliares de igualdad textual del JavaScript emitido y
  otra de tokens no normalizaron correctamente la presentación del test y
  fallaron; no constituyen pruebas de equivalencia. Se revisó el diff de
  formato, que conserva todas las aserciones y llamadas.
- Esta preparación no ejecuta suites de servicios contra MySQL, emuladores,
  cobertura de servicios, E2E, Python, imágenes Docker ni CI remoto. No hay
  código funcional nuevo que se pueda validar como una entrega terminada.
- Docker no fue accesible desde el sandbox; Terraform y `gh` no estaban en el
  PATH consultado. No se ejecutaron init/validate/plan/apply, migraciones,
  push ni despliegues. No se leyó ningún secreto ni dato personal de la nube.
- Hay divergencia documental sobre pnpm: el plan conserva 10; package.json y
  CI fijan 12.11.2 y ADR 0011 lo admite. Esta preparación no cambia versiones.

La aceptación funcional de la nueva entrega todavía no está cumplida. La
aprobación del alcance arquitectónico anterior es el siguiente paso.
