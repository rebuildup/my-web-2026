/**
 * GitHub event-type labels — the Japanese reading of the public
 * events feed `type` values (Issues #319 / #967, Epic #928).
 *
 * The snapshot carries GitHub's raw event type (`PushEvent`,
 * `PullRequestEvent`, …). Rendering it verbatim makes the reader
 * decode an API enumeration; this module owns the ONE mapping from
 * that enumeration to the short label the card prints.
 *
 * The mapping is deliberately conservative: only types whose
 * meaning is unambiguous get a Japanese label. An unknown or
 * unmapped type falls back to the raw type string — the card then
 * shows exactly what the snapshot says rather than guessing a
 * meaning the data does not carry.
 */

const EVENT_TYPE_LABELS_JA: Readonly<Record<string, string>> = {
	CommitCommentEvent: 'コミットコメント',
	CreateEvent: '作成',
	DeleteEvent: '削除',
	DeployKeyEvent: 'デプロイキー',
	DeploymentEvent: 'デプロイ',
	DeploymentStatusEvent: 'デプロイ状態',
	DownloadEvent: 'ダウンロード',
	ForkEvent: 'フォーク',
	GistEvent: 'Gist',
	GollumEvent: 'Wiki',
	IssueCommentEvent: 'Issue コメント',
	IssuesEvent: 'Issue',
	LabelEvent: 'ラベル',
	MemberEvent: 'メンバー',
	MilestoneEvent: 'マイルストーン',
	OrganizationEvent: 'Organization',
	PublicEvent: '公開',
	PullRequestEvent: 'PR',
	PullRequestReviewCommentEvent: 'PR レビューコメント',
	PullRequestReviewEvent: 'PR レビュー',
	PushEvent: 'プッシュ',
	ReleaseEvent: 'リリース',
	RepositoryEvent: 'リポジトリ',
	StatusEvent: 'ステータス',
	TeamAddEvent: 'チーム追加',
	WatchEvent: 'スター',
};

/**
 * The Japanese label for a GitHub event `type`, or the raw type
 * itself when the mapping does not know it — the fallback is the
 * value the snapshot carries, never a guessed meaning.
 */
export function githubEventTypeLabelJa(type: string): string {
	return EVENT_TYPE_LABELS_JA[type] ?? type;
}

/**
 * Issue/PR state labels (Issue #334) — the Japanese reading of the
 * `ref.state` vocabulary the snapshot contract publishes
 * (`open` / `closed` / `merged`). `merged` exists only for pull
 * requests; the generator never emits it for an issue.
 *
 * The mapping is total over the contract's enum; an out-of-contract
 * value falls back to the raw string, same rule as the event-type
 * labels — show what the data says, never a guessed meaning.
 */
const REF_STATE_LABELS_JA: Readonly<Record<string, string>> = {
	open: 'オープン',
	closed: 'クローズ',
	merged: 'マージ済み',
};

export function githubRefStateLabelJa(state: string): string {
	return REF_STATE_LABELS_JA[state] ?? state;
}
