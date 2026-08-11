# AI Family Tutor — Two-Hours-a-Day Development Plan

This roadmap converts `plan.md` into 30 focused development sessions. Each session is limited to two hours and ends with something that can be demonstrated or verified. The sequence assumes five sessions per week, but the sessions can be completed on any days.

## Desired outcome after 30 sessions (60 hours)

An adult can run a private, local Reception Maths tutoring session in a browser. The child receives reviewed questions read aloud locally, answers by selection rather than free typing, gets safe feedback, and progresses according to persisted mastery. Ollama can vary wording or produce hints, but deterministic answer keys remain responsible for marking. Invalid or unavailable model output produces a tested safe fallback. The parent can review/correct attempts, export data, and permanently delete a child's data.

The MVP is complete when:

- The app runs locally and binds to loopback by default.
- A Reception Maths session works from start to finish in the web UI.
- Each child completes a session without an adult operating the input device for them.
- Questions and marking use adult-reviewed templates and answer keys.
- Attempts, mastery, and the current question survive an application restart.
- Model output is schema-validated, safety-screened, cached, and never rendered raw.
- A fake adapter allows tests to run without Ollama.
- Parent correction, export, deletion, and retention controls work.
- A manual backup and restore procedure is documented and rehearsed.
- Critical automated tests and the MVP acceptance checklist in `plan.md` pass.

## Standard two-hour session

Use the same structure each day:

| Time | Activity |
|---|---|
| 0:00–0:10 | Review the previous result, choose today's single outcome, and confirm the working tree. |
| 0:10–1:30 | Implement the smallest complete vertical change. |
| 1:30–1:50 | Run tests, a build, and a manual smoke test appropriate to the change. |
| 1:50–2:00 | Record progress, known issues, and the exact starting point for the next session. |

If a task overruns, preserve a working state and move unfinished optional work to the next session. Do not sacrifice verification to start another feature.

## Week 1 — Establish a trustworthy foundation

### Day 1 — Runnable baseline

**Work:** Install and lock dependencies, correct the source entry point and TypeScript layout, add build/test scripts, and validate required configuration with safe local defaults.

**Achievable outcome:** The service builds and starts with a working `/health` endpoint.

**Exit check:** A clean dependency install followed by the build and health smoke test succeeds.

### Day 2 — Versioned database schema

**Work:** Replace the partial schema with ordered migrations covering schema version, children, skills, templates, sessions, attempts, mastery, cache, and safety/audit events. Add foreign keys and useful indexes.

**Achievable outcome:** A new SQLite database can be created reproducibly from migrations.

**Exit check:** Migration tests create the expected tables and running migrations twice is safe.

### Day 3 — Persistence repositories

**Work:** Add narrow repositories for children, sessions, attempts, templates, and mastery. Use temporary databases in tests and avoid exposing raw database calls to domain logic.

**Achievable outcome:** Core records can be created, read, and updated through typed persistence interfaces.

**Exit check:** Repository tests pass against a fresh temporary database.

### Day 4 — Reception Maths content baseline

**Work:** Define the first adult-reviewable skill map. Start with counting, number recognition, and addition within 5. Add versioned question templates, answer keys, difficulty, and review status. Build towards the target of at least twenty enabled templates per skill across difficulties 1–3, and record each template's source and licence.

**Achievable outcome:** The application has a deterministic question bank large enough that sessions end by the stopping rule rather than by exhaustion.

**Exit check:** Every enabled template has one unambiguous answer, a skill ID, version, review status, and a recorded source/licence; the enabled bank meets the size target.

### Day 5 — Mastery rules

**Work:** Document and implement initial evidence, promotion, demotion, skip, ambiguity, and parent-correction rules. Keep the algorithm simple and deterministic.

**Achievable outcome:** The same sequence of attempts always produces the same mastery state.

**Exit check:** Unit tests cover correct, incorrect, skipped, ambiguous, and corrected attempts plus boundary conditions.

**Week 1 desired outcome:** A tested foundation can store reviewed curriculum content and calculate mastery without using an AI model.

## Week 2 — Prove the deterministic tutoring loop

### Day 6 — Start and resume sessions

