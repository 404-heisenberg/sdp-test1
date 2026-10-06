# RAT — Repo Analysis Tool

A web dashboard that ingests git repositories and answers the questions a maintainer
actually asks: where is the churn, who owns what, and what did a slice of history cost
in lines? RAT computes file, directory, repository, commit-set, and author metrics from
a single `git log` pass per repository, then filters and aggregates over the stored
rows — so browsing and filtering never re-runs git.

Built for the COMS3011A test brief.

## Quick start

Requires **Node.js ≥ 20** and **git**. One script does it all:

```bash
git clone https://github.com/404-heisenberg/sdp-test1.git rat && \
cd rat && \
npm install && \
npm run dev
```

Then open **http://localhost:5173**.

- The Express API listens on `http://localhost:3001` (Vite proxies `/api` to it in dev).
- `Ctrl+C` stops both processes.

### Production mode (single process)

```bash
npm run build   # typechecks and bundles the client into client/dist
npm start       # Express serves the API + built client on http://localhost:3001
```

### Tests and verification

```bash
npm test        # full vitest suite (unit + fixture gate)
npm run verify  # same fixture gate: builds a scripted repo and checks exact metric values
npm run typecheck
```

## Using RAT

1. **Add a repository** on the dashboard — paste a clone URL (deep-cloned, full
   history) or upload a zip that contains a `.git` directory. Ingestion runs in the
   background with live progress (commits and row counts stream in; the UI stays
   responsive even for ~100k-commit repositories).
2. **Pick a repository** from the list — each repo's metrics are fully isolated; the
   listing shows its root (repository-level) metrics at the current HEAD.
3. **Drill down** through directories to files; every level shows added, removed,
   growth, and churn.
4. **Filter** by author, by commit set (committer-date range or hand-picked commits),
   or scope to any path — filters combine and are encoded in the URL, so views are
   shareable and switching repositories never leaks filter state.
5. **Merge authors** — mailmapped identities fold automatically; additional aliases
   can be merged manually (with undo) and every metric recomputes.

## Metrics

Per commit and non-binary path (git numstat, rename-aware):

| Symbol | Name             | Definition                                    |
| ------ | ---------------- | --------------------------------------------- |
| `l+`   | lines added      | added lines on the path in a commit           |
| `l−`   | lines removed    | removed lines on the path in a commit         |
| `δ`    | growth           | `l+ − l−`                                     |
| `λ`    | churn            | `l+ + l−`                                     |

Aggregations:

- **File** — per-commit metrics over the file's history.
- **Directory** — recursive sums over every path below it; the root directory *is*
  the repository metrics.
- **Commit set H** — sums of `λ`/`δ`/`l+`/`l−` over the set, plus modifications `n`
  (commits with `λ > 0` on the path), modification frequency `η = n/|H|`, and churn
  rate `ρ = λ/|H|` (zero-safe when `|H| = 0`).
- **Author** — modifications `n_a`, churn `λ_a`, ownership `ω = λ_a/λ` (zero-safe),
  computed **after** mailmap + manual merging.

Correctness semantics (mirroring git's own reporting):

- Only non-merge commits reachable from the reference (HEAD) are counted.
- Rename detection at git's 50% similarity threshold (`-M50%`): changes in a
  rename+edit count entirely on the **new** path; a pure rename costs nothing.
- Binary files (git's `-` numstat marker) are excluded everywhere.
- Deleting a file counts as removed lines on that path.
- Time filters use the **committer date**; author identity is resolved through
  `.mailmap` (including a committed `.mailmap` on no-checkout clones).

## Architecture

TypeScript throughout, npm workspaces:

- **`server/`** — Express + tsx. Ingestion (`src/ingest.ts`) deep-clones or unzips
  into `data/repos/<id>/`, runs **one** `git log` pass (`src/git/runner.ts`), parses
  numstat incrementally as lines stream in (`src/git/parseGitLog.ts`), and persists a
  flat row store (`rat-log.json` + `rat-meta.json`). Every metric and filter
  (`src/metrics/engine.ts`) is aggregation over those rows — zero per-query git
  calls. Author merges persist per repo (`rat-authors.json`).
- **`client/`** — Vite + React + react-router. Dashboard, per-repo pages, directory
  drill-down, filter bar, author merge UI. All view state lives in the URL; ingestion
  progress arrives by polling, so long jobs never block the UI.

## Configuration

| Variable      | Default          | Meaning                              |
| ------------- | ---------------- | ------------------------------------ |
| `PORT`        | `3001`           | API server port                      |
| `RAT_DATA_DIR`| `<repo>/data`    | Where ingested repositories are kept |

## AI declaration

Per the test brief, this submission was produced with AI assistance:

- **Tool**: an AI coding agent in an agentic IDE (Qoder).
- **Involvement**: the agent implemented the code, tests, and documentation from an
  explicit build plan (`PLAN.md`), working ticket by ticket under the author's
  direction — reviewed, i.e. the author directed the work, checked the output
  against hand-computed fixture values, and takes full responsibility for the
  submission.

Author: Brendan Griffiths
