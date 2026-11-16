import { css } from '../../../styled-system/css';
import type { HomeGitHubActivity } from './contract';

/**
 * GitHub activity card — the "GitHub の今" block of the home status
 * area (Issue #319, Epic #928).
 *
 * Honest-state rules
 * ------------------
 *   - `sources.public.status` says whether the generator reached
 *     GitHub; `unconfigured` / `failed` render as such — never as
 *     "no activity".
 *   - `generatedOn` is the observation date and is always printed;
 *     the card never claims to be fresher than the snapshot.
 *   - Private-source state is reported as a COUNT-FREE status word
 *     (未接続 / 観測中) — anonymous project rows live in the projects
 *     section, not here.
 *   - Feed items link only to public repo URLs carried by the
 *     snapshot; nothing is fabricated when the feed is empty.
 */

const listClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

const itemClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.5',
});

const mutedClassName = /*#__PURE__*/ css({
	color: 'text.muted',
});

const monoClassName = /*#__PURE__*/ css({
	fontFamily: 'mono',
	fontSize: 'xs',
});

const SOURCE_STATUS_LABELS: Readonly<Record<string, string>> = {
	ok: '観測中',
	unconfigured: '未接続',
	failed: '取得失敗',
};

export interface GitHubActivityCardProps {
	readonly activity: HomeGitHubActivity | null;
}

export function GitHubActivityCard({ activity }: GitHubActivityCardProps) {
	if (!activity) {
		return (
			<p className={css({ margin: '0', fontFamily: 'sans', fontSize: 'md', color: 'text.muted' })}>
				GitHub 活動スナップショットを読み込めませんでした。
			</p>
		);
	}
	const publicState = SOURCE_STATUS_LABELS[activity.sources.public.status] ?? '不明';
	const privateState = SOURCE_STATUS_LABELS[activity.sources.private.status] ?? '不明';
	return (
		<div
			className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
			data-testid="github-activity-card"
		>
			<p className={css({ margin: '0', fontFamily: 'sans', fontSize: 'md', color: 'text.muted' })}>
				公開ソース: {publicState} / 非公開ソース（匿名）: {privateState} ・ 観測日{' '}
				<span className={monoClassName}>{activity.generatedOn}</span> ・ 直近 {activity.windowDays}{' '}
				日のイベント
			</p>
			{activity.feed.length === 0 ? (
				<p className={mutedClassName}>直近の公開イベントはありません。</p>
			) : (
				<ul className={listClassName}>
					{activity.feed.slice(0, 8).map((item) => (
						<li key={item.id} className={itemClassName}>
							<span className={monoClassName}>{item.at.slice(0, 10)}</span>
							<span>{item.type}</span>
							<span className={mutedClassName}>{item.repoId}</span>
						</li>
					))}
				</ul>
			)}
			<p className={css({ margin: '0', fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
				観測された公開リポジトリ {activity.repoCount.public} 件 ・ 非公開（匿名）{' '}
				{activity.repoCount.private} 件
			</p>
		</div>
	);
}