**Work:** Implement session creation, child/skill selection, active-session lookup, and completion. Keep child profile data minimal.

**Achievable outcome:** A test client can start, resume, and finish a persisted session.

**Exit check:** Session lifecycle tests pass, including an application restart simulation.

### Day 7 — Submit and mark answers

**Work:** Implement submitted-answer normalization, deterministic comparison to the answer key, attempt recording, and mastery update in one transaction.

**Achievable outcome:** A submitted Reception Maths answer is marked and persisted reliably.

**Exit check:** Duplicate submissions cannot create duplicate mastery changes; correct and incorrect answer tests pass.

### Day 8 — Select the next question

**Work:** Select questions using mastery level, enabled/reviewed status, the re-ask policy (never twice in one session, not within 24 hours), and a bounded difficulty step. Implement the session stopping rule — eight answered questions, ten minutes, the child stopping, or content exhaustion, whichever comes first — and make exhaustion an explicit parent-visible state rather than a silent end.

**Achievable outcome:** Each completed attempt produces a suitable next question, and sessions end deliberately.

**Exit check:** Selection tests prove that disabled, unreviewed, and overly difficult content is not chosen; stopping-rule tests cover each of the four end conditions using a fixed clock.

### Day 9 — Fake model adapter and hints

**Work:** Formalize a provider-neutral adapter interface and implement a scripted fake adapter. Add optional hint generation without allowing the model to mark answers.

**Achievable outcome:** Model-assisted behaviour can be tested deterministically without Ollama.

**Exit check:** Success, timeout, invalid-output, and unavailable-model scenarios are reproducible in tests.

### Day 10 — Backend end-to-end test

**Work:** Connect session start, question selection, answer submission, mastery update, hint fallback, and next-question selection through API endpoints.

**Achievable outcome:** The entire tutoring loop runs through the API.

**Exit check:** One automated end-to-end test completes at least three questions and verifies persisted attempts and mastery.

**Week 2 desired outcome:** The core Reception Maths loop is usable through the API and fully testable without Ollama.

## Week 3 — Add Ollama, structured output, cache, and safety

### Day 11 — Production-ready Ollama adapter

**Work:** Correct non-streaming response handling, normalize Ollama's `response` field, separate adapter options from model options, retain bounded timeout/retry behaviour, and add a health check.

**Achievable outcome:** A pinned local model can generate one hint through the shared adapter contract.

**Exit check:** Adapter contract tests pass and one live local smoke test is recorded when Ollama is available.

### Day 12 — Validated response contract

**Work:** Define versioned schemas for child-facing wording and hints. Parse JSON, reject extra actions/fields, retry once with a repair prompt, and return a deterministic fallback.

**Achievable outcome:** Invalid model text can never reach the child response.

**Exit check:** Tests cover valid JSON, malformed JSON, wrong types, unexpected actions, repair success, and fallback.

### Day 13 — Versioned cache

**Work:** Include provider/model version, prompt hash, model options, template version, schema version, curriculum version, and task in cache keys. Add expiry and explicit invalidation rules.

**Achievable outcome:** Safe repeated hint requests avoid unnecessary model calls without reusing stale content.

**Exit check:** Hit, miss, expiry, version-change, and corrupted-entry tests pass.

### Day 14 — Safety screening

**Work:** Add allow-listed child-view fields/actions and rule-based blocks for links, contact requests, personal-data prompts, unsafe language, and unsupported instructions. Record a redacted event and use a safe fallback.

**Achievable outcome:** Known unsafe outputs are blocked before rendering.

**Exit check:** A table-driven safety test suite passes with both blocked and allowed examples.

### Day 15 — Safe generation pipeline

**Work:** Connect cache, adapter, schema validation, repair, safety screening, fallback, and redacted audit metadata into one gateway used by the session controller.

**Achievable outcome:** All AI-assisted child content follows one tested safe path.

**Exit check:** End-to-end tests prove cache reuse, model failure fallback, invalid schema fallback, and safety blocking.

**Week 3 desired outcome:** Ollama can enhance deterministic tutoring, but model failure or unsafe output cannot break the session or reach the child.

## Week 4 — Deliver the local web experience

