# MVP acceptance record

Every criterion in `plan.md` with a recorded result and instructions to
reproduce it. Assessed 2026-08-11 against the built application on the target
machine (Apple M4 Pro, 24 GB, macOS 25.5.0, Node 22, Ollama `qwen2.5:7b`).

Reproduce the automated evidence with:

```bash
npm install && npm test        # 210 tests
```

| # | Criterion | Result |
|---|---|---|
| 1 | End-to-end Reception Maths session locally | **Pass, with a gap** |
| 2 | Each child completes a session unaided | **Not verified** |
| 3 | Selection from persisted mastery; corrections take effect | **Pass** |
| 4 | Attempts, mastery, current question survive restart | **Pass** |
| 5 | One child's data never reads or affects another's | **Pass** |
| 6 | Model responses schema-validated with tested fallback | **Pass** |
| 7 | Safety controls keep unsafe output from the child view | **Pass** |
| 8 | Loopback-only by default; LAN requires admin auth | **Pass, with a gap** |
| 9 | Latency within the recorded budget | **Pass** |
| 10 | Automated tests cover the critical paths | **Pass** |
| 11 | Parent can export and permanently delete; no audio stored | **Pass** |
| 12 | Every enabled template has a recorded adult review | **Blocked on the adult** |

## Detail

**1 — End-to-end session.** Reproduce: `npm run build && node dist/server/index.js`,
then open `http://127.0.0.1:3000`. Verified over real HTTP against a running
server: start, prompt, select, confirm, correct and incorrect feedback, a real
Ollama hint, skip, resume, and all four endings.
*Gap:* no browser was available in this environment, so nothing visual has been
confirmed — rendering, focus rings, touch target sizes and actual spoken audio
are unverified. An adult must do one visual pass before a child sees it.

**2 — Children unaided.** Not verified and not verifiable without the children.
This is the pilot's central question and the reason the risk register rates
"a Reception child cannot use the interface unaided" as high/high. The UI is
built for it — no typing, no reading required, tap-then-confirm, spoken prompts —
but the claim is untested.

**3 — Mastery-driven selection and corrections.** Automated:
`tests/mastery.test.ts`, `tests/session-flow.test.ts`,
`tests/parent-corrections.test.ts`. Includes promotion at five attempts / 80% /
two latest correct, demotion only after two consecutive incorrect, correction
recalculating mastery, and reversal restoring it exactly.

**4 — Restart persistence.** `tests/session-restart.test.ts` reopens the
database from the same file and asserts the current question and mastery
survive. Also rehearsed live in `docs/backup-restore.md`.

**5 — Multi-child isolation.** `tests/parent-data.test.ts` —
"keeps one child's session, export and deletion away from another's".

**6 — Schema validation and fallback.** `tests/ai-gateway.test.ts` covers
success, invalid output, one repair retry, second failure, timeout, unavailable
model, and cache behaviour. Raw model text never reaches the caller.

**7 — Safety.** `tests/safety.test.ts` is table-driven over URLs, emails, phone
numbers, contact requests and personal-data prompts. A blocked hint goes
straight to the deterministic template with no repair attempt, and raises a
parent-visible event. The model's only structural power is a `hint` string —
it cannot mark, score, choose difficulty or trigger a UI action.

**8 — Network binding.** Default bind is `127.0.0.1`. `loadConfig` refuses to
start on a non-loopback host without `ADMIN_SECRET`, and rejects a secret under
16 characters (`tests/parent-api.test.ts`). Verified live.
*Gap:* on loopback with no `ADMIN_SECRET` set, parent routes are open to anyone
using that Mac — including `/parent.html`, which can export and delete. Set
`ADMIN_SECRET` even for local-only use.

**9 — Latency.** `npm run benchmark` writes `docs/model-registry.json`.
Measured: deterministic path 0.12 ms median / 0.53 ms p95 against a 2000 ms
budget; hint path 582 ms warm, 3788 ms cold against a 5000 ms budget; zero
failures and zero fallbacks in eight calls. **Decision: accept.** Cold-start
headroom was the weak point, so the provider now sends `keep_alive` (30 m) to
stop the model being evicted between questions.

**10 — Test coverage.** 210 tests, green twice consecutively on a clean
install, covering the session path, mastery rules, migrations (including a
v4→v5 rebuild that would otherwise cascade-delete attempts), cache
invalidation, safety, parent controls, retention and the child UI state machine.

**11 — Export and deletion.** `tests/parent-data.test.ts`; format documented in
`docs/data-export.md`, scope in `docs/privacy-controls.md`. No audio is stored
because none is ever captured: speech is output-only and speech recognition is
deliberately deferred.

**12 — Adult content review.** `tests/content-answer-keys.test.ts` independently
re-derives all 63 answer keys from their prompt text and confirms every one
agrees with its stored key, that every answer is tappable on the 0–10 pad, and
that no prompt is duplicated within a skill. Source and licence are recorded
for every template.
*Blocked:* machine verification is not adult review. The `reviewed = 1` flag is
currently set by the seed rather than by a person. Before a child uses this,
read the enabled prompts and confirm the wording is right for your children —
the arithmetic is proven, the pedagogy and tone are not.

## Release-blocking summary

Two items block a child using this, and both need you rather than more code:

1. **One visual pass in a browser** (criterion 1) — confirm rendering, touch
   targets and that a prompt is actually spoken aloud on the target machine.
2. **Adult sign-off on the content** (criterion 12) — read the enabled prompts.

Criterion 2 is the pilot itself and cannot pass before it starts.
