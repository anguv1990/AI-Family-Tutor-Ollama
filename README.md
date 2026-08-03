AI Family Tutor — Local-first (Ollama) implementation

This repo contains a Node/TypeScript scaffold for the AI Family Tutor project.

Start by installing deps: npm install
Run in dev mode: npm run dev

Files added:
- server/index.ts  (basic HTTP endpoints)
- server/model-adapter.ts  (Ollama adapter stub)
- server/cache.ts  (sqlite-backed cache helper)
- server/session-controller.ts  (session helpers)
- db/migrations/create_tables.sql  (initial schema)
- plan.md  (implementation plan)

Next: implement curriculum templates, prompt-engineering module, and integrate Web UI.
