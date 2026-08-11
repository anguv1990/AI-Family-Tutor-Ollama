# Parent, privacy and access controls

What an adult can see, correct, keep and delete, and who is allowed to ask.
`plan.md`'s *Safety and privacy* section is the requirement this implements;
where the two disagree, `plan.md` wins.

The parent page is at <http://127.0.0.1:3000/parent.html>.

## Access control

| Bind address | `ADMIN_SECRET` | Result |
| --- | --- | --- |
| Loopback (default) | unset | App starts. Parent routes are open to anyone using this machine, and the privacy summary says so. |
| Loopback | set | App starts. Parent routes require the secret. |
| Anything else (LAN) | unset | **App refuses to start.** |
| Anything else (LAN) | set, under 16 characters | **App refuses to start.** |
| Anything else (LAN) | set, 16+ characters | App starts in LAN mode. Parent routes require the secret. |

The secret is sent as an `x-admin-secret` header and compared with
`crypto.timingSafeEqual` over SHA-256 digests, so the comparison is
constant-time and over equal-length buffers whatever the caller sends.

Unauthenticated requests to any parent route get `401 {"error":"unauthorized"}`
before any database access, so a rejected caller cannot learn whether a child id
exists by comparing responses. Everything else that fails returns
`400 {"error":"invalid_request"}` and never leaks an internal message.

### The trusted-home-network assumption

LAN mode assumes every device on the home network is well intentioned. There
are no per-child logins, the traffic is plain HTTP, and the admin secret is the
only barrier. That is an acceptable trade for a family running this on their own
Wi-Fi to reach the tutor from a tablet; it is not acceptable on a shared,
guest or public network. Loopback stays the default for exactly this reason.

## Parent routes

All require `x-admin-secret` when a secret is configured.

| Route | Purpose |
| --- | --- |
| `GET /api/parent/children` | Every child, with session counts and today's usage |
| `GET /api/parent/children/:childId/overview` | Sessions, attempts, mastery, corrections and safety events |
| `GET /api/parent/children/:childId/export` | Full JSON export — see `docs/data-export.md` |
| `DELETE /api/parent/children/:childId` | Permanent deletion; body `{ "confirm": "<childId>" }` |
| `GET /api/parent/children/:childId/settings` | Daily session limit and today's usage |
| `PUT /api/parent/children/:childId/settings` | Body `{ "dailySessionLimit": 0–10 }` |
| `POST /api/parent/attempts/:attemptId/correction` | Body `{ "isCorrect": bool, "reason": string }` |
| `DELETE /api/parent/attempts/:attemptId/correction` | Reverse a correction |
| `GET /api/parent/privacy` | The privacy summary below |
| `PUT /api/parent/retention` | Body `{ "sessionDays": 0–3650, "eventDays": 0–3650 }` |
| `POST /api/parent/retention/run` | Delete everything now expired |
| `POST /api/parent/cache/clear` | Empty the model cache |

The parent overview never carries answer keys, prompts sent to a model, model
names or provider details. The child routes carry none of them either.

## Corrections

Described in full in `docs/mastery-rules.md`. In short: the correction is stored
alongside the child's own result rather than on top of it, every correction and
reversal appends to an audit trail, and reversing restores the previous mastery
exactly.

## Deletion

`DELETE /api/parent/children/:childId` with a body confirming the child id
removes, in one transaction and with explicit statements per table:

- the child row
- every session
- every attempt (answers and skips)
- every correction audit row
- the mastery record for every skill
- every safety event raised during that child's sessions

**Deliberately not removed**, because it is not this child's data:

| Kept | Why |
| --- | --- |
| `skills`, `content_templates` | The shared adult-reviewed curriculum. Deleting it would break the app for the other child. |
| `cache` | Generated wording keyed by prompt hash. It is shared, contains no child data, and can be cleared separately from the parent page. |
| `parent_settings` | Retention periods, which are settings for the household rather than facts about a child. |
| `schema_versions` | Database bookkeeping. |
| Safety events with no session | Gateway events not attributable to any child. |

Deletion is scoped by `child_id` throughout and never relies on
`ON DELETE CASCADE`: migration 005 in this project showed a table rebuild
cascading `attempts` away silently, and deletion is the one operation with no
undo. An automated multi-child isolation test proves one child's session,
export and deletion never read or affect another's records — this is MVP
acceptance criterion 5.

## Retention

Two periods, both in days, both **0 by default meaning "keep until you delete
it yourself"**. Nothing is ever deleted until a parent both sets a period and
runs retention.

| Setting | Removes |
| --- | --- |
| `sessionDays` | Sessions that have **ended** more than that many days ago, and their attempts, correction rows and safety events |
| `eventDays` | Safety events older than that many days |

An unfinished session is never expired, whatever its age. After pruning,
mastery is recalculated for every affected child and skill so the stored level
never claims evidence that is no longer there — which does mean that pruning old
answers lowers the recorded attempt counts. That is the honest behaviour: the
alternative is a mastery level nothing in the database supports.

Retention runs only when asked (`POST /api/parent/retention/run`, or the
**Delete expired now** button). It does not run on startup. A destructive
background job that fires while nobody is looking is the wrong default for
family data.

## Privacy summary

`GET /api/parent/privacy`, rendered on the parent page, states:

- where the database file is, and that nothing leaves the device
- the bind address, whether LAN mode is on, and the trust assumption that goes
  with it
- whether parent routes require the secret or are open on loopback
- what is stored: which reviewed question was asked, the answer the child chose,
  session times, mastery per skill, corrections with their reasons, and safety
  and fallback events
- what is never stored: audio in any mode, names or birthdays or school details
  or any other identifier, free text from the child beyond the selected answer,
  and any cloud copy
- current record counts and the retention settings, including when retention
  last ran

The summary never includes the admin secret itself.

## What a parent should do

1. Set `ADMIN_SECRET` before using LAN mode. The app will not start without it.
2. Use a nickname, not a full name, as the child id.
3. Export before deleting anything. Deletion is permanent and there is no undo.
4. Back the database file up separately; export is a readable copy, not a
   restore path.
