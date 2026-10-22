/**
 * Visitor-facing copy for an unavailable project source.
 *
 * The sync writes a closed reason vocabulary. The page must not collapse
 * every reason into "the repository is not public": a transient GitHub
 * failure never reaches this state (it writes nothing), but a changed
 * default branch or an unparsable README is still not the same fact as
 * a repository that stopped being public.
 */

const NOT_PUBLIC =
	'上流リポジトリが現在公開されていないため、最後に確認できた内容を表示しています。最新の内容ではありません。';

const NOT_CURRENT_SUFFIX = '最後に確認できた内容を表示しています。最新の内容ではありません。';

const NOTICE: Readonly<Record<string, string>> = {
	'not-found': NOT_PUBLIC,
	'not-public': NOT_PUBLIC,
	archived: `上流リポジトリがアーカイブされたため、${NOT_CURRENT_SUFFIX}`,
	'ref-mismatch': `上流の既定ブランチが変わったため、${NOT_CURRENT_SUFFIX}`,
	'readme-shape': `上流 README の構成が変わり、紹介を生成できなかったため、${NOT_CURRENT_SUFFIX}`,
};

const LABEL: Readonly<Record<string, string>> = {
	'not-found': '上流リポジトリが見つからない',
	'not-public': '上流リポジトリが公開されていない',
	archived: '上流リポジトリがアーカイブ済み',
	'ref-mismatch': '上流の既定ブランチが変わった',
	'readme-shape': 'README の構成を解釈できない',
};

/** The note under the freshness mark for an unavailable snapshot. */
export function unavailableNotice(reason: string | null): string {
	return (
		(reason ? NOTICE[reason] : undefined) ??
		`上流の現在の状態を確認できなかったため、${NOT_CURRENT_SUFFIX}`
	);
}

/** A short reason label for the provenance list. */
export function unavailableReasonLabel(reason: string | null): string {
	return (reason ? LABEL[reason] : undefined) ?? '理由を特定できない';
}

/** The provenance `availability` cell. */
export function availabilityLabel(reason: string | null): string {
	return reason ? `unavailable — ${unavailableReasonLabel(reason)}` : 'unavailable';
}
