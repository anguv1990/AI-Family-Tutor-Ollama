# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first tutoring app (Node + TypeScript + SQLite + Ollama). It serves three curricula — Reception, Year 2 and Year 3 maths — through one deterministic session flow:

```
start session -> receive reviewed question -> submit typed answer
-> mark from answer key -> persist attempt/mastery -> receive next question
```

Ollama/the model is **not** responsible for marking correctness, mastery, promotion/demotion, or question difficulty — those are deterministic and rule-based (see `docs/mastery-rules.md`). Model-assisted hints are wired (`POST /api/sessions/:id/hint`) but never authoritative: a hint that leaks the answer, fails its schema or trips safety screening is replaced by a deterministic template.

**Direction change, 2026-08-12 — read `plan.md`'s "Direction change" section before adding content or model features.** The goal is now a tutor a child uses with no adult in the room, which means the fixed bank is being replaced by continuously generated questions and the model takes on explanation, restyling, next-skill choice and parent summaries. The rule that survives, in sharper form: **the model may propose a question, only code may prove it.** A generated item reaches a child only after a deterministic verifier re-derives its answer from the prompt text and agrees. The model still never marks. The next slice is extracting that verifier out of `tests/content-answer-keys.test.ts` into `server/answer-verifier.ts`.

## Commands

