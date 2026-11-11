# ADR 0028 — Mi Sueño: scope and Retos (goals and badges)

- Status: Proposed (owner approval pending; nothing here may be built until Orlando approves it and issues a numbered task)
- Date: 2026-11-10 (revised 2026-11-11)
- Phase: B1 (scope and technical ADRs)
- Decides: Addendum B (§B.2 D8 to D11 and T10, §B.9), phase B5b (UP-13)
- Number: 0028 is provisional (0023 is taken by the Nox drafts and 0027 appears twice on the passkey branches); renumber at merge.

## Context

Mi Sueño is the wellness area of Morpheo for adults (Addendum B, owner Orlando). Addendum B
(owner's checkout of the build plan, not yet in `origin/main`) lists the decisions D1 to D11 and
T1 to T10 and the open points. Its ADR is still pending: this file did not exist, so it is started
here with the Retos section only. Orlando's decisions of 2026-11-10 and 2026-11-11 on the first draft are applied below.

## Rest of the scope (not written in this draft)

The other B1 sections are still to be written and approved by Orlando: the sixth service and the
amendment of §2 and ADR 0010 (T1), notes and Cloud KMS (T3), offline base (T4), web push and the
diary reminder (T5, B4), the REF/TIP catalogue and rules (B.3), privacy and deletion (T8), Apolo (T6).
Retos depends on every one of them and invents none. Where this section needs one of them, it says so.

## Retos

Short goals of 7 to 14 days that the person chooses and completes, with visible progress and a
personal badge at the end, so that using Mi Sueño every day feels rewarding and stays short.

### 1. Catalogue

- One item per `RET-xx` in `docs/product/mi-sueno/retos/`, versioned, changed by pull request. No
  editor in the admin console for now (T10).
- Validated by a Zod 4 schema in `packages/api-contracts` (schema only, no logic):

| Field | Rule |
|---|---|
| `id` | `RET-` plus two digits, unique |
| `version` | integer from 1; any change to a text or a rule is a new version |
| `status` | `draft` or `approved`. A draft is marked `BORRADOR – Orlando` and is never offered to a real user |
| `text` | `es`, `en`, `ca`, `fr`, each with `title`, `description` and `badgeSentence`; all four required |
| `link` | a `REF-xx` (must exist in the REF catalogue), a habit key, or the diary |
| `durationDays` | integer from 7 to 14 |
| `completion` | closed set of rule kinds with parameters (below); `daysRequired` is at most `durationDays` |
| `reviewDate`, `reviewer` | annual review date; reviewer `Orlando`. An item past its review date is not offered |

- `completion` is data that selects one of a **closed list of evaluators in code**, never an
  expression or script (no `eval`: the app's CSP forbids it, see `docs/security/hosting-headers.md`).
  First list, from the draft RET-01 to RET-06: `days_with_morning_entry`, `wake_time_within_usual`,
  `last_caffeine_gap_hours`, `habit_done`, `routine_done`. A new kind needs code, tests and a pull request.
- **RET-07 (read in Apolo) is removed from the catalogue** (Orlando, 2026-11-10). A reading goal is a usage
  rule for Apolo and conflicts with D4. No evaluator kind reads Apolo or any measure of use of the app.
- The catalogue texts are versioned content per locale (like Morpheo's questions, §3.3), not UI locale
  files. Buttons, states and messages of the Retos screens are in the locale files as usual.
- CI builds one validated JSON from the folder; the app bundle and the service image both consume it.
  An active Reto is pinned to the `id` and `version` it started with; a later version never changes it.

### 2. Evaluation

- Deterministic pure functions over data the person already logged. No language model writes,
  selects, rewrites or evaluates a Reto.
- The person chooses from the Retos that are eligible: approved, in date, enough data, and, for a Reto
  linked to a habit, that habit is already one of the person's active habits (accepting a Reto never adds
  a habit, so the limit of 3 stands). The app orders them by catalogue order only.
- **No Reto is selected, ranked, recommended or hidden by how the person slept, with one explicit
  exception:** the eligibility of a *schedule* Reto by the person's typical time in bed (last bullet of
  this section). Nothing else about sleep (rating, duration slept, efficiency, awakenings, notes) can
  select a Reto. The exception only removes a Reto from the list. An ineligible Reto is simply not shown
  and **never explains why**: the offer list has no reason field and looks the same whether a Reto is
  hidden for its time in bed, its review date or its draft status.
- The evaluator's input type has only these fields: morning entry present, final wake time, time into
  bed, habit entries (done, and the clock time that every UP-04 entry stores), routine done. Duration,
  efficiency, rating, awakenings and notes are not in the type. Free-text notes are never read (D5).
- **RET-03 (coffee)** takes the time of the last coffee from the UP-04 "coffee" habit entry (phase B5),
  not from the diary, so D2 (the diary's fields) is untouched. UP-04 stores a clock time for every chip,
  coffee included (each chip sits at its hour on the day line; Orlando, 2026-11-11), so RET-03 can be
  evaluated. The coffee entry of day D is paired with the bedtime in the morning entry of D+1, and the
  counted day is the date of that morning entry.
- Two implementations, one behaviour: `apps/somnus-app/src/lib/retos/` (device) and
  `services/somnus-wellness-service/src/domain/retos/` (service). Both run the same conformance
  fixtures kept in `docs/product/mi-sueno/retos/conformance/`. A shared package was rejected: §7 keeps
  shared packages free of business rules.
- The **service is the authority**: it recomputes from the person's synced logs. The device value is
  provisional and is replaced by the service's answer.
- **The service recompute can only add counted days, never remove them.** It evaluates the days it has
  not counted yet and inserts a row only where none exists for that instance and date. It never updates
  or deletes a row. If a diary entry is later edited or deleted, or an evaluator would now answer
  differently, the days already counted stay. A day the device showed as provisional and the service
  never confirms simply does not appear in the service's answer; no day the service has counted is ever
  taken back.
- A day belongs to the local date of the morning entry (not of the time it was logged), so a late entry
  still counts inside the window. While the Reto is frozen no day is counted, and what that means for
  entries that sync late is decided in section 6.
- **Eligibility of a schedule Reto** (the single exception above) uses one input only: the person's
  typical time in bed, taken from the times into bed and wake that they logged, never a rating or a
  duration slept. A schedule Reto is eligible only if that typical time in bed minus the Reto's own
  tolerance is at least 7 h. Any bedtime target comes from the single 7 h guard shared with TIP-H01. The
  guard is built in B5b, before TIP-H01 (B6), which reuses it.

### 3. Ending a Reto

- It completes the moment the counted days reach `daysRequired`: state `completed`, one badge, and it ends
  (rule 8). Nothing starts by itself afterwards.
- If the window ends first, there is **no badge** and the person sees a neutral text with no failure wording
  (the text is content that Orlando approves). They may extend it **once by 7 days** (`extension_used`; the 7 to
  14 range applies to the catalogue duration, not to the extension) or choose another Reto. If they choose
  another, or the extended window also ends, the state is `closed`.
- Badge sentences use day counts only (the single placeholder is the number of counted days). No measured
  number (a time, a minutes figure) can appear in a badge sentence, because it could work as a score.

### 4. Data model (`somnus_wellness`)

Every repository method takes the person's scope (§8). No cross-service reads. No free text anywhere in
these tables.

| Table | Content |
|---|---|
| `reto_instances` | id (UUIDv7), user, `ret_id`, `ret_version`, `started_on`, `window_ends_on`, `extension_used`, `reference_minutes` (the person's usual wake time, fixed at start, integer), `frozen_remaining_days` (null unless frozen), `receive_mark` (integer, a position in the service's receive order, section 6), `active_slot`, `state` (`active`, `completed`, `closed`), `ended_on` |
| `reto_days` | (instance, local date): one row per counted day. Append-only: no update or delete path except erasure |
| `reto_badges` | id, user, `ret_id`, `ret_version`, instance, `earned_on`, `counted_days`. The sentence is rendered from the catalogue at display time, in the person's locale |

- Accumulated days = the number of rows in `reto_days`. Nothing is decremented; a later edit or deletion
  of a diary entry never removes a counted day, and the service recompute only inserts (section 2).
- The in-therapy flag stays where B4 defines it (yes or no only, B.5). Retos never stores when it was set.
- Idempotency: every write from the device carries a client-generated key; the service keeps the keys it
  has processed (the offline base of B2).
- Retos has no reminder table and no push text: see rule 7.
- Export includes these tables; account deletion erases them (T8, ADR 0025); both have tests (rule 9).

### 5. Offline

- The device computes progress from the local logs so the person sees it at once, and queues the writes.
- The service confirms with idempotency keys and returns the authoritative state, which replaces the local one.
- While the device itself has the in-therapy flag set it counts no new day locally. The flag change is a
  queued write like any other and keeps its place in the device's queue (section 6).
- Device copies are removed on sign-out and on account deletion (T4, T8). Whether the local copy of the
  in-therapy flag and of Reto state needs the same non-exportable key as notes is part of the device
  encryption design (open point B.8).

### 6. Pause

- When the person marks "I am in therapy or treatment for my sleep", in one transaction in the service:
  `frozen_remaining_days` = days left in the window (a whole number), `window_ends_on` = null. No Reto is
  offered and `start` is refused. Counted days stay.
- When the person clears the flag: `window_ends_on` = today + `frozen_remaining_days`, and everything resumes
  as it was. The dates of the therapy period are never stored.
- **While frozen, no day is counted.** An entry that the service receives while the flag is set is never
  evaluated for a Reto: not then, and not after the person clears the flag or after any recompute.
- **Entries that sync late, with no therapy date stored: decided by the service's receive order, not by
  the date of the entry.** The service gives every log entry an increasing position in its own receive
  order when it stores it (a counter per person; the offline base of B2 provides it, or B2 adds it).
  `receive_mark` is the position up to which entries have been dealt with. While frozen it does not move.
  When the flag is cleared, `receive_mark` is set to the highest position at that moment, so every entry
  received during the freeze stays behind it and is never counted, and only entries received after the
  clear are evaluated. The mark is a position, not a date.
- **A flag set offline** is a queued write like any other. Each device's queue is applied in the order the
  device wrote it, and queues of different devices in the order the service receives them. So for a queue
  [set flag, entry, clear flag] the entry is received while frozen and is not counted, for [entry, set
  flag] the entry is counted (it was logged before the pause), and entries logged on the device after it
  set the flag locally are never counted even if the device was offline for days. If a flag set on one
  device reaches the service after the service has already counted entries from another device, those
  days stay (the recompute never removes a day, section 2).
- **Two consequences of this design, for Orlando's approval of the ADR.** (a) A night lived before the pause whose
  entry first reaches the service during the pause is not counted. (b) The one case that receive order
  cannot tell apart is a device that stays offline across the whole pause and syncs after the clear: its
  entries count if their local date falls inside the window. A test pins both behaviours so that nobody
  changes them by accident.
- Only the person sets or clears the flag; Retos never infers it, and it is not inferred from how few days
  were logged. Retos has no reminder, so there is nothing to suppress. The B4 diary reminder is not a Reto
  and is not part of this pause.

### 7. Measurement (the guardrail)

- Measured **only inside the service**, as aggregates with a minimum group size, nothing per person:
  mornings logged per week, and Retos completed and Retos closed.
- **The minimum group size is 10 people** (Orlando, 2026-11-11). A total computed from fewer than 10 people
  is not produced: it is absent, not shown as zero. The value is a named constant in the service
  (`MIN_GROUP_SIZE = 10`), not a runtime setting. Nothing leaves the service as an event, nothing goes to
  BigQuery, nothing is logged.
- **Not measured:** session duration or any time in the app (it would measure time in the app), and the
  pause rate or any count derived from the in-therapy flag (it would reveal therapy status).
- "Short sessions" is a design principle, checked in usability tests with people, not by telemetry.
- Tests: no counter reads the in-therapy flag; no Retos event schema exists; the aggregates contain no
  identifier. **Group size:** with 9 people a total is not produced (the key is absent, not zero) and with
  10 it is; the same at the boundary for each of the three measures; a Reto completed by 9 people produces
  nothing and no error. A test fails if the constant is below 10. Mutation: change the comparison from
  "fewer than 10" to "fewer than 9" and the test must fail.

### 8. Rules and the test that enforces each

Every guard below is mutation-tested: break the code on purpose, show the test fail, restore it.

| # | Rule | Test that proves it |
|---|---|---|
| 1 | Behaviour goals only: never hours slept, quality, ratings, efficiency or any score; no promised health effect; no goal about using Apolo | The schema accepts only the closed list of kinds. Evaluators run against an entry wrapped so that reading a rating, duration, efficiency or note throws. A scanner checks every RET text and badge sentence in the four locales against the forbidden-phrase list in `docs/product/mi-sueno/` (kept in Mi Sueño, not taken from Morpheo's claims registry, D1). Its content belongs to the regulatory wording, which is open (open point 1) and is not drafted here |
| 2 | A schedule goal never leads to fewer than 7 h in bed | One function `timeInBedFloor` with the 7 h floor, shared with TIP-H01. Property test: a schedule Reto is offered only if typical time in bed minus the Reto's tolerance is at least 7 h. Bedtime targets can only come from that function. **Single exception to "no Reto is selected by how the person slept":** the eligibility function takes typical time in bed and nothing else (a type test: no rating, duration slept, efficiency, awakening or note field), only schedule Retos pass through it, and it only removes. Contract test: the offer list has no reason field, and a Reto hidden for its time in bed gives a list identical in shape to one hidden for its review date |
| 3 | Pause on therapy, resume where left, nothing lost | Property test on any sequence of days with pause and resume: counted days and remaining days are unchanged by the pause. While flagged: the offer list is empty and `start` is refused. No therapy date is stored. **No day counted while frozen, by receive order:** an entry received while frozen is never counted, not after the clear and not after a recompute; queue [set, entry, clear] counts nothing for the entry, queue [entry, set] counts it; entries logged on a device after it set the flag offline are not counted; a device offline across the whole pause that syncs after the clear is counted by local date (pinned, section 6). `receive_mark` is a position and no date column exists in the Retos tables (schema test) |
| 4 | Accumulated days only: no streaks, no reset, no loss, no failure message; counted days are append-only | Property test: for any sequence of daily logs, and any edit or deletion of an entry, the count never decreases. **The service recompute only adds:** running it again, or after an entry is edited or deleted, leaves every existing row byte-identical and can only insert new ones; mutation: make it delete a row and the test fails. The repository exposes no update or delete of `reto_days` except erasure. No field, type or i18n key named streak, consecutive, lost or failed. Rendering a missed day produces no negative copy. The end-without-days text has no failure wording |
| 5 | One active Reto at a time, besides the limit of 3 active habits | Unique key on (`user`, `active_slot`), where `active_slot` is 1 while active or frozen and null otherwise. Concurrency test: two simultaneous starts give one instance. A habit-linked Reto is not offered if its habit is not active |
| 6 | Only reward: a personal badge with a short factual sentence of day counts; none if the days were not reached | Contract test: no `points`, `level`, `score`, `rank`, `leaderboard` field in any schema or table. Badge sentence placeholders are only the day count. A `closed` instance has no badge. Badges are readable only with the person's scope. The completion animation honours `prefers-reduced-motion` (Playwright) |
| 7 | Retos sends no reminder or push of its own. The only reminder in Mi Sueño is the B4 diary reminder, and the cap of one reminder a day applies to all of Mi Sueño | Architecture test: the Retos code imports no push or notification module and the notification catalogue has no Reto text. The cap and its test belong to the B4 reminder work. A future Reto reminder needs a new ADR and counts toward the same cap |
| 8 | A finished Reto ends there | After `completed` or `closed` nothing starts without an explicit `start`; the state offers rest or another choice |
| 9 | Own data, export, deletion, offline | Cross-person read returns nothing. **The export includes `reto_instances`, `reto_days` and `reto_badges`. Account deletion removes every one of their rows, `reto_days` included**, with a test that no row is left. A redaction test proves no Reto data in logs. Sign-out removes the device copy |
| 10 | Drafts never reach real users | The offer list excludes `draft` and items past their review date |

### 9. Conflicts with earlier decisions, and how each is closed

1. **Guardrail metrics against "Mi Sueño data never reaches analytics or BigQuery"** (agent brief §7, B.5):
   closed by section 7 (Orlando).
2. **"Same automated test as TIP-H01"** while TIP-H01 arrives in B6, after B5b: the guard and its test are
   built in B5b and reused by TIP-H01 (agreed).
3. **Retos link to REF items and the REF catalogue is B6 work:** the REF ids exist as validated files in the
   repository before B5b starts (agreed).
4. **Limit of 3 active habits:** a habit-linked Reto is eligible only if that habit is active (agreed).
5. **RET-07 against D4:** removed from the catalogue (Orlando).
6. **Rule 2 against RET-02** (an earlier wake can cut time in bed below 7 h): the eligibility formula in
   section 2 (agreed).
7. **One reminder a day against D6, the diary reminder and T5 (no health data in push text):** Retos has no
   reminder in the first version; the cap covers all of Mi Sueño (Orlando).
8. **B.5 stores the in-therapy flag as yes or no only, and rule 3 requires "resume where they were":** a whole
   number of remaining days and no therapy date (agreed).
9. **RET-03 against D2:** the last coffee time comes from the UP-04 coffee entry, so D2 is not touched.
   UP-04 stores a clock time for every chip, coffee included (Orlando, 2026-11-11), so RET-03 can be
   evaluated.
10. **The badge example "within 20 minutes" against RET-02's 30 minutes, and measured numbers acting as a
    score:** badge sentences carry day counts only (agreed).
11. **T4 (offline compute) against the service as authority:** the service recomputes (section 2), and only
    adds days.
12. **Rule 3 ("nothing is lost") against "no day counted while frozen" and "no therapy date stored":** the
    freeze is decided by the service's receive order, with a position and no date (section 6). Days already
    counted are never lost; a night whose entry first arrives during the pause is not counted.
13. **"No Reto is selected by how the person slept" against rule 2 (schedule goals never under 7 h in bed):**
    one explicit exception, the eligibility of schedule Retos by typical time in bed, which only hides a Reto
    and never explains why (section 2).

No conflict was found with D1, D3, D5, D7 (Retos extends its pause) or T1, T2, T3, T6 to T9.

### 10. Open points for Orlando

1. **Regulatory wording of Retos and badges (no health promise).** Open, and it **must be closed before B5b
   ships**. It covers the Reto texts, the badge sentences, the neutral text when a Reto ends without its
   days, and the forbidden-phrase list. Nothing is drafted here, and the qualification of Mi Sueño as
   wellness is reviewed against that wording (B.9).
2. **Minimum group size** for the aggregates of section 7. **Closed (Orlando, 2026-11-11): 10 people.**
3. **The UP-04 coffee entry must store a clock time.** **Closed (Orlando, 2026-11-11):** UP-04 stores a
   clock time for every chip, coffee included, so RET-03 can be evaluated.

## Consequences

- New: a catalogue folder and schema, two evaluator implementations plus shared fixtures, three tables, one
  shared 7 h guard. No new deployable, dependency or secret.
- Retos cannot ship before: the regulatory wording is closed and the REF files exist.
- Retos needs a per-person receive order on log entries from the offline base (B2), or B2 adds it.
- A night lived before a pause whose entry first reaches the service during the pause is not counted.
- Retos adds work to the export and to account deletion, and both have a test.
- The guardrail is three aggregate counts and a design principle. There is no dashboard of per-person
  behaviour and no therapy-related figure.
