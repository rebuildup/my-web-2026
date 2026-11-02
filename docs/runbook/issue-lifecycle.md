# Runbook — Issue lifecycle and closure evidence

**Owner:** repository owner (`rebuildup`) for every decision that changes
what the public surface shows.
**Scope:** every GitHub Issue in `rebuildup/my-web-2026`, from idea to
closure.

This runbook exists because of an incident, not because a process needed
tidying. On **2026-10-31** an automated backlog sweep closed **132 issues**
with `state_reason: completed`. **124 of them** carried the identical
comment:

> 回収完了。release-0-8-0統合完了（#679待機中）。

That sentence is about the **release branch**, not about the issue's own
acceptance criteria. Because the sweep was allowed to treat "merged into
the release branch" as "the original goal was achieved", ideas that were
never built — the Codex pet, the 「現在地」 Home surface, the Notion CMS,
the activity timeline — left the backlog exactly like shipped features
did. The damage was not one wrong close; it was that **"done" stopped
meaning one thing**, so an idea could no longer be told apart from a
delivered feature.

---

## 1. The states a closed issue may be in

A closed issue is in **exactly one** of these states, and the state is
written down in `quality/issue-closure-ledger.json`.

| State | Meaning | What it requires |
| --- | --- | --- |
| `implemented-and-verified` | The acceptance criteria are met by shipped code or content. | Evidence a reader can open: a repository path, a pull request, a commit, a URL. |
| `partial` | Part of the acceptance is met. | Evidence, **and** a statement of what is missing. |
| `research-complete-with-decision` | A spike whose deliverable is a finding or an adopt / reject decision. | The finding or decision document, **and** a written reason. |
| `planned-unimplemented` | The idea is specified; nothing is built. | A reason it is still wanted (or a successor). |
| `deferred-with-reason` | Deliberately postponed. | A written reason. |
| `explicitly-rejected-with-reason` | Deliberately declined. | A written reason. |
| `unassessed` | Nobody checked. | Nothing — but it is **not** a completion, and the issue is not closed as completed. |
| `private-not-exported` | The issue concerns material that must not be published here. | Nothing. The content is not quoted anywhere. |

`private-not-exported` exists so that "we decided not to publish this"
does not have to be spelled out publicly.

## 2. What may close an issue

**Completion requires evidence.** A pull request being merged, a CI run
being green, a document being written, a release integration, or an
agent's own report are **not** evidence that the original goal was
reached. Evidence is the artefact that satisfies the issue's own
acceptance criteria, and it must be citable by path, PR, commit or URL.

**Release integration is not completion.** A change being present in
`release-x-y-z` says that the change shipped. It says nothing about
whether the issue's goal was met.

**An idea is a legitimate state.** "Planned-unimplemented" is a real,
acceptable state for a good idea. The failure is not leaving an idea
open; the failure is losing it.

## 3. What may not be used as a goal

- **Issue counts.** The number of closed issues is not a metric, not a
  target, and not a report line. A sweep that closes many issues at once
  is a defect signal, not progress.
- **An agent's own completion report.** An agent may record what it did;
  it may not certify that the goal was reached. A record written by an
  agent is marked `recordedBy: "agent"` and stays
  `ownerConfirmation: "unconfirmed"` until an owner artefact points at
  it (a review, an issue comment, a decision record).
- **A template comment.** The same comment on many issues is evidence of
  a script, not of a review. `scripts/check-issue-closure.mjs` refuses it
  as evidence (rule `E006`).

## 4. The mechanism

### 4.1 The ledger — `quality/issue-closure-ledger.json`

One entry per closed issue the repository knows about:

```jsonc
{
  "issue": 274,
  "title": "feat: Codex ペットのキャラクターとアニメーションを Web でも再利用する",
  "closedAt": "2026-10-31",
  "window": "sweep-2026-10-31",
  "state": "planned-unimplemented",
  "closure": "unsupported",
  "evidence": ["docs/personal/codex-pet.md"],
  "decision": null,
  "recordedBy": "agent",
  "ownerConfirmation": "unconfirmed",
  "ownerReference": null,
  "action": "reopened"
}
```

- `closure` is the verdict on the **original** close: `supported`,
  `unsupported` (the close was not justified) or `awaiting-owner`.
- `action` is what happened to the issue afterwards: `kept-closed`,
  `reopened`, or `awaiting-owner`.
- `decision` carries `kind` and `reason` for the states that need one.
- `window` names the audit window that covers `closedAt`.

