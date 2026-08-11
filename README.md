# AI Family Tutor

Local-first, adult-supervised tutoring built with Node, TypeScript, SQLite, and Ollama.

It serves two curricula — Reception maths and Year 3 maths — through one
deterministic session flow:

```text
start session -> receive reviewed question -> child selects an answer
-> mark from answer key -> persist attempt/mastery -> receive next question
```

Ollama is never responsible for marking, mastery or difficulty. Its only job is
optional hints, and a hint that fails its schema, trips safety screening or
leaks the answer is replaced by a deterministic template.

## Requirements

- Node.js 22 or newer
- npm
- Ollama for later model-assisted features; it is not required by the current tests

## Run locally

```bash
npm install
npm test
npm run dev
```

Then open <http://127.0.0.1:3000> for the child interface.

> Reception questions are shown as pictures — countable dots, a number track,
> or a large numeral — as well as text and read-aloud. A four-year-old who can
> neither read the prompt nor is listening to it can still answer.

Then open <http://127.0.0.1:3000/parent.html> for the parent controls.

The service binds to `127.0.0.1:3000` by default. Configuration:

- `HOST` — bind address; defaults to `127.0.0.1`
- `PORT` — HTTP port; defaults to `3000`
- `DB_PATH` — SQLite database; defaults to `./data/tutor.sqlite`
- `ADMIN_SECRET` — required for the parent routes; **required to start at all**
  if `HOST` is not a loopback address

## Network access and the trusted-home-network assumption

Loopback is the default and nothing outside this machine can reach the app.

Setting `HOST` to anything else (a LAN address, or `0.0.0.0`) is LAN mode, and
the app **refuses to start** unless `ADMIN_SECRET` is set to at least 16
characters. That is deliberate: the app holds a child's learning record, has no
per-child logins, and speaks plain HTTP, so anything that can reach the port can
read everything.

LAN mode assumes every device on your home network is well intentioned — the
admin secret is the only barrier. That is a reasonable trade on your own Wi-Fi
so a tablet in another room can reach the tutor. It is not reasonable on a
shared, guest or public network. If in doubt, leave `HOST` unset.

Parent routes are authenticated with an `x-admin-secret` header, compared in
constant time. On a loopback bind with no `ADMIN_SECRET` set they are open to
anyone using this machine, and the privacy summary on the parent page says so.

```bash
ADMIN_SECRET='a-long-enough-parent-secret' HOST=0.0.0.0 npm start
```

See `docs/privacy-controls.md` for the full parent route list, the deletion and
retention rules, and what deletion deliberately leaves behind; and
`docs/data-export.md` for the export format.

## Current API

Check service health:

```bash
curl http://127.0.0.1:3000/health
```

List the enabled skills and how many reviewed questions each one has:

```bash
curl http://127.0.0.1:3000/api/skills
```

Start a session, or resume the child's open one. A child can only have one open
session at a time, so this is safe to call repeatedly — the `resumed` field in
the response says which happened. `skillId` is optional and defaults to
`reception.addition-within-5`; a resumed session keeps the skill it began with.

```bash
curl -X POST http://127.0.0.1:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"childId":"local-child-1","skillId":"reception.counting-to-10"}'
```

Read a session's current state, including the question the child is on:

```bash
curl http://127.0.0.1:3000/api/sessions/SESSION_ID
```

Submit an answer using the returned session and question IDs:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions/SESSION_ID/answers \
  -H 'content-type: application/json' \
  -d '{"questionId":"QUESTION_ID","answer":"2"}'
```

Skip the current question without changing graded mastery evidence:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions/SESSION_ID/skip \
  -H 'content-type: application/json' \
  -d '{"questionId":"QUESTION_ID"}'
```

