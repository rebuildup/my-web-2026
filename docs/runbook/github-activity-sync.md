# GitHub activity snapshot sync (Issues #316 / #319 / #932)

Runbook for keeping `src/home/activity/github-activity.json` — the
committed snapshot the home "現在地" sections read — fresh, including
the anonymised private-repository half.

## Why operator-side, not CI

The private half needs two credentials:

- `GITHUB_TOKEN` — a PAT that can read the owner's **private**
  repositories (`repo` scope).
- `GITHUB_ACTIVITY_SALT` — the HMAC salt behind the stable
  `private-<hmac12>` anonymous ids. Changing it re-ids every private
  project on the page.

`quality/actions-pins.json` approves **zero** repository-secret
references by policy: runtime credentials are Infisical-owned and a
CI step that can read them would be a new credential path, not a
convenience. The auto-update is therefore an operator-side scheduled
job with secrets injected by `infisical run` into that process only.

## Secrets (Infisical `dev` environment)

| Name | Content |
|---|---|
| `GITHUB_TOKEN` | PAT with `repo` scope (fine-grained PAT scoped to the owner's repos also works) |
| `GITHUB_ACTIVITY_SALT` | Random salt, e.g. `openssl rand -hex 32`. **Generate once, never rotate** — rotation changes every private-anon id. |

Store both in the self-hosted Infisical (`https://secrets.rebuildup.dev`,
project `d4c2fc09-…`, env `dev`). Never write them to `.env` files or
the repository.

## Running

```sh
# refresh only (writes the snapshot in the current checkout)
infisical run --env=dev -- pnpm run activity:sync
infisical run --env=dev -- pnpm run activity:check   # privacy/shape gate

# full publish: temp worktree → sync → check → commit → push → PR
infisical run --env=dev -- pnpm run activity:publish
infisical run --env=dev -- pnpm run activity:publish -- --dry-run
infisical run --env=dev -- pnpm run activity:publish -- --base release-0-9-0
```

`activity:publish` never touches the caller's checkout: it creates a
throwaway `git worktree` on branch `github-activity-sync` from
`origin/<base>`, regenerates the snapshot there, validates it, and
only commits+pushes when the content changed. It opens (or updates)
a review PR against `<base>` and never merges, tags or deploys.
Without `GITHUB_TOKEN` the private source stays `unconfigured` — the
script still works, it just publishes the public half.

## Scheduling

A daily run is enough — the page presents the snapshot's own
`generatedOn`/`observedAt`, so staleness is visible rather than
hidden. Example launchd/cron entry (adjust paths):

```sh
infisical run --env=dev -- pnpm run activity:publish
```

The publish step is idempotent: unchanged snapshots produce no
commit and no PR noise.

## Privacy contract

- Private repos are reduced to `{ id: 'private-<hmac12>', kind,
  name: '非公開プロジェクト', lastActiveAt?, activity }` **before**
  serialisation — the serializer builds private entries
  field-by-field and never spreads upstream data.
- `check-github-activity.mjs` re-verifies the committed artifact:
  private entries may carry only the anonymous allowlist, ids must
  match `private-[0-9a-f]{12}`, feed entries are public-only.
- The salt and token are never written to the snapshot, logs or the
  repository.

## Failure modes

| Condition | Behaviour |
|---|---|
| GitHub API error / rate limit | sync exits 1, writes nothing; last good snapshot stays |
| `GITHUB_TOKEN` unset | private source `unconfigured`; public half still publishes |
| `GITHUB_ACTIVITY_SALT` unset | anon ids derive from `unset-salt` — **set it before first private publish** |
| Snapshot fails `activity:check` | publish aborts before commit; nothing pushed |
| Base ref missing | publish exits with a pointer to `--base` |
