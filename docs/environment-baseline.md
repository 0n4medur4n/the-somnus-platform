# Environment Baseline

**Checkpoint:** 0.1 — Local prerequisites
**Date:** 2026-07-21
**OS:** Windows 10/11 (PowerShell 5.1, win32)
**Architecture:** x86_64
**Recorded by:** AI implementation agent, session Prompt 0.1

---

## Resolved status (after user-approved deviations + installations)

| Tool        | Build-plan target  | Agreed target        | Installed              | Status |
|-------------|--------------------|----------------------|------------------------|--------|
| Git         | stable             | stable               | 2.46.0.windows.1       | PASS   |
| Node.js     | 24 LTS             | 24 LTS               | 24.11.1                | PASS   |
| Corepack    | bundled with Node  | bundled with Node    | 0.34.2                 | PASS   |
| pnpm        | 10.x               | **latest stable (user-approved deviation)** | 11.5.0 | PASS |
| Python      | 3.13               | **3.14.3 (user-approved deviation, latest stable)** | 3.14.3 (`py -3.14`) | PASS |
| uv          | latest stable      | latest stable        | 0.11.26                | PASS   |
| Docker      | stable (daemon live) | stable (installed) | 29.6.2, daemon UP      | PASS   |
| gcloud CLI  | stable             | stable               | 550.0.0                | PASS   |
| Terraform   | stable 1.x         | stable 1.x (installed) | 1.15.7 (latest available on winget is 1.15.8) | PASS |
| Firebase CLI| stable             | stable               | 15.15.0                | PASS   |

### User-approved deviations from build plan §18