### Day 16 — Web application shell

**Work:** Add a minimal responsive local web page, API client, loading/error states, and clear separation between child and parent routes.

**Achievable outcome:** A browser can load the application and show service readiness.

**Exit check:** Production build works and the page is usable at narrow and desktop widths.

### Day 17 — Child session screen

**Work:** Add session start, question display, selection-based answer entry (tap or number pad), input validation, and next-question flow. Prevent accidental double submission. Free typing may be offered as an alternative for the older child, but must not be the only route.

**Achievable outcome:** A child can complete a multi-question session in the browser without typing.

**Exit check:** Manual smoke test completes three questions using touch alone, and a second run completes them using the keyboard alone.

### Day 18 — Feedback and hint experience

**Work:** Show concise correct/try-again feedback, provide a safe hint action, add local text-to-speech read-aloud for prompts and feedback, handle model fallback gracefully, and avoid displaying internal scores or raw errors. Confirm the chosen speech engine runs entirely on-device and records nothing.

**Achievable outcome:** The child receives understandable spoken and visual feedback without model or system details.

**Exit check:** Correct, incorrect, hint, read-aloud, timeout, fallback, and session-complete states are manually verified, and the speech engine's local-only behaviour is recorded.

### Day 19 — Parent overview

**Work:** Add a parent view of sessions, attempts, skill mastery, and safety/fallback events using non-identifying labels where possible.

**Achievable outcome:** An adult can understand recent learning activity and system fallbacks.

**Exit check:** The view matches stored records and exposes no prompt/model internals to the child route.

### Day 20 — UI integration and accessibility pass

**Work:** Add semantic labels, focus handling, readable contrast/type, child-friendly error copy, empty states, and browser-level tests for the critical path.

**Achievable outcome:** The first complete local browser experience is stable enough for adult review.

**Exit check:** The browser critical-path test passes and a keyboard-only manual run is successful.

**Week 4 desired outcome:** An adult-supervised child can complete Reception Maths sessions through a usable local web interface.

## Week 5 — Parent control, privacy, and local access

### Day 21 — Parent corrections

**Work:** Allow an adult to correct an evaluation with a reason. Recalculate mastery deterministically and retain the original result in the audit trail.

**Achievable outcome:** Parent corrections immediately and transparently affect mastery.

**Exit check:** Correction and reversal tests prove that mastery and audit history remain consistent.

### Day 22 — Data export

**Work:** Export a child's profile, sessions, attempts, mastery, corrections, and relevant safety events in a documented local JSON format.

**Achievable outcome:** A parent can inspect and save a complete copy of the child's stored learning data.

**Exit check:** Export contents match the database and exclude cache contents, secrets, and unnecessary logs.

### Day 23 — Permanent deletion

**Work:** Implement confirmed deletion of the child's sessions, attempts, mastery, corrections, and relevant derived records. Define whether shared curriculum/cache records remain.

**Achievable outcome:** A parent can permanently remove a child's stored data.

**Exit check:** Deletion tests verify all in-scope records are gone and unrelated child/content records remain. A multi-child isolation test proves that one child's session, export, and deletion never read or affect the other's data.

### Day 24 — Retention and privacy controls

**Work:** Add configurable retention for completed sessions/audit events, cache clearing, and a parent-visible privacy summary. Confirm that free text and audio are not unnecessarily stored.

**Achievable outcome:** Local data has understandable retention and clearing behaviour.

**Exit check:** Retention tests use a fixed clock and prove only expired in-scope records are removed.

### Day 25 — Network and parent access controls

**Work:** Enforce loopback binding by default. Require an admin secret/session for parent endpoints and for any explicit LAN mode. Document the trusted-home-network assumption.

**Achievable outcome:** The default installation is local-only and parent operations are protected.

**Exit check:** Tests prove parent endpoints reject unauthenticated access and LAN startup fails without required protection.

**Week 5 desired outcome:** Parents can review, correct, export, retain, and delete local learning data with appropriate access controls.

## Week 6 — Benchmark, review, and release the MVP

### Day 26 — Reliability regression suite

