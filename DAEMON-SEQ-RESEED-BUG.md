# Daemon bug: `transcriptSeq` is not re-seeded after restart (file in omp-squad, not this repo)

**Symptom:** After a daemon restart, a unit that already has a long persisted transcript (e.g.
max seq ~5000) never delivers new turns to a client that loaded that history. New activity is
appended but silently invisible; a client that resumes with `since=<old max seq>` polls forever
and gets nothing back, even though the unit is actively working.

**Mechanism:** `SquadManager.transcriptSeq` (src/squad-manager.ts:1072, `private transcriptSeq = 0`)
is a single in-memory counter that starts at 0 on every process boot. `attachExisting()` (~L2007)
restores a persisted agent's `transcript: TranscriptEntry[]` array verbatim — entries keep their
old high `seq` values — but never touches `transcriptSeq` itself. The append chokepoint
(`append()`, src/squad-manager.ts:10292, `const seq = ++this.transcriptSeq;`) then mints brand-new
entries starting back at 1, 2, 3… A client's delta cursor (`GET .../transcript?since=N`, filtered
`seq > since` in src/transcript-delta.ts:10) computed from the restored high-water mark excludes
every post-restart entry, since their seq is numerically lower — permanent cursor deadlock. Worse,
two unrelated agents restored+resumed in the same process now mint colliding/interleaved seq
values across the whole manager, since the counter is process-global, not per-agent.

**Suggested fix:** on boot, before (or as part of) restoring each agent's persisted transcript,
fold `Math.max(...allPersistedEntries.map(e => e.seq ?? 0))` into `transcriptSeq` (a single
`this.transcriptSeq = Math.max(this.transcriptSeq, maxSeqSeenAcrossAllRestoredAgents)`), so the
counter's next `++` mint is guaranteed higher than anything already on disk.