End a session deliberately and get its summary:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions/SESSION_ID/complete
```

Answer and skip responses carry a `status` of `active` or `exhausted`, so running
out of reviewed content is an explicit state rather than a silent stop.

Starting a session answers `201` with `status: "active"`, or `200` with
`status: "exhausted"` or `"daily_limit"` and a child-facing `message` when there
is nothing to practise right now. Neither is an error: a child who worked
through a skill yesterday meets the 24-hour re-ask window, and a child who has
already had today's session has done nothing wrong. `sessionId` and `question`
are `null` in those cases.

Each child may practise three sessions a day by default. Only a session they
actually answered a question in counts, so an abandoned or reloaded sitting
costs nothing. Resuming the session they are already in always works, and a
parent can change the limit per child from the parent page.

Questions come from the adult-reviewed bank in `server/content-bank.ts` — seven
skills across two year groups, 21 enabled templates each. Reception answers are
whole numbers 0–10 tapped from a row; Year 3 answers are whole numbers of any
size typed on a keypad. A child is only ever served their own year group's
skills, a session is bound to one skill, and selection never crosses either
boundary.

Mastery uses the documented `new`, `learning`, and `secure` levels. The persisted level selects the target question difficulty. See `docs/mastery-rules.md` for the exact evidence, promotion, demotion, and skip rules.

## Parent controls

<http://127.0.0.1:3000/parent.html> — a plain adult page for reviewing sessions,
attempts, mastery and safety events; correcting an evaluation with a reason and
undoing it again; setting the daily practice limit; exporting a child's data;
permanently deleting it; setting retention; and clearing the model cache.

```bash
curl http://127.0.0.1:3000/api/parent/children \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## Using it on a tablet

A four-year-old cannot work a mouse — it needs two-handed coordination they do
not have yet. The app is built touch-first (88px targets), so a tablet on the
home network is the intended way for a Reception child to use it.

```bash
npm run start:tablet
```

That reads `.env.local` (not in git), binds to every interface and requires the
admin secret. Then open `http://<this-mac's-LAN-IP>:3000` on the tablet — find
the IP with `ipconfig getifaddr en0`.

`ADMIN_SECRET` is the parent password. It guards every `/api/parent/*` route —
the ones that can export or permanently delete a child's data — and the server
**refuses to start** on a non-loopback host without one of at least 16
characters. That refusal is deliberate: binding to the network without it would
publish a delete button to everyone in the house.

To change it, edit `ADMIN_SECRET` in `.env.local`. There is no other copy, so
losing it only means picking a new one.

See the trusted-home-network assumption above before using this.

## Backup and restore

Everything the family owns is one SQLite file. Until encrypted automated
backups arrive in Phase 3, losing the Mac Mini loses every recorded attempt, so
back it up **before a child uses the system**:

```bash
node -e "require('better-sqlite3')(process.env.DB_PATH || './data/tutor.sqlite')
  .backup('./backups/tutor-'+new Date().toISOString().slice(0,10)+'.sqlite')
  .then(() => console.log('backup written'))"
```

Use that rather than `cp` — a plain copy can catch a torn page or miss the
newest attempts still in the `-wal` file. The full procedure, and a record of
the rehearsed restore, is in `docs/backup-restore.md`.

## Benchmarking the model

```bash
npm run benchmark        # writes docs/model-registry.json
```

Records the model digest, quantization, hardware, warm and cold latency and
failure rate, and gives an accept/reject verdict against the latency budget in
`plan.md` (2 s deterministic, 5 s with a hint).

## Troubleshooting

**Hints are generic and never mention the question.** The model is unreachable
or was too slow, and the deterministic template was served instead — by design.
Check `ollama list` shows the model in `FLASH_MODEL`, and look at the parent
page's safety events for the recorded reason. The session itself never depends
on the model.

**A session will not start and the child sees "You already did today".** The
daily practice cap. Raise it for that child on the parent page.

**A session will not start and the child sees "You did them all".** Every
reviewed question for that skill is inside its 24-hour re-ask window. This is
normal for a small bank; it clears with time, or add reviewed templates.

**The parent page loads without asking for a secret.** `ADMIN_SECRET` is unset
and you are on loopback. Set it — otherwise anyone using this Mac can export or
delete a child's data.

**The server refuses to start with an admin-secret error.** `HOST` is not
loopback, so LAN mode requires `ADMIN_SECRET` of at least 16 characters. This
is deliberate: see the trusted-home-network section above.

**`npm test` fails immediately after pulling changes.** Run `npm install` — the
native `better-sqlite3` binding must match your Node version.

## Project plans

- `plan.md` — MVP scope, architecture constraints, and acceptance criteria
- `development-plan.md` — 30 two-hour sessions with daily exit checks
- `docs/acceptance.md` — the recorded pass/fail result for every criterion
- `docs/mastery-rules.md` — evidence, promotion, demotion and selection rules
- `docs/privacy-controls.md` — parent access, deletion and retention rules
- `docs/data-export.md` — the export format
- `docs/backup-restore.md` — backup procedure and the rehearsal record

## Next step

Sit both children in front of `http://127.0.0.1:3000` and watch. Whether a
Reception-age child can use this unaided is the one assumption everything else
rests on, and it is still untested — see `docs/acceptance.md`.