**Work:** Close gaps in migration, repository, transaction, configuration, cache, and restart tests. Add temporary-directory isolation and deterministic clocks/randomness where needed.

**Achievable outcome:** Core tests run repeatedly without depending on Ollama or existing local data.

**Exit check:** Clean install, build, and full automated test suite pass twice consecutively.

### Day 27 — Local model benchmark and registry

**Work:** Record the exact model name/digest, quantization, options, hardware, warm/cold latency, failure rate, and memory observations. Confirm low-temperature settings and context limits. Measure against the `plan.md` latency budget: two seconds question-to-next-question on the deterministic path, five seconds when a hint is generated.

**Achievable outcome:** The selected flash model has a reproducible local performance baseline and a pass/fail against the budget.

**Exit check:** Benchmark output and model registry are saved without child data and include an accept/reject decision justified by the latency budget.

### Day 28 — Acceptance and privacy review

**Work:** Walk every MVP acceptance criterion, threat-model assumption, safety fallback, data field, bind address, and parent operation. Record failures as release-blocking or follow-up work.

**Achievable outcome:** The project has an evidence-based release checklist rather than an informal readiness claim.

**Exit check:** Every acceptance criterion has a pass/fail result and reproduction instructions.

### Day 29 — Adult content review and defect fixes

**Work:** Review every enabled question, answer, hint fallback, and child-facing message. Fix the highest-priority acceptance, safety, accessibility, or content issues found on Day 28.

**Achievable outcome:** All enabled initial content is explicitly adult-reviewed and major release blockers are resolved.

**Exit check:** No unreviewed template is selectable and all release-blocking tests pass.

### Day 30 — MVP release candidate

**Work:** Finalize setup, run, test, backup, export, deletion, and troubleshooting documentation. Run a clean-device-style setup and a complete adult-supervised demonstration.

**Achievable outcome:** A repeatable local MVP release candidate is ready for cautious family testing.

**Exit check:** Starting from documented prerequisites, an adult can install, run, complete a session, inspect/correct data, export it, and delete it. The backup procedure is rehearsed end to end, including a restore into a clean location, before any child uses the system.

**Week 6 desired outcome:** A reviewed, documented, and tested local MVP release candidate satisfies the acceptance criteria in `plan.md`.

## Progress tracking

### Development log

```text
Date: 2026-08-06
Session/day: Initial vertical slice (Days 1–2 foundation plus thin Days 4–10 path)
Outcome completed: Reception Maths start -> answer -> deterministic mark -> persisted attempt/mastery -> next question, available through HTTP.
Verification run: npm test — 6 tests passed; TypeScript build passed.
Decisions made: Use Node's built-in test runner; require Node >=22; keep answer keys private and keep Ollama out of deterministic marking.
Known issues: Mastery is currently a simple lifetime correct ratio; promotion/demotion, skips, parent corrections, schema-safe model output, and UI remain future slices.
Next starting action: Define mastery thresholds test-first and use them in next-question difficulty selection.
```

```text
Date: 2026-08-10
Session/day: Mastery-driven selection vertical slice (Day 5 plus the relevant Day 8 behavior)
Outcome completed: Versioned new/learning/secure mastery rules, recorded skips, safe v1-to-v2 database migration, expanded reviewed question difficulties, and mastery-driven selection through domain and HTTP layers.
Verification run: npm test — 14 tests passed; TypeScript build passed.
Decisions made: Secure requires 5 graded attempts, >=80% correct, and 2 latest correct; secure demotes after 2 consecutive incorrect; skips are stored but ungraded; difficulty targets are 1/2/3 for new/learning/secure.
Known issues: Session resume/completion endpoints, parent corrections, ambiguous outcomes, schema-safe model output, and UI remain future slices.
Next starting action: Implement persisted session resume and explicit completion behavior test-first.
```

