# The Somnus

**Salud digital del sueño.** Comprende tu sueño. Toma mejores decisiones.

[![CI](https://github.com/0n4medur4n/the-somnus-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/0n4medur4n/the-somnus-platform/actions/workflows/ci.yml)

The Somnus es una empresa de salud digital centrada en el sueño. Este repositorio
contiene toda la plataforma: la web pública, la aplicación de las personas, la
consola interna del equipo y los servicios que lo sostienen.

Su primer producto es **Morpheo**.

## Qué es Morpheo

Dormir mal no siempre tiene la misma causa. Despertares, cansancio, dificultad
para dormir o un sueño que no repara pueden parecer el mismo problema y no serlo.
Morpheo es una entrevista guiada para **personas adultas** que duermen mal: les
ayuda a ordenar lo que les pasa, entender qué patrón puede haber detrás y saber
cuál es el siguiente paso razonable, con un informe claro que pueden llevar a su
profesional sanitario.

Morpheo es una herramienta de **orientación**, no de diagnóstico.

- No diagnostica ni descarta enfermedades.
- No receta ni ajusta tratamientos.
- No decide por sí sola si hace falta una prueba o una derivación.
- No sustituye a un profesional sanitario.

Un resultado tranquilizador significa solo que, con la información disponible,
no apareció ninguna señal que pida actuar antes. Nunca significa que no haya
nada.

### Cómo es una evaluación

1. **Preguntas de protección primero.** Antes de nada, el sistema comprueba las
   situaciones que no pueden esperar. En medicina del sueño casi no hay
   urgencias; las dos prioridades reales son la ideación suicida y la
   somnolencia al volante. El tono es sereno, nunca alarmista.
2. **Una pregunta por pantalla.** Un recorrido sencillo, con ramas que solo se
   abren si hacen falta.
3. **La persona cuenta su caso con sus palabras.** Una IA propone qué ha
   entendido («Por lo que nos ha contado, entendemos…») y **la persona confirma o
   corrige** antes de que el motor use nada de eso.
4. **Reglas, no modelos, deciden.** Un motor determinista aplica las reglas
   clínicas y elige la orientación.
5. **Un informe.** Una página para la persona y otra para entregar a su
   profesional, con los hechos que activaron cada orientación, lo que se
   desconoce, qué conviene preparar y los límites del resultado. Se ve en
   pantalla y se descarga en PDF.

Con el mismo conjunto de respuestas, el resultado es siempre el mismo.

### Cuestionarios validados

El motor está preparado para ofrecer ISI (insomnio), Epworth (somnolencia) y
STOP-Bang (apnea) como complemento opcional, que nunca decide por sí solo. Solo
se activan a partir de los ficheros oficiales de las versiones validadas en
español, con su licencia.

## Quién lo usa

| Quién | Dónde | Qué hace |
|-------|-------|----------|
| Personas adultas | [app.thesomnus.com](https://app.thesomnus.com) | Hacen la evaluación, ven su historial en «Mi espacio», descargan su informe |
| Público | [thesomnus.com](https://thesomnus.com) | Conoce The Somnus y Morpheo; textos legales; en cuatro idiomas |
| Equipo de The Somnus | Consola interna | Gestión de usuarios y verificación profesional, revisión de contenidos, biblioteca de fuentes clínicas, estadísticas, auditoría y un Drive cifrado de extremo a extremo |

Los profesionales sanitarios y las organizaciones forman parte del modelo de la
plataforma (verificación, roles, invitaciones, acceso solo con consentimiento
explícito), y se irán abriendo por fases.

## Cómo está construida

Una plataforma pequeña, barata de mantener y con fronteras claras. **Dos
frontales estáticos** más la consola, y **cinco servicios** independientes en
Google Cloud Run.

```text
Internet
   |
   +--> Firebase Hosting
   |        +--> somnus-marketing   Astro, estático        thesomnus.com
   |        +--> somnus-app         Vite + React           app.thesomnus.com
   |        +--> somnus-admin       Vite + React           consola interna
   |
   +--> somnus-edge-api             NestJS, público
              |
              +--> somnus-identity-service   NestJS, privado
              |        incluye el módulo aislado de Consentimiento
              +--> morpheo-service           Python, privado
              +--> somnus-report-service     Python, privado
              +--> somnus-worker             NestJS, privado
                       incluye los módulos aislados de Notificaciones,
                       Auditoría y Drive
```

| Servicio | Responsabilidad |
|----------|-----------------|
| [`somnus-edge-api`](./services/somnus-edge-api) | La única puerta pública. Sesiones, CSRF, CORS, límites de uso y composición. No toca ninguna base de datos |
| [`somnus-identity-service`](./services/somnus-identity-service) | Usuarios, perfiles, organizaciones, roles y **todas las decisiones de autorización**. Aloja el módulo de Consentimiento, con su propia base de datos |
| [`morpheo-service`](./services/morpheo-service) | El motor clínico: la entrevista, las reglas, las categorías de orientación y los artefactos clínicos versionados |
| [`somnus-report-service`](./services/somnus-report-service) | Informes en HTML y PDF, redacción controlada, biblioteca de fuentes clínicas y su búsqueda |
| [`somnus-worker`](./services/somnus-worker) | Correos, auditoría, tareas programadas (como el borrado automático) y el Drive del equipo |

Código compartido en [`packages/`](./packages): contratos (Zod), errores,
configuración, observabilidad, internacionalización, sistema de diseño y cliente
de servicios internos.

### Principios que no se negocian

- **Firebase autentica. The Somnus autoriza.** Quién eres lo dice Firebase; qué
  puedes hacer lo decide siempre `somnus-identity-service`. Que alguien
  administre una organización no le da acceso a datos clínicos.
- **Cada servicio es dueño de sus datos.** Una base de datos lógica por servicio
  y por módulo aislado, sobre TiDB Cloud. Nadie lee las tablas de otro.
- **La IA no decide nada clínico.** Nunca puntúa, deriva ni fija la urgencia.
  Extrae datos del relato que la persona confirma, redacta con las palabras ya
  aprobadas y cita fuentes. Todo lo que dice pasa por un filtro de frases
  prohibidas y por un esquema acotado; si falla, se muestra el texto aprobado.
- **El contenido clínico es una fuente de verdad versionada.** Las preguntas,
  reglas y textos viven en `services/morpheo-service/clinical/`, un submódulo de
  un repositorio privado, con su registro de cambios. El código los aplica, no
  los reescribe.
- **Privacidad por diseño.** Sin nombres ni identificadores en la entrevista;
  nada de datos de salud en los registros ni en los correos; las evaluaciones
  anónimas sin reclamar se borran a los 30 días y los enlaces de reclamación
  caducan a las 72 horas; cualquiera puede borrar su cuenta y sus datos.
- **Coste primero.** Todos los servicios escalan a cero instancias. Los
  arranques en frío son el precio de mantener la plataforma barata.
- **Cuatro idiomas.** Interfaz en español (por defecto), inglés, catalán y
  francés; una clave que falte en cualquiera rompe la integración continua. La
  consola interna va en español e inglés. Hoy la entrevista clínica está
  redactada en español.
- **Los contratos se escriben una vez.** Zod es la fuente de verdad; OpenAPI y
  los esquemas JSON se generan, nunca se escriben a mano.

## Tecnología

| Capa | Herramientas |
|------|--------------|
| Frontales | Astro, Vite, React, TypeScript, Tailwind CSS, TanStack Query, i18next |
| Servicios de plataforma | Node.js 24, NestJS 11 con Fastify 5, Drizzle ORM, Zod 4 |
| Motor clínico e informes | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, WeasyPrint, `uv` |
| Datos | TiDB Cloud (protocolo MySQL), Firestore (solo estado temporal de sesión), Cloud Storage, BigQuery (analítica sin datos personales) |
| IA | API de OpenAI detrás de una capa de abstracción de proveedores, con `store: false` en cada llamada |
| Identidad y correo | Firebase Authentication con enlace por correo, sin contraseñas; Brevo |
| Infraestructura | Google Cloud (europe-west3), Terraform, GitHub Actions |
| Calidad | Biome, Ruff, mypy, Vitest, pytest, Playwright, dependency-cruiser |

## Estado

La plataforma está **en funcionamiento y en fase previa al lanzamiento**: la
aplicación, la consola y la web pública están desplegadas y el motor clínico
actual (el embudo v0.2) es el flujo activo. Antes de abrirlo a pacientes reales
quedan tareas de producción y de cumplimiento normativo; la lista de pendientes
y la evaluación de impacto están en el repositorio interno privado (ver
«Material privado»).

Todo el contenido clínico que el equipo clínico no ha aprobado se marca como
borrador y nunca se presenta como aprobado.

## Estructura del repositorio

```text
apps/              somnus-marketing · somnus-app · somnus-admin
services/          edge-api · identity · morpheo · report · worker
packages/          contratos, errores, configuración, i18n, diseño, observabilidad…
schemas/           esquemas JSON y OpenAPI generados
infrastructure/    Terraform (módulos y entornos)
docs/              ADR y guías de desarrollo
scripts/           utilidades de desarrollo y de CI
```

## Desarrollo en local

Requisitos y versiones exactas en [`docs/environment-baseline.md`](./docs/environment-baseline.md).

```bash
pnpm install          # dependencias del workspace
just dev-up           # MySQL 8 y emuladores de Firebase en Docker
just ci               # formato, lint, tipos, tests y build
just dev-down         # parar el entorno
```

Los servicios Python se prueban desde su carpeta con `uv run ruff check .`,
`uv run mypy src` y `uv run pytest`. Las reglas de trabajo, la puerta de calidad
y las convenciones están en [`docs/build-progress.md`](./docs/build-progress.md).

## Documentación

| Qué | Dónde |
|-----|-------|
| Avance de la construcción, estructura y guía de desarrollo | [`docs/build-progress.md`](./docs/build-progress.md) |
| Decisiones de arquitectura | [`docs/adr/`](./docs/adr/README.md) |
| Cada servicio y cada app | el `README.md` de su carpeta |
| Plan de construcción, operación (despliegue, copias, incidentes), seguridad, amenazas y evaluación de impacto | repositorio privado `the-somnus-internal` |
| Contenido clínico y su registro de cambios | repositorio privado `the-somnus-clinical` |

## Material privado

Parte de la documentación y todo el contenido clínico viven en dos repositorios
privados y no se publican aquí:

- `the-somnus-clinical` es el submódulo `services/morpheo-service/clinical/`.
  Tras clonar: `git submodule update --init`.
- `the-somnus-internal` se clona en `internal/` (ignorado por git):
  `git clone git@github.com:0n4medur4n/the-somnus-internal.git internal`.

Hace falta acceso a ambos para compilar y probar `morpheo-service`. La CI los
obtiene con una clave de despliegue de solo lectura.

## Aviso

Morpheo ofrece información orientativa y educativa. No realiza diagnósticos ni
sustituye a un profesional sanitario. Si tienes una urgencia, llama al **112**.