```bash
npm install
npm test        # runs `tsc` build then `node --test dist/tests/*.test.js`
npm run dev      # ts-node-dev on server/index.ts, live reload
npm run build    # tsc -> dist/
npm start        # node dist/server/index.js (run build first)
npm run benchmark    # tools/benchmark.ts against real Ollama, with an accept/reject decision
npm run start:tablet # build, then start with .env.local (LAN bind + ADMIN_SECRET) for tablet use
```

Run a single test file or test by name (after building, since tests run from compiled `dist/`):

```bash
npm run build
node --test dist/tests/session-flow.test.js
node --test --test-name-pattern="promotes to secure" dist/tests/*.test.js
```

Tests use Node's built-in `node:test` runner (no Jest/Mocha). There is no separate lint script configured.

Server config via env vars: `HOST` (default `127.0.0.1`), `PORT` (default `3000`), `DB_PATH` (default `./data/tutor.sqlite`).

## Architecture

**Live, wired path** (what `npm run dev`/`npm start` actually serves):

- `server/index.ts` — entrypoint; creates the DB, seeds content, starts the HTTP server.
- `server/app.ts` — Express app; three routes (`POST /api/sessions`, `POST /api/sessions/:id/answers`, `POST /api/sessions/:id/skip`) plus `/health`. All errors funnel through one handler that returns `400 {error: 'invalid_request'}` — never leaks internal error messages to the client.
- `server/tutoring-service.ts` — the domain core (`TutoringService`). Owns session start/answer/skip, question selection, and mastery recalculation, all via `better-sqlite3` prepared statements and transactions. Public question objects never include `correct_answer` (see `toPublicQuestion`).
- `server/content-bank.ts` — the reviewed question bank, currently written out rather than generated (this is what the direction change above replaces). Twelve skills across three year groups, 21 enabled templates each spread over difficulties 1–3: Reception (`addition-within-5`, `counting-to-10`, `number-recognition`), Year 2 (`counting-in-steps`, `place-value-to-100`, `add-and-subtract`, `times-tables`, `fractions-of-amounts`) and Year 3 (`times-tables`, `place-value-to-1000`, `add-and-subtract`, `fractions-of-amounts`). Every skill declares a `yearGroup`, an `answerEntry` and the `datasetSkillIds` it was built from. Reception templates also carry a `visual` (countable dots, a number track, large numerals) for a child who can neither read the prompt nor hear it. Reception answers are whole numbers 0–10 so they can be tapped; Year 3 answers are whole numbers of any size, typed on a keypad — marking is an exact string match on a whole number either way. Fraction questions are framed to have whole-number answers so a child never types a remainder. Every prompt must read aloud cleanly. `seedInitialContent` upserts it but never re-enables a template an adult disabled. `tests/content-bank.test.ts` enforces the invariants; `tests/content-answer-keys.test.ts` independently re-derives all 252 answer keys from their prompt text — a prompt shape it cannot re-derive is a failure, not a skip, which is what stops the bank outgrowing its own verification.

- `server/curriculum.ts` — loads the 75-skill UK maths curriculum graph from `Modal_data/Maths/uk_math_ai_tutor_v1` and refuses to start on a duplicate id, a dangling prerequisite or a cycle. Supplies teaching order only, never an answer key.
- `server/misconceptions.ts` — pure `diagnose({prompt, correctAnswer, givenAnswer})`, 20 arithmetic patterns keyed to the generated prompt shapes. Runs *after* marking and can never change a mark. Two audiences: `childHelp` never contains the answer, `adultNote` uses teaching language.
- `server/spaced-review.ts` — review at 1/3/7/14/30 days, derived from the trailing run of correct answers rather than incremented, for the same reason mastery is a fold: a parent correction or retention prune must not desynchronise it.
- `web/` — no framework and no build step, served by `express.static`. `session-logic.js` is a DOM-free reducer unit-tested under Node (`tests/web-session-logic.test.ts`); `index.html` is the child screen (tap-then-confirm, keypad, `100dvh` so Send never falls below the fold, `speechSynthesis` output only — it never listens); `parent.html`/`parent.js` is the adult page.

**Year groups.** A child's `year_group` is recorded on first sight and changed only by an adult. Selection is confined to the child's own year group — `requireEnabledSkill` refuses another year's skill rather than quietly swapping it, and `tests/year-groups.test.ts` walks a whole sitting for each child to prove no cross-curriculum drift.
- `server/mastery.ts` — pure function `calculateMastery(gradedResults, previousLevel)`. No I/O; this is the place to reason about mastery-rule changes and is directly unit-tested.
- `server/database.ts` — opens SQLite, enables foreign keys, and runs an in-process migration runner against `db/migrations/*.sql`, tracked via a `schema_versions` table. Migrations are plain `.sql` files with a numeric-version header entry in the `migrations` array in this file — add new migrations there, not just as new files.

**AI slice** (`server/ai/`, live on the request path): `types.ts` is the provider-neutral contract from `architecture.md`; `gateway.ts` validates every model reply against a schema, retries once with a repair instruction, then serves a deterministic fallback, screening output and recording an event on every rejection; `providers/ollama.ts` and `providers/fake.ts` are the two providers; `hint-service.ts` is the only task wired. The gateway opens no database — `server/ai-stores.ts` backs its `CacheStore` and `SafetyEventSink` ports with SQLite. `TutoringService` depends on a narrow `HintPort`, never on this module, so the model can offer a nudge and can never return a mark, a score or a difficulty. `server/model-adapter.ts`, `server/cache.ts` and `server/session-controller.ts` were folded into this and deleted.

**Mastery rules** (`docs/mastery-rules.md`, enforced by `mastery.ts` + `tutoring-service.ts`):
- Levels: `new` → `learning` → `secure`, mapped to target difficulty 1/2/3.
- Promotion to `secure` requires ≥5 graded attempts, score ≥0.8, and the latest two graded attempts correct.
- An already-`secure` learner only demotes after two consecutive incorrect graded attempts (one wrong answer doesn't demote).
- Skipped questions are recorded (`attempts.outcome = 'skipped'`) but never count as graded evidence.
- Question selection: nearest-difficulty-to-target among reviewed (`reviewed=1`), enabled, unanswered-in-this-session templates **within the session's own skill**, tie-broken by the bank's `sequence` then template ID for reproducibility.
- A session is bound to one skill at start (`sessions.skill_id`, default `reception.addition-within-5`). Resuming keeps the original skill; mastery is per child+skill.

**Schema** (`db/migrations/create_tables.sql` plus `002`–`004`): `children`, `skills`, `content_templates` (versioned, `reviewed`/`enabled` gates, `sequence`, `source`/`licence`), `sessions` (tracks `skill_id`, `current_question_id`, `ended_reason`), `attempts` (one row per session+template, `outcome` in `answered`/`skipped`), `mastery` (one row per child+skill), `cache`, `safety_events`.

Tests (`tests/*.test.ts`, compiled to `dist/tests/`) exercise: the service layer directly against an in-memory DB (`session-flow.test.ts`), the HTTP layer end-to-end against a real listening server (`session-api.test.ts`), pure mastery math (`mastery.test.ts`), and migration upgrades against a pre-seeded v1 database (`database-migrations.test.ts`).

## Project plans

- `plan.md` — MVP scope, phasing (with per-item status checkboxes), risk register, and acceptance criteria.
- `development-plan.md` — day-by-day execution roadmap (30 two-hour sessions with exit checks), and the dated development log. **The log is the single source of truth for progress** — update it there, not in `plan.md`.
- `architecture.md` — authoritative for the AI gateway and the provider contract (`AiProvider.generateStructured()`). Note it describes the *target* layout (`server/ai/`, `server/domain/`, …); the code is still a flat `server/`, migrating opportunistically.

**Parent, privacy and access controls** (`docs/privacy-controls.md`, `docs/data-export.md`):
- `server/config.ts` validates configuration at boot and refuses to start a non-loopback bind without a 16+ character `ADMIN_SECRET`.
- `server/parent-service.ts` owns every adult operation: overview, export, deletion, corrections, per-child settings, retention and the privacy summary. It is wired into `createApp(tutor, { parent, config })`; parent routes are only registered when a `ParentService` is supplied.
- Parent routes live under `/api/parent`, authenticate an `x-admin-secret` header with `crypto.timingSafeEqual`, and return `401 {error:'unauthorized'}` before any database read so a rejected caller cannot learn whether a child exists.
- Corrections never overwrite `attempts.is_correct`; they set `corrected_is_correct` and append to `attempt_corrections`. Mastery is a fold over stored evidence, replayed from `new`, so a reversal restores the previous state exactly.
- Deletion and retention use explicit per-table statements scoped by `child_id` and never rely on `ON DELETE CASCADE`. Deletion deliberately keeps `skills`, `content_templates`, `cache` and `parent_settings`.
- `startSession` returns `status: 'active' | 'exhausted' | 'daily_limit'`; the last two are ordinary states answered `200`, not errors. A child may start one new session per local day by default (`children.daily_session_limit`), and resuming is never capped.

Read `plan.md`'s Safety and privacy section before touching anything related to LAN binding, data export/deletion, or model/content sourcing — those constraints (loopback-only by default, no audio persistence, adult-reviewed content only) are product requirements, not suggestions.