```text
Date: 2026-08-10 (second session)
Session/day: Planning correction and first full commit of the codebase
Outcome completed: Reviewed plan.md against the implemented code and resolved the contradictions between plan.md, development-plan.md and architecture.md. Narrowed the MVP to Reception Maths only, replaced typed answers with selection-based entry plus local read-aloud, defined the content model (bank size, re-ask policy, stopping rule, daily cap), added a pilot exit bar and a risk register, and gave every acceptance criterion a verification method. Added CLAUDE.md. Committed and pushed the entire implementation, tests, docs and diagrams to origin/main in four focused commits (f10a25e, 6463551, 2f066ea, 3a43abc).
Verification run: npm test — 14 tests passed; TypeScript build passed. No code was changed this session, only documentation.
Decisions made: MVP is Reception Maths only; Year 3 and English are post-pilot. Answer entry is selection-based because Reception is ages 4-5 and a typed-answer MVP may be unusable by its target user; read-aloud (output) is MVP while speech recognition (input) stays deferred. Target at least 20 reviewed templates per skill. Sessions stop at 8 questions, 10 minutes, child choice or exhaustion. Latency budget is 2s deterministic and 5s with a hint. architecture.md is authoritative for the provider contract, so server/model-adapter.ts migrates behind the gateway rather than being extended. Progress is tracked in this log only; the PROGRESS line in plan.md was removed.
Known issues: Content bank holds 7 templates against a target of 20. Startup config validation covers only PORT. No fake model adapter yet. No admin auth or parent endpoints. No web UI. Session resume and explicit completion are still unimplemented. A stray empty file named 'src' sits in the repo root, untracked and unused.
Next starting action: Implement persisted session resume and explicit completion test-first — begin with a failing test in tests/session-flow.test.ts that starts a session, answers one question, reopens the database from the same file, and asserts the current question and mastery survive.
```

```text
Date: 2026-08-10 (third session)
Session/day: Day 6 session resume and completion, plus an unplanned child-UI spike
Outcome completed: (1) Session resume and explicit completion. startSession now resumes a child's open session instead of always creating a new one, and returns `resumed` plus current mastery. Added completeSession with answered/skipped counts, getSession for state lookup, GET /api/sessions/:id and POST /api/sessions/:id/complete. Content exhaustion now records ended_reason 'exhausted' and surfaces a `status` field, so a session no longer ends silently. Migration 3 adds sessions.ended_reason, backfills already-ended sessions to 'exhausted', and indexes the active-session lookup. Closes MVP acceptance criterion 4. (2) A throwaway child UI spike in web/index.html, served by express.static, to test whether a Reception-age child can operate the app at all.
Verification run: npm test — 29 tests passed (was 14); TypeScript build passed. Manual smoke test against the running dev server confirmed the root serves the UI and a session starts over HTTP. Commits 1a2057d and d9123db pushed to origin/main.
Decisions made: A child may have only one open session at a time; startSession is therefore safe to call repeatedly and is the resume path. Explicit completion is the "child chooses to stop" arm of the stopping rule only — the 8-question and 10-minute caps remain Day 8 and need a fixed clock. submitAnswer now shares getActiveSession and moveSessionToQuestion with skipQuestion rather than duplicating them. The UI spike taps numbers rather than typing, uses 88px minimum targets, and speaks prompts via speechSynthesis; speech output is treated as safe because it never listens, unlike the still-deferred speech recognition.
Known issues: OPEN QUESTION, decide before building the real UI — the API marks an answer and advances in one transaction, so there is no retry. A mistap by a four-year-old is recorded as genuine mastery evidence and the question is taken away. Consider retry-before-marking. Also outstanding: content bank holds 7 templates against a target of 20; no fake model adapter; startup config validation covers only PORT; no admin auth or parent endpoints; no Ollama integration; whether speechSynthesis uses an on-device voice is unconfirmed; web/index.html is spike-grade and expected to be thrown away. A stray empty file named 'src' still sits untracked in the repo root.
Next starting action: Sit both children in front of http://127.0.0.1:3000 and watch four things — do they hit the intended number, does the spoken prompt land or do they ignore it, what do they do after a wrong answer, and do they find Skip unaided. Record what happens in this log before writing any more UI code. If they struggle to both read and hear the prompt, the finding is bigger than the UI and reshapes the content format towards pictures over text.
```