1. **pnpm 11.5.0** instead of 10.x — user decision ("la versión más nueva
   estable nos sirve"). Latest stable. No warm-up or any other cost-related
   mechanism is being added; this is purely the package manager.
2. **Python 3.14.3** instead of 3.13 — user decision ("la versión más nueva
   estable nos sirve"). The active interpreter is `py -3.14`; the legacy
   3.11.0 default is no longer used by the toolchain. The build plan
   pins 3.13; this deviation will need to be revisited if any Python
   service reaches a phase where 3.13-only features are required by
   a dependency (FastAPI / SQLAlchemy 2.0 / Alembic 1.x are all
   compatible with 3.14 at the time of this baseline).

### Installation actions performed in this session

```text
winget install --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
  -> Docker Desktop 4.83.0 (engine 29.6.2, compose v5.3.1, buildx v0.35.0-desktop.2)

winget install --id Hashicorp.Terraform --accept-package-agreements --accept-source-agreements
  -> Terraform 1.15.7 (winget shows 1.15.8 as the latest, but 1.15.7 is a
     stable 1.x release, so it satisfies build plan §18)

First-boot of Docker Desktop was required to bring the engine online
(PID 38648, daemon listening on npipe //./pipe/docker_engine,
Server Version reported 29.6.2).
```

Both `docker.exe` (at `C:\Program Files\Docker\Docker\resources\bin`) and
`terraform.exe` (at `C:\Users\becr3\AppData\Local\Microsoft\WinGet\Packages\Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe`)
have been added to the **user-level PATH**. New shells will pick them
up automatically; the current session was refreshed manually with
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','User') + ';' + [Environment]::GetEnvironmentVariable('PATH','Machine')`.

### Prerelease-channel rejection

Per build plan §18, alpha / beta / rc / canary / nightly releases are
rejected. None of the installed versions carries a prerelease tag:
- Docker 29.6.2 → stable
- Terraform v1.15.7 → stable (the "out of date" notice points to 1.15.8,
  another stable release, not a prerelease)

---

## Re-verification command set (PASS output, 2026-07-21)

```text
git --version              -> git version 2.46.0.windows.1
node --version             -> v24.11.1
corepack --version         -> 0.34.2
pnpm --version             -> 11.5.0
py -3.14 --version         -> Python 3.14.3
uv --version               -> uv 0.11.26
docker --version           -> Docker version 29.6.2, build dfc4efb
docker info | grep Server  ->  Server Version: 29.6.2
gcloud --version           -> Google Cloud SDK 550.0.0
terraform --version        -> Terraform v1.15.7
firebase --version         -> 15.15.0
```

**Exit criterion of Checkpoint 0.1 met:** every verification command
succeeds against the agreed target versions (which include the two
user-approved deviations listed above).

---

## Notes for the next checkpoint (Prompt 1.1)

- The Python toolchain will resolve to 3.14.3 via `py -3.14` in any
  scripts; `uv` will be told to use 3.14 explicitly. The build plan
  pinning to 3.13 remains the formal target; the deviation above is
  the live reality of this machine and must be carried forward in
  service READMEs and the monorepo's `.python-version` file.
- Docker Desktop must be running (`Docker Desktop.exe` started in this
  session). On next machine reboot, either Docker Desktop auto-start
  must be enabled, or `just dev-up` must launch it. Document in
  `justfile` and `README`.
- pnpm 11 will be the active workspace manager. No warm-up or cost
  mechanism is being introduced; this is purely a package manager
  version choice.


Each item below must be executed and re-verified before this checkpoint can
be marked green. Do **not** proceed to Prompt 1.1 until every row reads PASS.

### 1. pnpm is 11.5.0, required 10.x

- Symptom: `corepack prepare pnpm@10.15.0 --activate` failed with
  `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpx'`
  because the agent process is not elevated.
- Remediation:
  1. Open PowerShell **as Administrator**.
  2. `corepack enable pnpm`
  3. `corepack prepare pnpm@10.15.0 --activate`
  4. Close and reopen the shell, then verify: `pnpm --version`
     must show `10.15.0` (or any 10.x stable).
- Alternative: `npm i -g pnpm@10` from an elevated shell.
- Acceptance: `pnpm --version` starts with `10.`.

### 2. Python 3.13 not installed (only 3.11.0 and 3.14.3)

- Symptom: `py -3.13 --version` returns "No suitable Python runtime found".
- Remediation:
  1. `winget install Python.Python.3.13` (run as the current user, winget
     prompts for elevation if needed).
  2. After install, close and reopen the shell, then `py -3.13 --version`
     must report `3.13.x`.
  3. Ensure the default `python` resolution points to 3.13 by re-running
     the launcher or by adjusting PATH so that `Python313` precedes
     `Python311` and `Python314`. The build plan requires Python 3.13 as
     the active interpreter; 3.11 and 3.14 are not acceptable substitutes
     (pinned stack, build plan §3.5 / §18).
- Acceptance: `python --version` (or `py -3.13 --version`) reports a
  3.13.x release.

### 3. Docker not installed

- Symptom: `docker --version` → `CommandNotFoundException`.
- Remediation:
  1. `winget install Docker.DockerDesktop`
  2. Restart the session (sign out / in, or reboot) so the Docker daemon
     and `docker` CLI are on PATH and the WSL 2 backend (if required by
     the installer) is initialised.
  3. Verify: `docker --version` and `docker info` (daemon must be running).
- Acceptance: `docker --version` returns a stable version and
  `docker info` succeeds without "cannot connect to the Docker daemon".

### 4. Terraform not installed

- Symptom: `terraform --version` → `CommandNotFoundException`.
- Remediation:
  1. `winget install Hashicorp.Terraform`
  2. Open a new shell and verify: `terraform --version` reports a stable
     1.x release (no alpha/beta/rc suffix, per build plan §18).
- Acceptance: `terraform --version` shows a stable 1.x build.

---

## What this checkpoint is **not** required to do

- No repository is created yet (Phase 1).
- No quality gate is run yet.
- No files inside the eventual monorepo exist; only this baseline note.

---

## Re-verification log

Filled in the *Re-verification command set (PASS output, 2026-07-21)*
section above, after the user-approved deviations and installations
were applied. The exit criterion of Checkpoint 0.1 is met.

---

## Original failure log (kept for the record)

The first run of this checkpoint reported four failures. The following
actions resolved them per the user's explicit approval:

- **pnpm 11.5.0 instead of 10.x** — accepted (user decision).
- **Python 3.14.3 instead of 3.13** — accepted (user decision).
- **Docker** — installed via `winget install Docker.DockerDesktop`,
  daemon started by launching `Docker Desktop.exe` (PID 38648), engine
  reports `Server Version: 29.6.2` on `npipe:////./pipe/docker_engine`.
- **Terraform** — installed via `winget install Hashicorp.Terraform`,
  binary resolved at `…\WinGet\Packages\Hashicorp.Terraform_…\terraform.exe`,
  reports `Terraform v1.15.7` (stable 1.x, no prerelease tag).

