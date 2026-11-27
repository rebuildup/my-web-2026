---
name: design-review-routing
description: >
  Use to choose when AI agents, deterministic checks, independent reviewers,
  and humans should evaluate a design change. Keeps routine implementation
  autonomous while escalating unresolved high-impact choices and release acceptance.
---

# Design Review Routing

「人間の目で確認した方が良い」をすべての小さな作業の停止条件にしない。**判断の責務・影響・可逆性・情報の不足・レビューの費用**で、いつ誰が何を検証するか決める。UI / 2D visual artifact の設計・制作・レビューに適用するが、各 project の明示的な権限境界・release process を上書きしない。

T3 Code に確認できる実例は、`check:changed` の scoped check、純粋な視覚バグへの before/after capture、変更禁止ルールへの owner sign-off、UI刷新の Beta toggle と owner decisions である。**以下の review routing matrix 全体が T3 Code の公式制度なのではなく、それらを基にした design-skills の運用設計**。

## 1. Start from current authority

最初に user request、product Spec / ADR、approved design brief、existing components、release / acceptance policy、feedback owner を確認する。誰かが既に決めたことを「確認が必要」として返さない。

- Agent が既存正本から導ける **routine / reversible** decision は自律判断
- AI reviewer は observed defects と competing hypotheses の発見担当。美観や brand を最終決定しない
- **Human** は未確定の product semantics、表現・ブランドの consequential choice、避けられない policy exception、権限上の受入判断を保持
- **Deterministic validation** は確定した contract の履行を確認する。何を訴求するかを決めない

Human review と human **approval** は異なる。画像に感想をもらうことだけで merge・release・公開の承認にはしない。

## 2. Choose the checkpoint, not a universal approval chain

| Situation | Default route | Human involvement |
| --- | --- | --- |
| 狭い component 修正 / approved variant の利用 | agent 実装 → scoped type/lint/test → 関連証拠 | 原則不要 |
| 既存 UI の局所 polish | 変更前後 screenshot + focused critique → 修正 | 明白な仕様逸脱・解釈不一致でなければ不要 |
| 新しい primitive / token role | reference / state contract を作り agent が試作・確認 | shared design language の意味を変え、既存仕様から決まらないときだけ |
| 未確定の brand / 情報構造 / 重要な体験 | 低コストの materially different prototypes を実物化 → 比較 | **高い実装コストに入る前に** product-level direction を判断してもらう |
| 大規模だが可逆的な redesign | controlled beta / feature flag / rollback + image / interaction evidence | 公開面を既定化する前の必要な product acceptance |
| 重大な rule conflict / 不可逆または高リスクの公開・操作 | 証拠と代替案を提示し、権限がなければ止める | 該当操作の前に必須 |
| Release candidate / freeze | 固定 SHA に対する代表 state、cross-surface、functional / visual QA | project に定義された受入・`release → main` の承認境界で実施 |

通常の ticket 統合を毎回 human visual sign-off まで止めない。重い screenshot matrix、実機、E2E をすべての小変更の完了条件にしない。必要な検証が高コストなら RC に集約し、**新しい primitive や大規模変化の誤方向だけ**影響面で早期 capture する。

## 3. Decide whether to interrupt the human

エスカレーションの前に確認する。

1. **既に決まっているか？** user / Spec / ADR / brief / accepted artifact を再確認。決定済みなら進める
2. **人間にしかできない選択か？** 目的・内容・brand・ユーザー体験の意味が変わるのか。通常の geometry / API / selector は agent が決める
3. **今聞く必要があるか？** 安い prototype / reversible implementation で探索できるなら先に実物化。実装後でも安全に戻せるなら途中で止めない
4. **判断の証拠はあるか？** 本物の render / playback、異なる構造の選択肢と具体的な trade-off。スコアや感想だけを理由にしない
5. **本当にブロックか？** 独立した他の作業を止めない。不可逆 / 公式承認 / 安全上の boundary だけ対象操作を保留する

routine 事項についてユーザーへの無限確認ループを作らない。高影響の未確定案は、説明文だけではなく可能な限り並べられる小さい実物を示す。

## 4. Route the right form of evidence

- **Code / contract:** primitive reuse、token roles、lint、typed API、behavior test
- **Visual:** screenshot / before-after / 1:1 crop、同条件の baseline、state / responsive / theme
- **Interaction:** keyboard、focus、scroll、cancel / reopen、playback / real device の必要条件
- **First impression / design taste:** blind / cold reviewer（独立可能な場合）→ 目的開示後の適合評価。score を truth にしない
- **Human acceptance:** unreviewed product decision、preferred direction、必要な launch / release approval。AI の「9/10」は置換不可

reviewer が見えなかった、未実機、未試験を PASS として扱わない。大きなデザイン変更の evidence を残す場合も、public GitHub へ private content や秘密を載せない。

## 5. Prune unnecessary reviews

品質が定着した後は gate を増やし続けない。

- 同じ問題を lint / unit / browser / screenshot / human が重複判定していれば、**最も低コストで同じ failure を検出する stage** に集約
- 同じ指摘が明確に static contract 化できるなら、human の毎回の反復確認を減らす
- design intent / audience の正当な判断は lint へ移管しない
- test や screenshot の対象を changed impact と release candidate の2段階で分ける
- broad image council は重大な変更・意見不一致・高価な誤判断に選択的に使う。常時複数 reviewer を必須にしない
- 漫然と繰り返す美観採点は停止。重大 defect の収束、決定に必要な evidence、cost / diminishing returns を確認して終える

既存の明示的な required check / reviewer / 承認権限を勝手に削除しない。変更が必要なら current policy / CI / workflow の修正対象として明示する。

## 6. Produce actionable escalation only when needed

必要な human request は次の最小情報だけをまとめる。

```text
Decision still unresolved:
Why existing authority cannot decide it:
Option A / Option B (render or concrete artifact):
Consequences for purpose / brand / UX / rollback:
When the decision is actually needed:
Independent work proceeding meanwhile:
```

通常の報告は `agent decided`、`automatic checks performed`、`visual evidence reviewed`、`human decision needed`、`RC acceptance pending` を分ける。各段階をひとつの曖昧な「完了」にしない。

## References and trial status

[Research: human review timing and pruning](./references/research.md) では T3 Code の **実際の事実** と本 Skill への **一般化提案** を分ける。**trial-pending**：同一課題の human interruptions、defects caught too late、rework、cost、決定の満足度と権限違反を評価する。