```text
Date: 2026-08-11
Session/day: Day 4 content bank and skill binding
Outcome completed: Replaced the seven-template placeholder with three Reception Maths skills of at least twenty adult-reviewed templates each across difficulties 1-3, every answer a whole number 0-10 so it can be tapped, and every prompt constrained to characters that read aloud cleanly. Added source, licence and teaching `sequence` provenance (migration 4), used sequence as the selection tie-break, and bound each session to one skill at start so selection cannot drift across skills mid-session. Added GET /api/skills.
Verification run: npm test — 44 tests passed (was 29); TypeScript build passed. Commit 4490349 pushed to origin/main.
Decisions made: Reseeding refreshes wording, difficulty, ordering and provenance but never re-enables a template an adult disabled. Resuming keeps the original skill; mastery stays per child+skill. Content-bank invariants (bank size, difficulty spread, tappable answers, read-aloud-safe prompts) are enforced by tests rather than by review discipline.
Known issues: The child-observation session planned as the previous entry's next action was not run; it was deferred in favour of this content work and is now scheduled after the MVP completes. The mistap/retry open question is therefore still open. Also outstanding: stopping rule beyond exhaustion, re-ask window, fake model adapter, Ollama on the request path, parent endpoints, admin auth, real UI. A stray empty file named 'src' still sits untracked in the repo root.
Next starting action: Complete the remaining MVP slices, then observe both children using the finished product.
```

```text
Date: 2026-08-11 (parent controls)
Session/day: Days 19 and 21-25 — parent overview, corrections, export, deletion, retention, network and access controls
Outcome completed: (1) Day 21 parent corrections. An adult can correct an evaluation with a reason; the correction is stored alongside the child's own result (attempts.corrected_is_correct) rather than over it, every correction and reversal appends to an append-only attempt_corrections trail, and mastery recalculates immediately. Mastery is now a fold over the stored evidence replayed from `new`, which is what makes reversal restore the previous state exactly. (2) Day 22 data export: a documented per-child JSON export excluding cache contents, secrets and answer keys — docs/data-export.md. (3) Day 23 permanent deletion: confirmed, transactional, explicit per-table statements scoped by child_id, with a multi-child isolation test closing MVP acceptance criterion 5. (4) Day 24 retention and privacy: parent-set retention for ended sessions and safety events, cache clearing, and a parent-visible privacy summary; retention tests use a fixed clock and check both sides of the boundary. (5) Day 25 network and access controls: server/config.ts now refuses to start a non-loopback bind without a 16+ character ADMIN_SECRET, parent routes authenticate an x-admin-secret header with crypto.timingSafeEqual, and unauthenticated access returns 401 before any database read so it cannot reveal whether a child exists. (6) Day 19 parent overview data plus a plain web/parent.html + parent.js page over the whole parent API. (7) The daily session cap from plan.md, enforced in startSession and adjustable per child. (8) startSession no longer throws when nothing is selectable: POST /api/sessions answers 200 with status 'exhausted' or 'daily_limit' and child-facing wording. Migration 7 adds children.daily_session_limit, attempts.corrected_is_correct, attempt_corrections and parent_settings.
Verification run: npm test — 161 tests passed (was 118); TypeScript build passed.
Decisions made: Mastery is recalculated as a pure fold over stored evidence rather than nudged from the previous level, so corrections, reversals and retention pruning can never leave a level the evidence does not support. Retention defaults to 0 = keep indefinitely and runs only when a parent asks; a destructive job firing on startup is the wrong default for family data. Deletion keeps skills, content_templates, cache and parent_settings — shared, non-personal records that are not the child's data — and never relies on ON DELETE CASCADE after what migration 005 showed. The daily cap counts new sessions per child per calendar day in local time and never blocks resuming a session already in progress. LAN mode requires a 16-character minimum secret because the only barrier on a home network is guess resistance.
Known issues: The parent page is deliberately plain and has had no accessibility pass. Retention has no scheduler, so an adult has to press the button. The daily cap counts sessions per child across all skills, so a child wanting counting and addition on the same day needs the limit raised — worth revisiting once the pilot shows how families actually use it. The mistap/retry open question from the Day 6 entry is still open.
Next starting action: Day 20 accessibility pass across both UIs, then Day 26 reliability regression suite.
```