The windows are declared once in `audit.windows` (Issue #815). A window
is a date range plus the population it covers:

| Window | Range | Population | Meaning |
| --- | --- | --- | --- |
| `sweep-2026-10-31` | 2026-10-31 〜 2026-10-31 | `132`（**frozen**） | 一括 close の履歴。この件数は動かさない。 |
| `tracked` | 2026-11-01 〜 open | `null`（**derived**） | 以後の close をすべて記録する窓。母集団は要素数から導出する。 |

`population` が整数の窓は **frozen**: その窓に属する entry の数が一致
しなければ `R005`（error）になる。2026-10-31 の 132 件を黙って削ることも
水増しすることもできない。`population` が `null` の窓は **derived**: 母集団は
その窓に属する entry そのものなので、新しい close を足しても件数の
更新は要らない。ただし窓には日付範囲があり、`closedAt` がその範囲外の
entry は `R005` になる。

### 4.2 The offline gate — `pnpm run issue:closure:check`

`scripts/check-issue-closure.mjs` reads the ledger and checks that every
entry carries a state from the vocabulary, evidence that a reader can
open, a written reason where the state needs one, a truthful author
mark, and no contradiction between `closure` and `state`. It prints
**counts by state**, never a score.

It is part of `validate:fast` because it is offline and read-only.

### 4.3 The remote audit — `pnpm run issue:closure:audit`

`scripts/check-issue-closure-remote.mjs` asks GitHub which issues were
closed in a window and reports every closure that carries **neither a
ledger entry nor a trace** (rule `R001`), plus every mass closure that
used the release-branch template (rule `R006`). It also checks that the
ledger and GitHub agree about each tracked issue's current state
(`R002` / `R003`), that every ledger entry is readable (`R004`), and
that the ledger's windows and its entries agree (`R005`): every entry
names a declared window, its `closedAt` falls inside that window, a
frozen window carries exactly its declared population, and windows do
not overlap. A derived window has no frozen count, so a new close can be
recorded without turning the gate red — but it still cannot be parked
outside the window's dates.

A **trace** is a commit that referenced the issue, or a comment that
names an artefact (a PR, a commit, a URL) or records an explicit
decision (a hold, a rejection, a duplicate, a deferral). A bare
pull-request reference is **not** a trace: "the PR was merged" does not
prove the issue's goal was reached. The release-branch template is not
a trace either.

It needs the network, so it runs as a CI step — the same arrangement as
the dependency advisory gate (AGENTS.md §5). A GitHub outage is exit 2
("unusable input"), never a clean bill of health.

**This is the half that would have caught 2026-10-31.** The sweep wrote
no repository record at all, so a repository-only gate would have stayed
green through it.

## 5. Closing an issue, step by step

1. **Read the issue's acceptance criteria.** Not its title.
2. **Find the evidence.** The artefact that satisfies those criteria. If
   none exists, the issue is not complete — it may still be closed, but
   its state is `planned-unimplemented` / `partial` / `unassessed`, and
   the reason is written down.
3. **Record the entry** in `quality/issue-closure-ledger.json`.
   - **Choose the window that covers `closedAt`.** Any close from
     2026-11-01 on goes in `tracked`; a repair of the 2026-10-31 history
     goes in `sweep-2026-10-31`. The `closedAt` you write must fall
     inside that window's dates.
   - **Never edit a frozen window's `population`** to match a changed
     entry count, and never re-date an entry to fit a window. The frozen
     number is the history the audit exists to preserve; a mismatch is
     the finding, not the thing to silence.
   - **Leave `ownerConfirmation: "unconfirmed"`** unless a traceable
     owner artefact (a review, an issue comment, a decision record)
     points at the entry, and then set `ownerReference` to its URL.
4. **Run** `pnpm run issue:closure:check`. With a token, also run
   `pnpm run issue:closure:audit` to check the ledger against GitHub
   before pushing.
5. **Close the issue** with a comment that states the evidence and the
   state — not a template. The comment must name the artefact or the
   decision, because that is the trace the remote gate looks for; a
   comment that only says the release branch was integrated is the
   2026-10-31 shape.

When a sweep is genuinely warranted (a milestone that really did land),
the sweep still has to write one ledger entry per issue, each with its
own evidence. A sweep that writes one comment for many issues is the
incident described above.

## 6. Recovering a wrongly closed issue

1. Add or correct the ledger entry (`closure: "unsupported"`, the real
   `state`, the evidence that was missing).
2. Reopen the issue with a comment naming the original goal and what is
   missing — do not delete the original body or the original close
   comment.
3. If a later issue already tracks the goal, keep the original closed,
   link the two in both directions, and record
   `action: "kept-closed"` with the successor in `evidence`.
4. If the goal needs an owner decision (public surface, brand, cost,
   privacy), set `closure: "awaiting-owner"` and do **not** decide it.

## 7. Related

- `docs/verification/backlog/closure-audit-2026-10-31.md` — the audit of
  the 2026-10-31 sweep, per issue.
- `docs/verification/backlog/closure-window-2026-11-02.md` — why the audit
  window was redefined (Issue #815), with before / after gate verdicts.
- `scripts/check-issue-closure.mjs` / `scripts/check-issue-closure-remote.mjs`
  — the two gates.
- `quality/issue-closure-ledger.json` — the record.
- AGENTS.md §6 — the project-level rule this runbook implements.
- `skills/github-delivery/SKILL.md` — the delivery procedure this rule
  constrains.
