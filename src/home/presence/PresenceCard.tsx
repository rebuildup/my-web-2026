/**
 * Discord Presence — PresenceCard display component.
 *
 * Renders the owner's Discord presence as a status card in the home
 * status section. Degrades cleanly when no snapshot is available.
 */

import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { StateMark } from '../../editorial/primitives/StateMark';
import {
	COMPUTER_PATH,
	EMOTICONS_PATH,
	HEADPHONES_PATH,
	LIVE_TV_PATH,
	PERSON_PATH,
	PHONE_ANDROID_PATH,
	SPORTS_ESPORTS_PATH,
	TV_PATH,
	VIDEOGAME_ASSET_PATH,
} from '../../editorial/primitives/material-symbol-paths';
import { rowWrapGap3, vStackGap4 } from '../../editorial/primitives/shared-styles';
import type { HomeLocale } from '../format';
import { createHomeFormat } from '../format';
import type { DiscordPresenceCard } from './types';

export interface PresenceCardProps {
	card: DiscordPresenceCard;
	/**
	 * Opt-in locale for the observed-at instant (Issue #430). Defaults
	 * to `'en'`.
	 */
	locale?: HomeLocale;
	/**
	 * IANA time zone the snapshot is read in. Defaults to `'UTC'`.
	 */
	timeZone?: string;
	/**
	 * Whether the component renders its own `<section>` chrome.
	 * Default: 'body' (renders inside a parent SectionHeading).
	 */
	chrome?: 'section' | 'body';
	/**
	 * Id of the section heading, so a page that renders the section
	 * twice (the verification gallery does) keeps the ids unique.
	 */
	headingId?: string;
}

const PRESENCE_DESCRIPTION =
	'Discordの本人プレゼンス / アクティビティ / リッチプレゼンス / カスタムステータス。運営者が実行するスクリプトで生成された確定スナップショットのみを表示。スナップショットが存在しない / 期限切れ / 検証失敗の場合は「未取得」として安全にデグレードします。';

const descriptionClassName = /*#__PURE__*/ css({
	margin: '0',
	marginBlockEnd: '6',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
	textWrap: 'pretty',
});

const cardClassName = /*#__PURE__*/ css(vStackGap4);

const statusRowClassName = /*#__PURE__*/ css(rowWrapGap3);

const customStatusClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	padding: '3',
	backgroundColor: 'bg.subtle',
	borderRadius: 'md',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.5',
	color: 'text.default',
});

const customStatusEmojiClassName = /*#__PURE__*/ css({
	fontSize: 'lg',
	lineHeight: '1',
});

const activityClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	padding: '3',
	backgroundColor: 'bg.subtle',
	borderRadius: 'md',
});

const activityHeaderClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
});

const activityTypeIconClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: '18px',
	height: '18px',
	color: 'text.muted',
});

const activityDetailsClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.5',
});

const activityStateClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.subtle',
	lineHeight: '1.5',
});

const additionalActivitiesClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	marginBlockStart: '2',
});

const additionalActivityClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	padding: '2',
	backgroundColor: 'bg.subtle',
	borderRadius: 'sm',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.default',
});

const freshnessClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	marginBlockStart: '3',
	paddingBlockStart: '3',
	borderTopWidth: '1px',
	borderTopStyle: 'solid',
	borderTopColor: 'border.subtle',
	fontFamily: 'sans',
	fontSize: 'xs',
	color: 'text.subtle',
});

const unavailableClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	padding: '3',
	backgroundColor: 'bg.subtle',
	borderRadius: 'md',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
});

function getActivityIcon(type: number) {
	switch (type) {
		case 0:
			return VIDEOGAME_ASSET_PATH; // Game
		case 1:
			return LIVE_TV_PATH; // Streaming
		case 2:
			return HEADPHONES_PATH; // Listening
		case 3:
			return TV_PATH; // Watching
		case 4:
			return EMOTICONS_PATH; // Custom
		case 5:
			return SPORTS_ESPORTS_PATH; // Competing
		default:
			return COMPUTER_PATH;
	}
}

function getClientIcon(client?: string) {
	switch (client?.toLowerCase()) {
		case 'mobile':
			return PHONE_ANDROID_PATH;
		case 'web':
			return COMPUTER_PATH;
		default:
			return COMPUTER_PATH;
	}
}

/**
 * PresenceCard — renders the Discord presence card.
 * When card.available is false, renders an "unavailable" state.
 */
