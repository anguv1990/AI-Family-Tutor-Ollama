# Backup and restore

`plan.md` names device loss as a medium-likelihood, high-impact risk: until
Phase 3 adds encrypted automated backups, a lost or corrupted Mac Mini destroys
every recorded attempt and every mastery record. The mitigation is this manual
procedure, and the trigger to run it is **before any child uses the system**.

This procedure was rehearsed end to end on 2026-08-11, including a restore into
a clean location. The rehearsal is described at the end.

## What to back up

Everything the family owns lives in one SQLite file, by default
`./data/tutor.sqlite` (override with `DB_PATH`). That single file holds child
profiles, sessions, attempts, mastery, parent corrections, settings and safety
events.

The reviewed question bank is **not** in scope: it is re-seeded from
`server/content-bank.ts` on every start, so the code repository is its backup.

## Taking a backup

Use SQLite's own online backup rather than `cp`. A plain copy of a database
that is being written to can capture a torn page, and the `-wal` and `-shm`
side files mean the newest attempts may not be in the main file yet. The
command below is safe to run while the tutor is running:

```bash
node -e "require('better-sqlite3')(process.env.DB_PATH || './data/tutor.sqlite')
  .backup('./backups/tutor-'+new Date().toISOString().slice(0,10)+'.sqlite')
  .then(() => console.log('backup written'))"
```

Keep the result somewhere that does not share the Mac Mini's fate — an external
disk or another machine. A backup sitting on the device it protects against is
not a backup.

Backups are **not encrypted**. They contain the child's learning history, so
treat the destination as you would the device itself. Encrypted backups are
deliberately deferred to Phase 3.

## Restoring

1. Stop the tutor.
2. Copy the chosen backup file into place as the database:
   ```bash
   cp ./backups/tutor-2026-08-11.sqlite ./data/tutor.sqlite
   ```
3. Start the tutor as usual. Migrations run automatically on start, so a
   backup taken from an older schema version is upgraded in place — this is the
   same runner that upgrades a live database, and it is covered by tests.
4. Confirm the restore before letting a child use it: open the parent page and
   check that the last session and mastery look right.

To restore somewhere else without touching the live data, point `DB_PATH` at
the copy instead:

```bash
DB_PATH=/tmp/restore-check/tutor.sqlite npm start
```

## Rehearsal record — 2026-08-11

Performed on the target machine, against the built application:

1. Started the tutor on a fresh database and completed one real attempt over
   HTTP, giving one child, one session, one attempt and one mastery row.
2. Took a backup with the online-backup command above. Result: `backup written`.
3. **Deleted the live database directory outright** to simulate device loss.
4. Copied the backup into a clean location and started the tutor against it.
5. Started a session for the same child and confirmed the response reported
   `resumed=true`, `totalAttempts=1`, and the same current question
   (`addition-2-plus-2`).

The restored installation continued the child's session exactly where it
stopped, so both the data and the resume behaviour survived. Re-run this
rehearsal whenever the schema changes materially.
