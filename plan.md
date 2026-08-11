# AI Family Tutor — Implementation Plan (Local-first, Ollama)

Owner: Angu  
Scope: Private, adult-supervised family MVP for two children

Status: The MVP build is complete — deterministic loop, mastery rules, stopping and re-ask rules, AI gateway with safe hints, child UI, and parent control/privacy/access controls. Two release blockers remain and both need an adult rather than more code: a visual browser pass and an adult read-through of the enabled content. See `docs/acceptance.md`. The authoritative, dated progress record is the development log in [`development-plan.md`](development-plan.md#development-log). Update that log rather than duplicating status here.

## Related documents

- [`architecture.md`](architecture.md) — authoritative for the AI gateway, the provider contract and the target code layout.
- [`development-plan.md`](development-plan.md) — day-by-day execution roadmap, exit checks and the development log.
- [`docs/mastery-rules.md`](docs/mastery-rules.md) — authoritative for mastery evidence, promotion, demotion and skips.

Where this plan disagrees with those documents on their own subject, they win. This plan owns scope, phasing, risk and acceptance.

## Goal

Build an AI Family Tutor as a local-first system using Ollama. **The MVP covers Reception Maths only.** It keeps data on the family device, uses measured model routing and caching, and allows model swaps through a single adapter. Year 3 and English comprehension are the next milestone after a successful Reception pilot; they are not MVP scope.

## Non-goals for the MVP

- No child accounts, social features, web search, cloud sync, or autonomous background tutoring. "No child accounts" means no logins, credentials or per-child authentication; per-child profiles, mastery records and parent-controlled data management do exist.
- No Year 3, English, VR, Science or additional subjects until the Reception Maths loop passes the pilot exit bar below.
- No cloud or pro-model route. Escalation requires a defined ambiguity trigger, which depends on the ambiguous-answer outcome that `docs/mastery-rules.md` defers beyond version 1.
- It supports an adult-supervised home setting; it is not a substitute for teaching, formal assessment, or safeguarding advice.

### Pilot exit bar

"Demonstrably safe and useful" means all of the following hold across a two-week pilot with both children:

- At least ten completed sessions in total, with at least three per child.
- No unsafe or unvalidated model output reached the child view, measured from recorded safety events.
- No data-loss incident, and at least one successful restore-from-backup rehearsal.
- Each child completed a session without an adult operating the input device on their behalf.
- The supervising adult recorded a written judgement that the sessions were useful.

Subject expansion is blocked until every item passes.

## Proposed approach

- Ollama runs locally on the Mac Mini, using Apple-Silicon-suitable quantized models.
- A Node + TypeScript tutoring engine reaches Ollama only through the provider-neutral AI gateway defined in `architecture.md`. The engine never calls a provider directly.
- Use one measured local flash model. Cloud and pro-model routes stay disabled for the MVP.
- Store persistent data in local SQLite: child profiles, mastery, attempts, templates, caches and safety events.
- Build a local web UI. Answer entry is selection-based rather than free typing, and prompts can be read aloud locally; see "Child input and output".
- Use strict context limits, deterministic evaluation and versioned caching to minimise compute.

## Child input and output

Reception is ages four to five. Most children in scope cannot yet read a written prompt fluently or find keys on a keyboard, so input modality is a viability requirement rather than a polish item. Voice is not one decision: input and output carry different privacy risks and belong in different phases.

- **Answer entry (MVP).** Tap or number-pad selection of an answer, not free typing. It is deterministic, needs no model, and removes literacy and motor-skill barriers. Free typing may be offered as an alternative for the older child.
- **Prompt read-aloud (MVP).** Local text-to-speech for question prompts and feedback. Speaking text neither records nor transmits audio, so the speech-recognition concern below does not apply to it. Confirm the chosen engine runs entirely locally before enabling it.
- **Speech recognition for answers (deferred).** The browser Web Speech API is not inherently local; some implementations send audio to a provider. Verify the selected browser's behaviour, or use an explicitly local speech-to-text engine, before considering it. Do not persist audio by default.

Exit condition: each child completes a session without an adult operating the input device for them.

## Content model and session shape

- **Bank size.** Target at least twenty enabled, adult-reviewed templates per skill, spread across difficulties one to three. Rationale: `secure` requires five graded attempts and a session never repeats a question, so a bank smaller than roughly four times the promotion threshold ends sessions by exhaustion rather than by design.
- **Re-ask policy.** A template may reappear in a later session but never twice within one session, and not within twenty-four hours of its last appearance. Mastery evidence accumulates across a child's lifetime, so the question pool must recycle even though the evidence does not reset.
- **Session stopping rule.** A session ends at whichever comes first: eight answered questions, ten minutes elapsed, the child choosing to stop, or content exhaustion. Content exhaustion is an explicit, parent-visible state, not a silent end.
- **Session cap.** At most one session per child per day by default, adjustable by the parent. This is a wellbeing control for a four-to-five-year-old, not a technical limit.
- **Content provenance.** Record the source and licence of every template. Material adapted from a published scheme of work must be attributed and its reuse checked before it is enabled.

## Phases

### Phase 0 — Environment, content baseline and scaffolding *(complete)*

- [x] Install Ollama; download a flash model and record its exact name/digest, quantization, options, hardware, latency and memory benchmark in a local model registry. *`qwen2.5:7b` Q4_K_M; see `docs/model-registry.json` and `npm run benchmark`.*
- [x] Define a small, adult-reviewed Reception Maths skill map, question templates, answer keys and mastery thresholds. *Three skills, 21 templates each; all 63 answer keys machine-verified. Adult sign-off still outstanding.*
- [x] Scaffold the Node/TypeScript service and SQLite persistence with clean domain, persistence and HTTP boundaries.
- [x] Add and validate configuration at startup: `OLLAMA_URL`, `FLASH_MODEL`, bind address and admin secret.
- [x] Bind to loopback by default, with LAN mode refusing to start without an admin secret and the trusted-home-network assumption documented in the README.
- [x] Define versioned SQLite migrations for child profile, skill/mastery, session/attempt, content template, cache, safety event and schema version.
- [x] Establish a fake-model adapter and test harness so core tutoring behaviour is testable without Ollama.

### Phase 1 — Prove the loop (Reception Maths) *(complete pending adult review and the pilot)*

- [x] Implement the minimal deterministic loop: choose a curated question -> child answers -> evaluate -> update mastery -> choose the next suitable item.
- [x] Use deterministic templates and answer keys for core arithmetic. The model may vary wording or provide hints, but is never the source of correctness.
- [x] Define mastery behaviour before coding. Recorded in `docs/mastery-rules.md`. Confidence bounds, evidence decay and ambiguous-answer handling are explicitly deferred beyond version 1 and are not Phase 1 work.
- [x] Persist session resume and explicit completion so the current question and mastery survive an application restart.
- [x] Grow the reviewed content bank to the target size and implement the re-ask and stopping rules.
- [x] Implement selection-based answer entry and local read-aloud. *Tap-then-confirm, so a mistap is never recorded as evidence.*
- [x] Implement the Ollama adapter behind the gateway contract, and SQLite caching.
- [x] Require a versioned JSON response schema for every model output. Reject invalid output, retry once with a repair prompt, then use a safe template fallback; never render raw model text.
- [x] Allow-list UI actions and content fields; screen outputs for unsafe content, links, contact requests and personal-data prompts before display. *The model's only output is a hint string; it cannot trigger a UI action.*
- [x] Record a minimal audit trail: template/version, model/version, safety decision and mastery change. Do not store audio or unnecessary free text.
- [x] Document a manual backup and restore procedure and rehearse it before any child uses the system. *Rehearsed 2026-08-11; see `docs/backup-restore.md`.*

### Phase 2 — Year 3 and English *(not started; gated on the pilot exit bar)*

- Add adult-reviewed curriculum templates and answer keys for Year 3 and English comprehension.
- Add an adult review/correction flow for evaluations; corrections immediately update mastery and remain auditable.
- Define the ambiguous-answer outcome, then add scheduled pro-model re-evaluation only for those explicit cases. It must return the same validated schema and cannot change mastery without a recorded rationale.

### Phase 3 — Extend deliberately *(not started)*

- Add Science templates while retaining the same content-review, validation and safety controls.
- Add richer local analytics and opt-in encrypted backups.

## Prompt and context engineering

- Use structured prompts: system instructions, task and JSON output schema.
- Store concise local templates by ID; avoid large few-shot contexts.
- Keep a concise per-child learning profile (age, reading level and motivation only). Do not put names, birthdays, school details or other identifiers in prompts.
- Version prompts, schemas and scoring rules so past decisions can be reproduced.

## Caching and compute controls

- Cache outputs by model/version, prompt hash, options, template/schema version and relevant curriculum version.
- Define expiry and invalidation rules so content, safety or pedagogy changes cannot reuse stale output.
- Limit context to the learning profile, last three turns and a one- or two-sentence mastery summary.
- Use low temperature for evaluation and benchmark before enabling any escalation route.

## Safety and privacy

- Keep SQLite local; cloud storage is off by default.
- Treat speech input and speech output separately, as set out in "Child input and output". Do not persist audio by default.
- Provide an admin/parent data screen to view, export and permanently delete a child's data, clear caches/sessions and set a retention period. Deletion includes derived mastery and audit records as appropriate.
- Use rule-based screening, with an optional local classifier, plus a parent-visible safe fallback for blocked output.
- Document a manual backup and restore procedure in Phase 1; device loss otherwise destroys all progress before automated encrypted backups arrive in Phase 3. Encrypt backups rather than the active database by default, and document the local-device, OS-account and physical-access threat model.
- Treat model files and prompt/template updates as supply-chain inputs: obtain them from trusted sources, pin versions and require adult review for local content changes.

## Developer ergonomics and quality

- Depend on the provider-neutral `AiProvider.generateStructured()` contract defined in `architecture.md`. The existing `server/model-adapter.ts` predates that decision and is to be migrated behind the gateway rather than extended.
- Keep model names and routing rules configuration-driven; the router selects a model class, not a vendor or model name.
- Add benchmark scripts for latency and memory per model.
- Use structured local logs with no child-identifying data; surface model failures, schema fallbacks and safety blocks to the parent/admin.
- Automate tests for mastery transitions, cache invalidation, schema rejection/fallback, safety rules, migrations, restart persistence and the end-to-end fake-adapter session loop.

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| A Reception child cannot use the interface unaided | High | High | Selection-based answer entry and local read-aloud in Phase 1; observe both children early | Any smoke test needs an adult to operate the input device |
| Question bank exhausted, sessions end abruptly | High | Medium | Bank size target, re-ask policy, explicit parent-visible exhaustion state | Any session ends before the stopping rule fires |
| Child disengages or is frustrated | Medium | High | Session cap and stopping rule, skip always available, bounded difficulty steps | Repeated skips or refusal to start a session |
| Device loss or file corruption destroys all progress | Medium | High | Documented manual backup and rehearsed restore in Phase 1; encrypted automated backups in Phase 3 | Before first child use |
| Ollama unavailable or slow mid-session | Medium | Medium | Deterministic path completes without the model; hints are optional and fall back safely | Benchmark exceeds the latency budget |
| Model emits unsafe or invalid content | Medium | High | Schema validation, single repair retry, safety screening, deterministic fallback, never render raw text | Any safety event that reached the child view |
| A reviewed answer key is subtly wrong | Medium | High | Adult review before enabling; unreviewed templates are never selectable | Any incorrect answer key found in use |
| Scope creep into Year 3, English or voice input | High | Medium | Pilot exit bar above and scope protection in `development-plan.md` | Work starts on a listed non-goal |

## Trade-offs

- Local models have less capability than leading cloud models. Curated templates, answer-key checks and adult correction are the primary quality guardrails; escalation is a measured, narrow, post-MVP option rather than an automatic default.
- Local storage protects privacy but makes device loss a risk; encrypted, opt-in backups address recovery without changing the default.
- Generated educational content can be subtly wrong, so initial content must be reviewed and the model must not be the sole evaluator for core skills.
- Selection-based answer entry limits the question types that can be asked, but a typed-answer MVP that the target child cannot operate is worth less than a narrower one they can.

## Acceptance criteria (MVP)

Every criterion needs a recorded pass/fail result and reproduction instructions by Day 28.

| # | Criterion | Verification |
|---|---|---|
| 1 | An adult can run an end-to-end Reception Maths session locally using the flash model and the defined initial skill set | Scripted manual run, recorded on Day 30 |
| 2 | Each child completes a session without an adult operating the input device for them | Observed run per child, Days 29–30 |
| 3 | The app selects the next item from persisted mastery, updates follow `docs/mastery-rules.md`, and parent corrections take effect immediately | Automated mastery, selection and correction tests |
| 4 | Attempts, mastery and the current question survive an application restart | Automated restart test |
| 5 | One child's session, export or deletion never reads or affects another child's data | Automated multi-child isolation test |
| 6 | All model responses are schema-validated, with a tested safe fallback for unavailable or invalid output | Automated fallback and repair tests |
| 7 | Safety controls prevent unsafe outputs, personal-data requests, links and arbitrary UI actions from reaching the child view | Table-driven safety suite plus the Day 28 walkthrough |
| 8 | The app is loopback-only by default; LAN mode requires admin authentication | Automated binding and auth tests |
| 9 | Question-to-next-question latency stays within the recorded budget on the target hardware: two seconds for the deterministic path, five seconds when a hint is generated | Day 27 benchmark, with an explicit accept/reject decision |
| 10 | Automated tests cover the critical session path, mastery rules, migrations, cache invalidation and unsafe/invalid-output fallback | Full suite green twice consecutively on Day 26 |
| 11 | A parent can export and permanently delete a child's stored data, and no audio is stored by default | Automated export/deletion tests plus a manual check |
| 12 | Every enabled template has a recorded adult review and a recorded source and licence | Content review record, Day 29 |

## Next steps

The day-by-day execution roadmap is in [`development-plan.md`](development-plan.md). It divides the MVP into 30 two-hour sessions, each with a demonstrable outcome and exit check.

1. Implement persisted session resume and explicit completion, test-first.
2. Install Ollama, download the flash model and record the benchmark.
3. Grow the Reception Maths content bank to target size and implement the re-ask and stopping rules.
4. Implement selection-based answer entry and local read-aloud, and check both children can use them.
5. Implement the gateway, validated response contract, caching and safety fallback.
6. Add parent/admin controls, then run acceptance tests and an adult review of all initial content before a child uses it.

## Files/components to add/change

The target layout is the one in [`architecture.md`](architecture.md). The current code uses a flat `server/` directory; migrate towards the target layout as each area is next touched rather than in one move.

- `server/api/` — HTTP routes and request authentication
- `server/domain/` — curriculum, mastery and answer-key rules
- `server/safety/` — redaction, schema validation, child-output policy
- `server/ai/` — `gateway.ts`, `types.ts`, `schemas.ts` and `providers/ollama.ts`
- `server/persistence/` — repositories and migrations
- `web/` — child session UI, parent/admin controls
- `db/` — versioned migrations and schema
- `tools/` — benchmarks and prompt/content templates
- `tests/` — fake adapter, session, restart, mastery, safety, cache and migration tests
