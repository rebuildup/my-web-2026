# Verification — copy artefacts

This directory holds the committed verification artefacts of the copy
obligations.

| Artefact | Issue | What it proves |
| --- | --- | --- |
| `editorial-approval-gate.webp` | #506 | the editorial approval gate for public Japanese copy: the verdict, the three review dimensions, the extracted changed segments, the per-file classification, and the four verdicts resolved from the committed fixtures (see [`editorial-approval-gate.md`](editorial-approval-gate.md)) |
| `japanese-diff-report.webp` | #425 | the Japanese copy review-target report: the live change set, a worked before/after example with number-drift, a withheld credential-shaped line, and every status resolved from the committed fixtures (see [`japanese-diff-report.md`](japanese-diff-report.md)) |
| `meaning-diff-evaluation.webp` | #426 | the meaning-diff corpus evaluation: every proposal pair with the classification the gate gave it (meaning / surface / disposition), the evidence code behind each verdict, and the empty auto-apply vocabulary (see [`meaning-diff-evaluation.md`](meaning-diff-evaluation.md)) |

## 公開日本語の編集レビュー承認 (Issue #506)

`editorial-approval-gate.webp` is the committed screenshot of the gate
report for the public Japanese copy editorial approval gate. It shows
the **live** verdict for the current change set (including which
changed files were treated as public copy, and why every other file was
out of scope) and the **fixture matrix**: the four verdicts the gate can
print, each produced by a committed fixture under
`test/fixtures/copy/editorial-approval/`.

The image is **not** a substitute for the tests: the four states are
asserted by `scripts/check-copy-editorial-approval.test.mjs`. The
report, the acceptance-criteria mapping and the out-of-scope list are
in [`editorial-approval-gate.md`](editorial-approval-gate.md); the
operator procedure is in
[`docs/runbook/copy-editorial-approval.md`](../../runbook/copy-editorial-approval.md).

## 日本語 copy のレビュー対象レポート (Issue #425)

`japanese-diff-report.webp` is the committed screenshot of the Japanese
copy review-target report. It shows the **live** change set (including
which files were article / About / UI targets and why every other file
was out of scope), a **worked example** rendered from fixtures (a
before/after row with `number-drift` and a withheld credential-shaped
line), and the **fixture matrix**: every status the collector can print.

The report is **informational**: `clear`, `review` and `attention` all
exit 0, and the blocking owner-approval decision stays with Issue #506.
The image is **not** a substitute for the tests: the statuses and the
extraction rules are asserted by
`scripts/collect-japanese-copy-review.test.mjs`. The operator procedure
is in [`docs/runbook/japanese-copy-review.md`](../../runbook/japanese-copy-review.md);
the acceptance-criteria mapping and the out-of-scope list are in
[`japanese-diff-report.md`](japanese-diff-report.md).

## 意味差分（意味保持）の評価レポート (Issue #426)

`meaning-diff-evaluation.webp` is the committed screenshot of the
meaning-diff corpus evaluation. It shows every proposal pair in
`test/fixtures/copy/meaning-diff/corpus.json` with the classification
the gate gave it — the meaning axis (a claim is a number, a negation or
a permission marker), the surface axis (a mechanical typography
difference vs. a prose difference no rule decides) and the disposition
— plus the evidence code behind each verdict and the locale opt-in
state.

The report is the **presentation** of the gate, not a second verdict:
`scripts/make-copy-meaning-diff-report.mjs` renders what
`scripts/check-copy-meaning-diff.mjs` decided, using the gate's own
`renderHtml` / `renderText`. The rule Issue #426 states — a proposal is
never adopted automatically — is a type in the gate (the list of
auto-appliable dispositions is empty), and the report shows the count
of auto-appliable cases beside it.

The image is **not** a substitute for the tests: the classification is
asserted by `scripts/check-copy-meaning-diff.test.mjs` and the report by
`scripts/make-copy-meaning-diff-report.test.mjs`. The record is in
[`meaning-diff-evaluation.md`](meaning-diff-evaluation.md).

## How to reproduce it

```sh
# 1. render the report from the working tree
pnpm run copy:approval:check -- --base=release-0-7-0 --format=html \
  --out=.tmp/copy-editorial-approval.html

# 2. screenshot it into docs/verification/copy/editorial-approval-gate.webp
pnpm run verify:copy-editorial-approval-screenshot -- --base=origin/release-0-7-0

# 3. render and screenshot the Japanese copy review-target report
pnpm run copy:diff:report -- --base=release-0-7-0 --format=html \
  --out=.tmp/japanese-copy-review-report.html
pnpm run verify:copy-diff-report-screenshot -- --base=origin/release-0-7-0

# 4. render and screenshot the meaning-diff corpus evaluation
pnpm run copy:meaning:check -- --format=html \
  --out=.tmp/copy-meaning-diff.html
pnpm run verify:copy-meaning-diff-screenshot
```

Step 1 writes `.tmp/copy-editorial-approval.html` (gitignored). Step 2
renders that document in headless Chromium and writes the WebP. The
intermediate PNG stays in memory and is never committed; the capture
fails if the WebP exceeds 300 KB.

## Why a committed binary

The repository's usual convention is that verification screenshots stay
outside the tree. Issues #506 and #425 ask for their evidence to be
visible in the pull request, so the artefacts are committed — as WebP
rather than the PNG the Issues name, because the PNG is several times
larger for no gain at documentation scale. Every capture script fails
when the WebP exceeds 300 KB, so an artefact cannot silently bloat the
repository.
