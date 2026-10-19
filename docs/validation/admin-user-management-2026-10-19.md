# Gestión de usuarios e invitaciones Morpheo

Entrega aprobada por el propietario el 19/10/2026; ADR 0021. Sin dependencias
nuevas, cambios de Terraform, acceso a datos de pacientes ni concesiones Nox.
El alta se activa después de que el destinatario verifique su correo y complete
los datos y consentimientos separados. Los profesionales quedan pendientes de
verificación y no reciben roles profesionales automáticamente.

## Validación local y aislada

| Comando | Resultado ejecutado |
| --- | --- |
| `pnpm.cmd run check` | Exit 0; 779 archivos; 11 warnings y 1 info existentes. |
| `pnpm.cmd run typecheck` y `pnpm.cmd run build` | Exit 0 en ambos. |
| `pnpm.cmd run test:run --maxWorkers=1` con Git Bash en PATH | 37 archivos, 485 pruebas, exit 0. |
| `pnpm.cmd --filter @somnus/admin test:coverage --maxWorkers=1` | 24 archivos, 190 pruebas; líneas 90,86 %, funciones 86,34 %, ramas 76,34 %; exit 0. |
| `pnpm.cmd --filter @somnus/app test:coverage --maxWorkers=1` | 22 archivos, 158 pruebas; líneas 85,38 %, funciones 81,60 %, ramas 77,77 %; exit 0. |
| API: `firebase emulators:exec ... 'pnpm --filter @somnus/edge-api test:coverage'` | 34 archivos, 611 pruebas; líneas 90,80 %, funciones 88,55 %, ramas 79,63 %; exit 0. |
| Identity: `pnpm --filter @somnus/identity-service test:coverage`, Cloud Build `509b2ba8-d73a-44cc-9ace-57b5cd5760e6` | SUCCESS; 36 archivos, 606 pruebas; líneas 96,33 %, ramas 87,42 % globales; repositorios Identity 77,41 % ramas. MySQL 8.4 efímero en loopback; ningún acceso a TiDB. |
| Compilación Nest de Identity y edge | Exit 0. |
| Generación OpenAPI de ambos servicios | Exit 0; documentos generados, no escritos a mano. |
| Build Vite y TypeScript de ambas SPA | Exit 0; avisos de chunks mayores de 500 kB. |
| `playwright test --list -g 'Morpheo invitation'` | Carga cuatro escenarios es/ca, adulto/profesional. No equivale a ejecutarlos. |
| Terraform `fmt -check -recursive` | Exit 0. |
| Terraform `init -backend=false` y `validate` en dev/staging/production | Exit 0, configuración válida en los tres; sin estado remoto ni apply. |
| `node scripts/check-terraform-least-privilege.mjs` | Exit 0; sin roles owner/editor/IAM-admin/wildcard. |
| `git diff --check` | Exit 0. |

Mutación de la capacidad nueva: concederla temporalmente a `support_agent`
produce exit 1 (2 fallos / 194 pruebas). Restaurada la política: 194/194 pasan.
No se cambia ninguna aserción para aceptar esa concesión.

La lista exacta de campos de la prueba de ficha administrativa se amplía con
`organizations`, `roleAssignments` y `updatedAt`, los metadatos aprobados. Se
mantienen la lista explícita y las negativas sobre respuestas y evaluaciones.
Las suites inmutables de autorización, CSRF y aislamiento no se relajan.

## Fallos observados y corregidos

- El primer contenedor MySQL aceptaba el ping antes de terminar la inicialización;
  la espera comprueba ahora una consulta real antes de crear las bases efímeras.
- Se corrigieron una fecha de fixture fuera del rango TIMESTAMP de MySQL y la
  expectativa de campos administrativos nuevos. Después pasaron 601 pruebas,
  pero la cobertura de repositorios fue 67,74 % (< 70 %). Las pruebas adicionales
  de recuperación, revocación y conflictos elevan esa cobertura a 77,41 %.
- La aplicación quedó inicialmente en 79,31 % de funciones (< 80 %). La prueba de
  transporte de los nuevos métodos eleva la cobertura a 81,60 %.
- Dos pruebas de consola agotaron 5 s bajo carga paralela local. La repetición
  serial completa pasa sin modificar el timeout. La suite raíz exige Git Bash;
  su escáner de aislamiento también pasa serial sin cambiar sus límites.
- El workflow quedó temporalmente con finales CRLF, incompatibles con una prueba
  que localiza jobs por línea; se restauró LF y pasan las 485 pruebas raíz.
- Docker Desktop local no respondió. Las pruebas con MySQL se ejecutaron en Cloud
  Build; las imágenes y los E2E completos se verificarán en CI antes de publicar.
- El emulador heredó `DEBUG=release` e imprimió variables del entorno con
  credenciales GitHub y Deepgram. Se avisó al propietario sin reproducir valores;
  se desactivó DEBUG para las ejecuciones posteriores. Esas credenciales requieren
  rotación. Los logs están ignorados por Git y no forman parte de los paquetes.

El primer intento de subir el worktree completo fue rechazado por la revisión
automática. Se preparó un paquete limitado de 342 archivos y el propietario
autorizó expresamente su validación. Los reintentos usan esa misma lista; el
manifiesto conserva hashes del último contenido enviado. No se usan bases reales.

## Publicación pendiente

Faltan CI completo (todos los jobs), los cuatro E2E nuevos, las dos imágenes,
la migración como Job con referencia al secreto y la verificación live. El
manifiesto separado `docs/proposals/cloudbuild-release-manifest.json` describe
el contexto mínimo de las imágenes; excluye frontends, documentos clínicos,
credenciales y estado Terraform. Hosting espera todos los jobs del CI.

No se han enviado invitaciones reales como prueba ni se ha verificado entrega
en una bandeja de entrada. `emailQueued` significa aceptado por la cola.
