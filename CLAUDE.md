# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first, adult-supervised tutoring app (Node + TypeScript + SQLite + Ollama). The current vertical slice is a deterministic Reception Maths session flow:

```
start session -> receive reviewed question -> submit typed answer
-> mark from answer key -> persist attempt/mastery -> receive next question
```

Ollama/the model is **not** responsible for marking correctness, mastery, promotion/demotion, or question difficulty — those are deterministic and rule-based (see `docs/mastery-rules.md`). Model-assisted hints/wording are a later, not-yet-wired slice.

## Commands

```bash
npm install
npm test        # runs `tsc` build then `node --test dist/tests/*.test.js`
npm run dev      # ts-node-dev on server/index.ts, live reload
npm run build    # tsc -> dist/
npm start        # node dist/server/index.js (run build first)
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
- `server/content-bank.ts` — the adult-reviewed question bank, written out rather than generated. Three Reception Maths skills (`addition-within-5`, `counting-to-10`, `number-recognition`), ≥20 enabled templates each across difficulties 1–3. Every answer is a whole number 0–10 so it can be tapped, and every prompt must read aloud cleanly. `seedInitialContent` upserts it but never re-enables a template an adult disabled. `tests/content-bank.test.ts` enforces these invariants.
- `server/mastery.ts` — pure function `calculateMastery(gradedResults, previousLevel)`. No I/O; this is the place to reason about mastery-rule changes and is directly unit-tested.
- `server/database.ts` — opens SQLite, enables foreign keys, and runs an in-process migration runner against `db/migrations/*.sql`, tracked via a `schema_versions` table. Migrations are plain `.sql` files with a numeric-version header entry in the `migrations` array in this file — add new migrations there, not just as new files.

**Scaffolded, not-yet-wired path** (model-assisted features, next slice): `server/model-adapter.ts` (Ollama HTTP client with timeout/retry), `server/cache.ts` (separate SQLite handle for prompt-hash caching), `server/session-controller.ts` (`generateQuestion` combining the two). None of these are imported by `app.ts`/`index.ts`/`TutoringService` yet — don't assume they're on the request path.

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

Read `plan.md`'s Safety and privacy section before touching anything related to LAN binding, data export/deletion, or model/content sourcing — those constraints (loopback-only by default, no audio persistence, adult-reviewed content only) are product requirements, not suggestions.
