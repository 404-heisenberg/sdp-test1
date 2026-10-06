# RAT — Repo Analysis Tool: Build Plan

**Test: COMS3011A, clock started 14:30, ends 17:00. Target: 100% tier via strict tier order.**

## Architecture

- TypeScript full-stack. `server/` (Express + tsx), `client/` (Vite + React). Dev: both via concurrently, Vite proxies `/api`.
- **Precompute at ingestion**: one `git log` pass per repo → flat row store (in-memory + JSON on disk) → every metric/filter is aggregation over rows. No repeated git calls.
- Repos stored under `data/repos/<id>/` (full clones from URL; unzipped zips).

## The git command (correctness core)

```
git log HEAD --no-merges -M50% --use-mailmap --numstat \
  --format=%H%x1f%an%x1f%ae%x1f%cI
```

- `--no-merges`: H̄ = non-merge commits reachable from reference (HEAD)
- `-M50%`: rename detection at 50% threshold → numstat shows `old => new` / `{old => new}`; **attribute all adds/removes to the NEW path; pure rename (0/0) contributes nothing**
- `--use-mailmap`: author identity after mailmap merging
- `%cI`: committer date ISO — **time filters use committer date**
- numstat rows: `added<TAB>removed<TAB>path`; `-` = binary → **skip binary entirely**
- Deleted file: `0<TAB>N<TAB>path` → counts as N lines removed on that path
- Initial commit: parent = empty commit, numstat vs nothing — git handles naturally

## Data model

```ts
Commit { hash, authorName, authorEmail, date }        // post-mailmap
Row    { hash, path, added, removed }                  // non-binary, adds/removes to NEW path
Merge  { canonicalEmail, aliasEmails[] }               // manual author merges, per repo
```

## Metric formulas (from brief)

Per file/commit: `l+ = added`, `l− = removed`, `δ = l+ − l−`, `λ = l+ + l−`.
Directory = sum over rows whose path is **anywhere below** the dir (immediate-children recursion collapses to prefix sums); root `""` = repository metrics.
Commit set H (time range on committer date, or manual list): sum λ/δ/l+/l− over commits in H; `n` = # commits with λ>0 on path; `η = n/|H|`; `ρ = λ/|H|` (guard |H|=0).
Author: post-merge identity (email is the key); `n_a`, `λ_a`, ownership `ω = λ_a / λ` (guard λ=0).

## Build order (checkpoints, committed + pushed)

1. **[~15 min] Scaffold + PLAN** — Vite/Express boot, this file.
2. **[~45 min] Tier 50%**: ingestion (zip w/ .git + deep clone URL `git clone --single-branch? NO — full clone`), git log parse, metric engine (all categories), verification script vs hand-computed tiny fixture repo. **CHECKPOINT: all metrics correct, both ingestion paths.**
3. **[~25 min] Tier 75%**: dashboard UI + filters (repo, author, file/dir, commit set: date range OR manual multi-select). **CHECKPOINT.**
4. **[~20 min]**: author merge — mailmap (via --use-mailmap) + manual merge UI (canonical + aliases), re-derive metrics. **CHECKPOINT.**
5. **[~15 min] Tier 100%**: multi-repo dashboard, perf pass (streamed log parse via readline, no UI freeze, progress indication for big repos). **CHECKPOINT.**
6. **[~10 min]**: README (run instructions, features, AI declaration), final push. Submission = repo URL.

## Edge cases (the 50% correctness weight)

- Rename+edit → new path only; pure rename → zero churn
- Binary files (`-` numstat) excluded entirely
- Deletions = removed lines on the deleted path
- Root directory = repository metrics (path `""`)
- η, ρ zero-division guards (|H| = 0)
- Ownership guard λ = 0
- Authorship test AFTER merging (mailmap + manual)
- Paths: no leading `/`; root children are paths without `/`
- Zip ingestion must find `.git` inside (maybe nested one level)

## Verification

- `scripts/verify.ts`: tiny fixture repo (created by script: known adds/removes/renames/deletes/binary) → assert exact metric values
- Sample metrics (cJSON/Redis/git at hashes): fetch when available, compare
- Fixture covers: every metric category, rename cases, deletion, binary skip, dir recursion, time filter, manual set

## Roles

Agent codes. User directs, reviews numbers, fetches sample metrics.
