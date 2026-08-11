# Child data export format

A parent can download everything the app has stored about one child as a single
JSON file. The export is local: it is produced by the app on this device, sent
to the browser that asked for it, and never uploaded anywhere.

```
GET /api/parent/children/:childId/export
```

The parent page has a **Download JSON export** button that saves the same
document as `<childId>-export.json`.

## Guarantees

- **One child only.** Every section is filtered by child id. Another child's
  records never appear, and this is enforced by an automated isolation test.
- **No secrets, no configuration.** The admin secret, bind address, model name
  and every other configuration value are excluded.
- **No cache contents.** Cached model wording is shared across children, holds
  no child data and is not part of the export.
- **No answer keys.** The export says which question was asked and what the
  child answered, but not the correct answer — answer keys belong to the
  reviewed content bank (`server/content-bank.ts`), not to the child.
- **No audio.** None is ever recorded, so there is none to export.

## Shape

```jsonc
{
  "format": "ai-family-tutor.child-export",
  "formatVersion": 1,
  "exportedAt": "2026-08-11T09:00:00.000Z",   // ISO 8601, UTC
  "schemaVersion": 7,                          // database migration version
  "excluded": ["model cache entries", "answer keys", "..."],

  "child": {
    "childId": "local-child-1",
    "createdAt": "2026-08-01 09:00:00",
    "dailySessionLimit": 1
  },

  "mastery": [
    {
      "skillId": "reception.addition-within-5",
      "skillTitle": "Addition within 5",
      "level": "learning",                     // new | learning | secure
      "correctAttempts": 3,
      "totalAttempts": 5,
      "score": 0.6,
      "updatedAt": "2026-08-11 09:04:00"
    }
  ],

  "sessions": [                                // newest first
    {
      "sessionId": "…uuid…",
      "number": 1,                             // stable, oldest session is 1
      "label": "Session 1",
      "skillId": "reception.addition-within-5",
      "skillTitle": "Addition within 5",
      "startedAt": "2026-08-11 09:00:00",
      "endedAt": "2026-08-11 09:07:00",
      "status": "completed",                   // active | completed | exhausted
                                               // | question_limit | time_limit
      "answered": 6,
      "skipped": 1,
      "correct": 4
    }
  ],

  "attempts": [                                // newest first
    {
      "attemptId": "…uuid…",
      "sessionId": "…uuid…",
      "skillId": "reception.addition-within-5",
      "templateId": "add-1-plus-1",
      "templateVersion": 1,
      "prompt": "What is 1 + 1?",
      "answer": "2",                           // "" for a skip
      "outcome": "answered",                   // answered | skipped
      "recordedCorrect": true,                 // what the child scored
      "effectiveCorrect": true,                // what counts towards mastery
      "corrected": false,                      // true when an adult corrected it
      "createdAt": "2026-08-11 09:01:00"
    }
  ],

  "corrections": [                             // append-only audit trail
    {
      "correctionId": "…uuid…",
      "attemptId": "…uuid…",
      "action": "applied",                     // applied | reversed
      "originalIsCorrect": false,              // always the child's own result
      "correctedIsCorrect": true,              // null on a reversal
      "reason": "He said four and I typed it wrongly",
      "createdAt": "2026-08-11 09:30:00"
    }
  ],

  "safetyEvents": [                            // only this child's sessions
    {
      "eventId": "…uuid…",
      "sessionId": "…uuid…",
      "sessionNumber": 1,
      "eventType": "fallback_used",
      "createdAt": "2026-08-11 09:02:00"
    }
  ]
}
```

## Notes on the values

- Timestamps written by the app use SQLite's `YYYY-MM-DD HH:MM:SS` format in
  UTC. `exportedAt` is a full ISO 8601 string, also UTC.
- `recordedCorrect` and `effectiveCorrect` differ only where an adult has
  corrected the evaluation. Reading them side by side is how a parent sees what
  was changed and what the child originally did.
- `label` and `number` are non-identifying: a session is described by when it
  happened and its position in the sequence, never by anything about the child.
- The child id is whatever label the adult typed when starting the first
  session. Use something that is not the child's full name.

## Reading an export later

The file is plain JSON with no application-specific encoding. `formatVersion`
is bumped whenever the shape changes incompatibly; `schemaVersion` records the
database migration version it was taken from, which is what a future importer
would need to interpret the rows.
