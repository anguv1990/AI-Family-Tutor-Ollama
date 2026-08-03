# AI Family Tutor — Implementation Plan (Local-first, Ollama)

PROGRESS: Scaffold created; Ollama adapter implemented (retry/timeout/normalization); cache and session stubs added. Next work: finalize caching integration and session loop. (Saved: 2026-08-03T18:11:00+01:00)

Owner: Angu  
Scope: Private, adult-supervised family MVP for two children

## Goal

Build an AI Family Tutor as a local-first system using Ollama. The MVP covers Maths and English for Reception and Year 3, keeps data on the family device, uses measured model routing and caching, and allows model swaps through a single adapter.

## Non-goals for the MVP

- No child accounts, social features, web search, cloud sync, or autonomous background tutoring.
- No VR, Science, or additional subjects until the Reception Maths loop is demonstrably safe and useful.
- It supports an adult-supervised home setting; it is not a substitute for teaching, formal assessment, or safeguarding advice.

## Proposed approach

- Ollama runs locally on the Mac Mini, using Apple-Silicon-suitable quantized models.
- A Node + TypeScript tutoring engine talks to Ollama through a model-adapter layer.
- Start with one measured flash model; add a pro-model route only for defined, rare ambiguous cases.
- Store persistent data in local SQLite: child profiles, mastery, attempts, templates, caches and safety events.
- Build a local web UI. Typed input is required for the MVP; voice is an optional later enhancement.
- Use strict context limits, deterministic evaluation and versioned caching to minimise compute.

## Phases

### Phase 0 — Environment, content baseline and scaffolding

- Install Ollama; download a flash model and record its exact name/digest, quantization, options, hardware, latency and memory benchmark in a local model registry.
- Define a small, adult-reviewed Reception Maths skill map, question templates, answer keys and mastery thresholds.
- Scaffold the Node/TypeScript service, web UI and SQLite persistence with clean domain, persistence and HTTP/UI boundaries.
- Add and validate configuration at startup: `OLLAMA_URL`, `FLASH_MODEL`, `PRO_MODEL`, bind address and admin secret.
- Bind to loopback by default. LAN access requires an admin login and a documented trusted-home-network assumption.
- Define versioned SQLite migrations for child profile, skill/mastery, session/attempt, content template, cache, safety event and schema version.
- Establish a fake-model adapter and test harness so core tutoring behaviour is testable without Ollama.

### Phase 1 — Prove the loop (Reception Maths)

- Implement the Ollama adapter and a single flash-model path.
- Implement SQLite caching.
- Implement the minimal typed-input loop: choose a curated question -> child answers -> evaluate -> update mastery -> choose the next suitable item.
- Use deterministic templates and answer keys for core arithmetic. The model may vary wording or provide hints, but is not the sole source of correctness.
- Define mastery behaviour before coding: evidence required, promotion/demotion thresholds, confidence bounds, and handling of skipped, ambiguous and parent-corrected answers.
- Require a versioned JSON response schema for every model output. Reject invalid output, retry once with a repair prompt, then use a safe template fallback; never render raw model text.
- Allow-list UI actions and content fields; screen outputs for unsafe content, links, contact requests and personal-data prompts before display.
- Record a minimal audit trail: template/version, model/version, safety decision and mastery change. Do not store audio or unnecessary free text.

### Phase 2 — Year 3 and English

- Add adult-reviewed curriculum templates and answer keys for Year 3 and English comprehension.
- Add an adult review/correction flow for evaluations; corrections immediately update mastery and remain auditable.
- Add scheduled pro-model re-evaluation only for explicit ambiguous cases. It must return the same validated schema and cannot change mastery without a recorded rationale.

### Phase 3 — Extend deliberately

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
- Use low temperature for evaluation and benchmark before enabling any pro-model escalation.

## Safety and privacy

- Keep SQLite local; cloud storage is off by default.
- Browser Web Speech API is not inherently local: some implementations send audio to a provider. Before enabling voice, verify the selected browser's behaviour; otherwise retain typed input or use an explicitly local STT engine. Do not persist audio by default.
- Provide an admin/parent data screen to view, export and permanently delete a child's data, clear caches/sessions and set a retention period. Deletion includes derived mastery and audit records as appropriate.
- Use rule-based screening, with an optional local classifier, plus a parent-visible safe fallback for blocked output.
- Encrypt backups rather than the active database by default, and document the local-device, OS-account and physical-access threat model.
- Treat model files and prompt/template updates as supply-chain inputs: obtain them from trusted sources, pin versions and require adult review for local content changes.

## Developer ergonomics and quality

- Keep a single `generate(model, prompt, options)` model-adapter interface.
- Keep model names and routing rules configuration-driven.
- Add benchmark scripts for latency and memory per model.
- Use structured local logs with no child-identifying data; surface model failures, schema fallbacks and safety blocks to the parent/admin.
- Automate tests for mastery transitions, cache invalidation, schema rejection/fallback, safety rules, migrations and the end-to-end fake-adapter session loop.

## Next steps

1. Install Ollama, download the flash model and record the benchmark.
2. Finalise the initial curated Reception Maths skill map, templates, answer keys and mastery thresholds.
3. Scaffold the Node/TypeScript project with SQLite migrations and fake-model tests.
4. Implement the model adapter, validated response contract and typed-input session loop.
5. Add caching, safety fallback and parent/admin controls.
6. Run acceptance tests and an adult review of all initial content before a child uses it.

## Files/components to add/change

- `server/`
  - `model-adapter.ts`
  - `session-controller.ts`
  - `mastery.ts`
  - `cache.ts`
  - `safety.ts`
  - `schemas.ts`
- `web/`
  - session UI, parent/admin controls, optional later voice input
- `db/`
  - versioned migrations and schema
- `tools/`
  - benchmarks and prompt/content templates
- `tests/`
  - fake adapter, session, mastery, safety, cache and migration tests

## Trade-offs

- Local models have less capability than leading cloud models. Curated templates, answer-key checks and adult correction are the primary quality guardrails; a pro model is a measured, narrow escalation rather than an automatic default.
- Local storage protects privacy but makes device loss a risk; encrypted, opt-in backups address recovery without changing the default.
- Generated educational content can be subtly wrong, so initial content must be reviewed and the model must not be the sole evaluator for core skills.

## Acceptance criteria (MVP)

- An adult can run an end-to-end typed Reception Maths session locally using the flash model and an explicitly defined initial skill set.
- The app selects the next item from persisted mastery; updates follow documented thresholds and parent corrections take effect immediately.
- All model responses are schema-validated, with a tested safe fallback for unavailable or invalid model output.
- Safety controls prevent unsafe outputs, personal-data requests, links and arbitrary UI actions from reaching the child view.
- The app is loopback-only by default; LAN mode requires admin authentication.
- Automated tests cover the critical session path, mastery rules, migrations, cache invalidation and unsafe/invalid-output fallback.
- A parent can export and permanently delete a child's stored data, and no audio is stored by default.
