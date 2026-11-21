import { css } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import {
	monoXsPlain,
	noteSansMdPlain,
	noteSansSm,
	vStackGap2,
	vStackGap4,
} from '../../editorial/primitives/shared-styles';
import type { HomeGitHubActivity, HomeGitHubActivityRepoMeasure } from './contract';
import { githubEventTypeLabelJa, githubRefStateLabelJa } from './event-labels';

/**
 * GitHub activity card — the "GitHub の今" block of the home status
 * area (Issue #319, Epic #928; measured-aggregate surface per
 * Issue #967).
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
 *   - The measured block lists only repos whose contribution search
 *     RAN (`topRepos` is empty otherwise) — "not measured" renders
 *     as absence, never as a zero.
 *   - Feed items show the Japanese event-type label, the Issue/PR
 *     state and number when the snapshot carries `ref` (Issue #334),
 *     and link to the specific Issue/PR permalink — or the public
 *     repository URL when no ref exists. Nothing is fabricated when
 *     the feed is empty or a link target is unknown.
 */

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

const monoClassName = /*#__PURE__*/ css(monoXsPlain);

const linkClassName = /*#__PURE__*/ css({
	color: 'text.accent',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_hover: { textDecorationThickness: '2px' },
});

const sectionLabelClassName = /*#__PURE__*/ css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: 'medium',
	color: 'text.default',
});

const SOURCE_STATUS_LABELS: Readonly<Record<string, string>> = {
	ok: '観測中',
	unconfigured: '未接続',
	failed: '取得失敗',
};

function measureSummary(measure: HomeGitHubActivityRepoMeasure): string {
	const parts = [`コミット ${measure.commits} 件`];
	if (measure.pullRequests !== undefined) parts.push(`PR ${measure.pullRequests} 件`);
	return parts.join(' ・ ');
}

export interface GitHubActivityCardProps {
	readonly activity: HomeGitHubActivity | null;
}

export function GitHubActivityCard({ activity }: GitHubActivityCardProps) {
	if (!activity) {
		return (
			<p className={css(noteSansMdPlain)}>GitHub 活動スナップショットを読み込めませんでした。</p>
		);
	}
	const publicState = SOURCE_STATUS_LABELS[activity.sources.public.status] ?? '不明';
	const privateState = SOURCE_STATUS_LABELS[activity.sources.private.status] ?? '不明';
	return (
		<div className={css(vStackGap4)} data-testid="github-activity-card">
			<p className={css(noteSansMdPlain)}>
				公開ソース: {publicState} / 非公開ソース: {privateState} ・ 観測日{' '}
				<span className={monoClassName}>{activity.generatedOn}</span> ・ 直近 {activity.windowDays}{' '}
				日のイベント
			</p>
			{activity.topRepos.length > 0 ? (
				<div className={css(vStackGap2)}>
					<p className={sectionLabelClassName}>
						期間内の測定値（コミット / PR）・ 上位 {activity.topRepos.length} 件
					</p>
					<Stack as="ul" gap="2" className={listResetClassName}>
						{activity.topRepos.map((repo) => (
							<li key={repo.id} className={itemClassName}>
								{repo.href ? (
									<a
										href={repo.href}
										rel="noopener noreferrer"
										target="_blank"
										className={linkClassName}
									>
										{repo.name}
									</a>
								) : (
									<span>{repo.name}</span>
								)}
								<span className={mutedClassName}>{measureSummary(repo)}</span>
							</li>
						))}
					</Stack>
				</div>
			) : null}
			{activity.feed.length === 0 ? (
				<p className={mutedClassName}>直近の公開イベントはありません。</p>
			) : (
				<Stack as="ul" gap="2" className={listResetClassName}>
					{activity.feed.slice(0, 8).map((item) => {
						const ref = item.ref;
						return (
							<li key={item.id} className={itemClassName}>
								<span className={monoClassName}>{item.at.slice(0, 10)}</span>
								<span>{githubEventTypeLabelJa(item.type)}</span>
								{ref?.state ? (
									<span className={mutedClassName}>{githubRefStateLabelJa(ref.state)}</span>
								) : null}
								{ref ? <span className={mutedClassName}>{item.repoId}</span> : null}
								{item.href ? (
									<a
										href={item.href}
										rel="noopener noreferrer"
										target="_blank"
										className={linkClassName}
									>
										{ref ? `#${ref.number}` : item.repoId}
									</a>
								) : ref ? (
									<span className={mutedClassName}>#{ref.number}</span>
								) : (
									<span className={mutedClassName}>{item.repoId}</span>
								)}
							</li>
						);
					})}
				</Stack>
			)}
			<p className={css(noteSansSm)}>
				観測された公開リポジトリ {activity.repoCount.public} 件 ・ 非公開リポジトリ{' '}
				{activity.repoCount.private} 件
			</p>
		</div>
	);
}