```text
Date: 2026-08-11 (second session)
Session/day: Days 8, 9, 16-20, 19, 21-30 — the remainder of the MVP, built by four parallel agents in isolated worktrees
Outcome completed: (1) Day 8 stopping rule (8 answered / 10 minutes / child stops / exhaustion) with an injectable clock, plus the 24-hour re-ask window per child across sessions. (2) Day 9 provider-neutral AI gateway, scriptable fake provider, Ollama migrated behind the contract, schema validation with one repair retry then deterministic fallback, and table-driven safety screening. (3) The gateway wired onto the live request path behind a narrow HintPort, with SQLite cache and safety-event stores (migration 6). (4) Days 16-20 child UI: full rewrite with a DOM-free state machine, tap-then-confirm answer entry, on-device read-aloud, warm endings for every status, and an accessibility pass. (5) Days 19 and 21-25 parent controls: corrections with an append-only audit trail and exact reversal, export, permanent deletion, retention on a fixed clock, cache clearing, privacy summary, admin-secret auth, LAN startup refusal, daily session cap (migration 7). (6) Day 26 reliability, Day 27 benchmark, Day 28 acceptance record, Day 29 answer-key verification, Day 30 backup rehearsal and documentation.
Verification run: npm test — 210 tests passed (was 44), green twice consecutively after a clean npm install. Benchmark on M4 Pro with qwen2.5:7b: deterministic path 0.53ms p95 against a 2000ms budget, hint path 582ms warm and 3788ms cold against 5000ms, zero failures — decision accept. Backup and restore rehearsed end to end: live database deleted, restored from backup, child resumed on the same question with the attempt intact. Live HTTP smoke tests confirmed the hint path against real Ollama, the daily cap returning 200 daily_limit, and LAN startup refusing to boot without ADMIN_SECRET.
Decisions made: The model's only structural power is a hint string — it cannot mark, score, set difficulty or trigger a UI action. Selecting an answer is reversible and only a separate confirm submits, so a mistap is never recorded as evidence. Mastery is now a fold replayed from 'new' over stored evidence rather than nudged from the stored level, which is what makes correction reversal exact and retention safe. Deletion removes everything scoped to the child but keeps shared curriculum, cache and household settings. The daily cap is per child across all skills. Ollama keep_alive defaults to 30m because cold start used 76% of the hint budget. No new npm dependencies: schema validation is hand-rolled rather than Zod, and the UI has no framework or build step.
Known issues: RELEASE-BLOCKING, both needing an adult rather than more code — (a) no browser was available in this environment, so nothing visual has been confirmed: rendering, focus rings, touch-target sizes and actual spoken audio are unverified; (b) every template is machine-verified (all 63 answer keys independently re-derived from their prompts) but not adult-reviewed — reviewed=1 is set by the seed, not by a person. Also: on loopback with no ADMIN_SECRET the parent page is open to anyone using the Mac, so set ADMIN_SECRET even locally; the daily cap spanning all skills may be too strict once a second skill is in use; backups are unencrypted by design until Phase 3. A worktree node_modules symlink was committed by a merge and replaced the real dependency tree with a self-referential link — .gitignore now matches symlinks as well as directories.
Next starting action: Sit both children in front of http://127.0.0.1:3000 and watch four things — do they hit the intended number, does the spoken prompt land or do they ignore it, what do they do after a wrong answer, and do they find the skip unaided. Record what happens here before writing any more UI code. Do the visual browser pass and the content read-through first, since both are release-blocking.
```

```text
Date: 2026-08-11 (third session)
Session/day: First child observation — the assumption everything rests on
Outcome completed: A four-year-old used the finished UI. Adult's report: "felt really fun and easy access." This is the first real evidence for the risk rated high likelihood / high impact in plan.md — that a Reception child cannot use the interface unaided — and it points the right way. Tap-then-confirm answer entry and spoken prompts did not obstruct a four-year-old.
Verification run: Observation only, no code changed. Reported by the supervising adult rather than recorded against the four specific questions (did they hit the intended number, did the spoken prompt land, what happened after a wrong answer, did they find skip unaided), so it is an encouraging signal rather than a measurement.
Decisions made: None yet. The mistap open question stays open until a wrong answer has actually been observed — "fun and easy" does not tell us what happens when the child gets one wrong, which is the moment the design was most uncertain about.
Known issues: Acceptance criterion 2 requires a child to complete a session with no adult operating the input device, and the pilot exit bar requires ten completed sessions with at least three per child plus a written adult judgement. Neither is met by one happy sitting. The visual browser pass and the adult content read-through remain release-blocking.
Next starting action: Watch a second sitting for the specifics — especially what the child does after a wrong answer, and whether they find the skip unaided. Record the answers here.
```

