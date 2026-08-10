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

The service binds to `127.0.0.1:3000` by default. Configuration:

- `HOST` — bind address; defaults to `127.0.0.1`
- `PORT` — HTTP port; defaults to `3000`
- `DB_PATH` — SQLite database; defaults to `./data/tutor.sqlite`

## Current API

Check service health:

```bash
curl http://127.0.0.1:3000/health
```

Start a session:

```bash
curl -X POST http://127.0.0.1:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"childId":"local-child-1"}'
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

Mastery uses the documented `new`, `learning`, and `secure` levels. The persisted level selects the target question difficulty. See `docs/mastery-rules.md` for the exact evidence, promotion, demotion, and skip rules.

## Project plans

- `plan.md` — MVP scope, architecture constraints, and acceptance criteria
- `development-plan.md` — 30 two-hour sessions with daily exit checks

## Next vertical slice

Add session resume and explicit completion behavior, including restart tests that prove the current question and mastery survive an application restart.
