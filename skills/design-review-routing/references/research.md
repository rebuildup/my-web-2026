# Research: human review timing, owner decisions, and review pruning

Last reviewed: 2026-11-19
Status: trial-pending. **T3 Code で確認できる行動と、design-skills の提案ルールを区別する。**

## T3 Code — evidence from primary sources

- [AGENTS.md — Verifying](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md#verifying):
  `check:changed` は changed files の format / lint / type / nearby tests を実行。`vp test run <files>` の局所検証を推奨し、repo-wide check を普段の作業で走らせない。純粋な視覚バグは **before/after captures** を証拠にし、装飾的な不具合に UI test を無理に追加しない
- [AGENTS.md — Taste](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md#taste):
  `components/ui` ownership と lint を前提にし、**明示規則に反する必要がある場合は人間の sign-off**。この文言は全作業で human approval を要するという意味ではない
- [CONTRIBUTING.md](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md):
  review capacity が著しく限られることを明示、outside feature PR を強く制限。UI change の before/after screenshots、motion / timing の短い動画を要求。これは T3 Code 自体の contributor policy であり、他の OSS の寄稿を禁止する根拠ではない
- [UI polish PR #24776](https://github.com/pingdotgg/t3code/pull/24776):
  一部の designer feedback を token / shared primitive で改善。複数 model council の screenshot review と 1:1 crop で誤検出訂正
- [UI redesign PR #24865](https://github.com/pingdotgg/t3code/pull/24865):
  18 rounds の model critique が記録される一方、**owner calls** として blue switch accent / model logo brand color / three-line sidebar rows / canvas / read-title contrast を明記。評価点のみを正本にしない
- [UI redesign PR #24865 — Beta toggle](https://github.com/pingdotgg/t3code/pull/24865):
  大きな見た目の刷新は **Settings → Beta → New design** を off-by-default とし、従来 UI を維持できる。小さい、切り離しにくい修正はすべてに適用。人間への毎段階の承認要求ではなく、可逆的な配布と安全な選択を可能にする工夫
- [T3 Code UI consistency review](https://github.com/pingdotgg/t3code/blob/main/.macroscope/check-run-agents/ui-consistency.md):
  changed lines の obvious violations だけにレビューを限定し、screen recording・全面 repo 検査・スクリーンショット要求を静的 review agent に追加しない。reviewer の責務を絞る例

## Generalization for design-skills (not a claim about T3 Code policy)

| Decision type | Suggested first actor | When human matters | Why |
| --- | --- | --- | --- |
| spacing / variant / reusable primitive API | agent + code owner contract | 意味を変える未確定の例外のみ | reversible technical choices |
| ambiguous visual direction | agent makes cheap materially different examples | higher-cost implementation 前の consequential selection | avoid premature commitment |
| local visual defect | agent + before/after evidence | ambiguous user-visible preference if unresolved | no repeated nitpick approvals |
| multi-model disagreement | targeted evidence / 1:1 crop / re-render | product meaning / brand decision if persistent | model scores fluctuate |
| breaking / default-on redesign | flag / rollback / candidate screenshots | product acceptance before default switch, if policy requires | irreversible reach / risk |
| release candidate | fixed SHA + QA | owner's acceptance / release merge as declared | distinguish integrated vs accepted |

**No universal mandatory checkpoints**: the actual project may define stricter review / legal / safety requirements. Do not erase those. Likewise, if normal release-ticket integration is delegated, a new Skill cannot silently insert human sign-off at every PR.

## Supporting primary references

- [Base UI accessibility](https://base-ui.com/react/overview/accessibility): checked native interaction and human-readable behavior contracts; visual appearance alone is insufficient
- [Playwright screenshots](https://playwright.dev/docs/test-snapshots): consistent environment / baselines; cheap automation can cover deterministic pixel changes
- [Storybook stories](https://storybook.js.org/docs/get-started/whats-a-story): capture component states without opening every full application flow
- [Design Council — Double Diamond](https://www.designcouncil.org.uk/resources/the-double-diamond/): exploration and commitment can be separated; no mandatory fixed number of proposals
- [NN/g — Aesthetic-Usability Effect](https://www.nngroup.com/articles/aesthetic-usability-effect/): objective task usability and visual appeal cannot be collapsed into one signal

## Trial / negative controls

Use held-out briefs with: (a) routine changes where human interruption should be unnecessary; (b) brand direction ambiguous and consequential; (c) component contract conflict; (d) major reversible redesign with known rollback; (e) user-approved fixed design; (f) real-release human acceptance. Compare current workflow and candidate on:

- human requests count / necessity (avoided vs harmful suppression)
- time until useful visible artifact; wasted wait and agent rework
- important issues discovered too late
- false positives, extra review rounds, cost, preserved design intent
- whether ownership boundary and authorizations were followed

Improvement means **necessary decisions are surfaced before commitment, unnecessary approvals are pruned, and late critical misses do not increase**. Mere reduction in human messages is not evidence of quality.