```text
Date: 2026-08-11 (fourth session)
Session/day: Year 3 curriculum added alongside Reception, at the owner's decision
Outcome completed: The app now serves two curricula. Added four Year 3 maths skills to the reviewed bank (times tables 3/4/8, place value to 1000, adding and subtracting to 1000, fractions of amounts), 21 templates each across difficulties 1-3, taking the bank from 63 to 147 templates. Skills and children now carry a year group (migration 8), selection is confined to the child's own year group, and requireEnabledSkill refuses another year's skill rather than quietly swapping it. Skills also declare how they are answered: Reception taps a number from a 0-10 row, Year 3 types on a keypad. Added the keypad to the child UI with the same select-then-confirm rule, a rub-out key, a large readout of the answer being typed, keyboard parity and a leading-zero guard. The child picker now maps Fox to Reception and Panda to Year 3.
Verification run: npm test — 224 tests passed (was 210). All 147 answer keys are independently re-derived from their prompt text by tests/content-answer-keys.test.ts, which was extended with six Year 3 prompt shapes and now also rejects a negative subtraction answer or a fraction that does not divide wholly. Live HTTP check confirmed the Year 3 child starts on year3.times-tables with keypad entry and the Reception child on reception.addition-within-5 with tap entry.
Decisions made: Year 3 was Phase 2 in plan.md, gated behind the pilot exit bar; the gate was moved deliberately because the older child starts Year 3 in September. English comprehension stays out of scope. All answers remain whole numbers so deterministic marking is unchanged — fraction questions are framed to give whole-number answers ("one quarter of 20") so a child never types a remainder and the marker never has to decide whether 0.25 is the same answer. A child's year group is recorded on first sight and cannot be changed by whatever the browser last sent, or a stale tab would move a child's curriculum. The migration test now derives its expected version list from the exported migrations array rather than a hardcoded list that broke on every new migration.
Known issues: The Year 3 content is machine-verified but not adult-reviewed — the same gap as Reception, and now across 147 templates rather than 63. Nothing visual has been confirmed for the keypad: no browser was available, so the readout size, rub-out placement and keypad layout are unchecked. The daily session cap is per child across all skills, which matters more now there are four Year 3 skills to move between. Mastery promotes to difficulty 2 after a single correct answer, which is visible in Year 3 as an immediate jump from 3x1 to 4x2 and may feel abrupt for an eight-year-old.
Next starting action: Sit the eight-year-old in front of Panda and watch the keypad specifically — is the typed answer readable, is rub-out discoverable, and does the jump in difficulty after one correct answer feel right. Then have an adult read the 84 new Year 3 prompts.
```

At the end of each session, add a short entry using this format:

```text
Date:
Session/day:
Outcome completed:
Verification run:
Decisions made:
Known issues:
Next starting action:
```

Use these status labels:

- **Complete:** Exit check passed.
- **Partial:** A working subset exists, but the exit check did not pass.
- **Blocked:** Progress requires a specific external decision or dependency.
- **Deferred:** Intentionally moved outside the MVP.

## Scope protection

Keep these items outside this 60-hour MVP unless all earlier exit checks are complete:

- Year 3 content and English comprehension
- Speech recognition for answers. Local read-aloud of prompts and feedback is in scope on Day 18; only voice *input* is deferred.
- Science and VR experiences
- Cloud model providers, cloud synchronization, or a pro-model escalation route
- Autonomous tutoring or background tasks
- Advanced analytics and encrypted backup automation

After Day 30, run the two-week pilot and check it against the pilot exit bar in `plan.md`. Year 3 and English are a separate milestone, planned only once that bar passes.
