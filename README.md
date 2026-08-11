# AI Family Tutor

Local-first, adult-supervised tutoring built with Node, TypeScript, SQLite, and Ollama.

The first vertical slice provides a deterministic Reception Maths session flow:

```text
start session -> receive reviewed question -> submit typed answer
-> mark from answer key -> persist attempt/mastery -> receive next question
```

Ollama is not responsible for marking answers. Model-assisted hints and wording will be added through the validated adapter path in a later slice.

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

> The web interface in `web/` is a **spike**, not the real UI. It exists to test
> one unvalidated assumption — whether a Reception-age child can actually use
> this — before more is built on top of it. Expect to throw it away.

The service binds to `127.0.0.1:3000` by default. Configuration:

- `HOST` — bind address; defaults to `127.0.0.1`
- `PORT` — HTTP port; defaults to `3000`
- `DB_PATH` — SQLite database; defaults to `./data/tutor.sqlite`

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

Questions come from the adult-reviewed bank in `server/content-bank.ts` — three
Reception Maths skills, at least twenty enabled templates each, every answer a
whole number from 0 to 10 so it can be tapped rather than typed. A session is
bound to one skill and selection never crosses into another.

Mastery uses the documented `new`, `learning`, and `secure` levels. The persisted level selects the target question difficulty. See `docs/mastery-rules.md` for the exact evidence, promotion, demotion, and skip rules.

## Project plans

- `plan.md` — MVP scope, architecture constraints, and acceptance criteria
- `development-plan.md` — 30 two-hour sessions with daily exit checks

## Next vertical slice

A rough browser UI over this API, to test whether a Reception-age child can actually use it. That assumption is currently untested and everything else is built on it.