export function PresenceCard({
	card,
	locale,
	timeZone,
	chrome = 'body',
	headingId = 'discord-presence-heading',
}: PresenceCardProps) {
	const format = createHomeFormat({ locale: locale ?? 'en', timeZone: timeZone ?? 'UTC' });

	if (!card.available) {
		const content = (
			<div className={unavailableClassName}>
				<MaterialSymbol d={PERSON_PATH} size={20} />
				<span>Discordプレゼンス: 未取得 (スナップショットが存在しないか、期限切れ/検証失敗)</span>
			</div>
		);

		if (chrome === 'section') {
			return (
				<PageSection labelledBy={headingId}>
					<SectionHeading
						id={headingId}
						eyebrow="Discord"
						title="Discord プレゼンス"
						titleEn="Discord Presence"
						description={PRESENCE_DESCRIPTION}
						variant="spread"
					>
						{content}
					</SectionHeading>
				</PageSection>
			);
		}

		return (
			<div>
				<h3
					id={headingId}
					className={css({
						margin: '0',
						marginBlockEnd: '4',
						fontFamily: 'sans',
						fontSize: 'xl',
						fontWeight: '700',
						lineHeight: '1.25',
						letterSpacing: '-0.015em',
						color: 'text.default',
						textWrap: 'balance',
					})}
				>
					Discord プレゼンス
				</h3>
				<p className={descriptionClassName}>{PRESENCE_DESCRIPTION}</p>
				{content}
			</div>
		);
	}

	// Format the generatedAt for display
	const generatedAtDate = new Date(card.freshness.generatedAt);
	const observedAtFormatted = format.formatRelative(generatedAtDate.getTime());
	const observedAtAbsolute = format.formatDateTime(generatedAtDate);

	const statusBadge = <Badge tone={card.statusTone}>{card.statusLabel}</Badge>;

	const customStatusContent = card.customStatus ? (
		<div className={customStatusClassName}>
			{card.customStatus.emoji && (
				<span className={customStatusEmojiClassName} aria-hidden="true">
					{card.customStatus.emoji}
				</span>
			)}
			<span>{card.customStatus.text}</span>
			{card.customStatus.expiresAt && (
				<span aria-label={`Expires at ${card.customStatus.expiresAt}`}>
					{' '}
					<MaterialSymbol d={PHONE_ANDROID_PATH} size={14} />
				</span>
			)}
		</div>
	) : null;

	const primaryActivityContent = card.primaryActivity ? (
		<div className={activityClassName}>
			<div className={activityHeaderClassName}>
				<MaterialSymbol
					d={getActivityIcon(card.primaryActivity.name === 'Spotify' ? 2 : 0)}
					size={18}
					className={activityTypeIconClassName}
					aria-hidden="true"
				/>
				<span>
					{card.primaryActivity.typeLabel}: {card.primaryActivity.name}
				</span>
			</div>
			{card.primaryActivity.details && (
				<div className={activityDetailsClassName}>{card.primaryActivity.details}</div>
			)}
			{card.primaryActivity.state && (
				<div className={activityStateClassName}>{card.primaryActivity.state}</div>
			)}
			{card.primaryActivity.timestamps?.start && (
				<div className={activityStateClassName}>
					Started {format.formatRelative(new Date(card.primaryActivity.timestamps.start).getTime())}
				</div>
			)}
		</div>
	) : null;

	const additionalActivitiesContent =
		card.additionalActivities.length > 0 ? (
			<div className={additionalActivitiesClassName}>
				{card.additionalActivities.slice(0, 4).map((activity, index) => (
					<div
						key={`${activity.typeLabel}-${activity.name}-${index}`}
						className={additionalActivityClassName}
					>
						<MaterialSymbol
							d={getActivityIcon(activity.name === 'Spotify' ? 2 : 0)}
							size={16}
							aria-hidden="true"
						/>
						<span>
							<strong>{activity.typeLabel}:</strong> {activity.name}
							{activity.details && (
								<span>
									{' — '}
									{activity.details}
								</span>
							)}
							{activity.state && (
								<span>
									{' — '}
									{activity.state}
								</span>
							)}
						</span>
					</div>
				))}
				{/* Render limit: a Discord profile lists a handful of
				    activities at most; the slice above keeps the card a
				    summary — the profile itself owns the full list. */}
			</div>
		) : null;

	const freshnessContent = (
		<div className={freshnessClassName}>
			<StateMark
				kind={card.freshness.isStale ? 'unobserved' : card.freshness.isLive ? 'ok' : 'unreachable'}
				size="sm"
			/>
			<span>
				観測: {observedAtFormatted} ({observedAtAbsolute}){card.freshness.isLive && ' · ライブ接続'}
				{card.freshness.isStale && ' · 古いスナップショット'}
			</span>
		</div>
	);

	const cardContent = (
		<div className={cardClassName}>
			<div className={statusRowClassName}>
				<MaterialSymbol d={PERSON_PATH} size={20} aria-hidden="true" />
				{statusBadge}
			</div>
			{customStatusContent}
			{primaryActivityContent}
			{additionalActivitiesContent}
			{freshnessContent}
		</div>
	);

	if (chrome === 'section') {
		return (
			<PageSection labelledBy={headingId}>
				<SectionHeading
					id={headingId}
					eyebrow="Discord"
					title="Discord プレゼンス"
					titleEn="Discord Presence"
					description={PRESENCE_DESCRIPTION}
					variant="spread"
				>
					{cardContent}
				</SectionHeading>
			</PageSection>
		);
	}

	return (
		<div>
			<h3
				id={headingId}
				className={css({
					margin: '0',
					marginBlockEnd: '4',
					fontFamily: 'sans',
					fontSize: 'xl',
					fontWeight: '700',
					lineHeight: '1.25',
					letterSpacing: '-0.015em',
					color: 'text.default',
					textWrap: 'balance',
				})}
			>
				Discord プレゼンス
			</h3>
			<p className={descriptionClassName}>{PRESENCE_DESCRIPTION}</p>
			{cardContent}
		</div>
	);
}
