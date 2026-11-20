import { Fragment } from 'react';
import { css } from '../../styled-system/css';
import { PageSection } from '../editorial/primitives/PageSection';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { SkipLink } from '../editorial/primitives/SkipLink';
import { PURPOSE_LABEL_EN, PURPOSE_LABEL_JA } from './labels';
import type { PublicContactChannel } from './public';

export interface ContactPageProps {
	channels: readonly PublicContactChannel[];
	/**
	 * When true the page renders the empty-state message instead
	 * of a list. Driven by the loader, not the data — the data
	 * path always passes through the display-validity gate first.
	 */
	empty: boolean;
	/**
	 * Active channels whose records cannot confirm verification
	 * (Issue #833). Distinguishes "no channels exist" from
	 * "channels exist but none are confirmable" in the empty state.
	 */
	unverifiableCount: number;
}

/**
 * `/contact` page composition (Issue #103).
 *
 * Editorial coordinate system (Container + SectionHeading
 * `default` variant — single column because the body is a list of
 * rows, not a spread with right-column children).
 *
 * Layout:
 *   - Hero: <h1> + lede explaining the fail-closed contract
 *   - SectionHeading (eyebrow / title / description)
 *   - Channel list (or empty-state if filtered to zero)
 *   - No pricing / shop affordance — explicitly absent. The
 *     commission-intake surface is informational only and lives at
 *     `/commission` (Issue #390); this page links to it for the
 *     intake status and keeps listing verified channels.
 *
 * Each channel row carries: label / label-en / purpose label
 * (用途) / verified-relative date / external link with safe
 * rel-target attrs.
 *
 * No JS interactivity. The page is fully static SSR.
 */
export function ContactPage({ channels, empty, unverifiableCount }: ContactPageProps) {
	return (
		<>
			<SkipLink />
			<PageSection rhythm="hero" labelledBy="contact-hero-title">
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					my-web-2026 · /contact
				</span>
				<h1
					id="contact-hero-title"
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '2',
						fontFamily: 'heading',
						fontSize: { base: '3xl', lg: '4xl' },
						fontWeight: '700',
						lineHeight: { base: '1.15', lg: '1.05' },
						color: 'text.default',
						letterSpacing: '-0.03em',
					})}
				>
					Contact
				</h1>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '6',
						fontFamily: 'sans',
						fontSize: 'lg',
						lineHeight: '1.6',
						color: 'text.default',
						maxWidth: '640px',
					})}
				>
					現在利用可能な、用途別の contact channel だけを掲載しています。 掲載されていない channel
					は現在 re-verified されていないため、ここには載せていません。
				</p>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '3',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.6',
						color: 'text.muted',
						maxWidth: '640px',
					})}
				>
					制作依頼の受付状況は
					<a href="/commission" className={css({ color: 'text.accent' })}>
						/commission
					</a>
					を参照してください。 お問い合わせは、公開されている channel 経由でお願いします。
				</p>
			</PageSection>
			<main id="main">
				<PageSection labelledBy="channels-heading">
					<SectionHeading
						id="channels-heading"
						eyebrow="01 — Channels"
						title="現在利用可能な channel"
						description="各 channel には用途を明示しています。掲載中の channel は実在が確認されたものです。最終確認から時間が経過した channel には要再検証の注記を付けています。"
						variant="default"
					/>
					{empty ? (
						<EmptyState unverifiable={unverifiableCount > 0} />
					) : (
						<>
							{channels.some((ch) => ch.audit === 'due') ? <AuditDueNotice /> : null}
							<ChannelList channels={channels} />
						</>
					)}
				</PageSection>
			</main>
		</>
	);
}

function ChannelList({ channels }: { channels: readonly PublicContactChannel[] }) {
	return (
		<ul
			data-testid="contact-channels"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '0',
				margin: '0',
				padding: '0',
				listStyle: 'none',
			})}
		>
			{channels.map((ch) => (
				<ChannelRow key={ch.id} channel={ch} />
			))}
		</ul>
	);
}

function ChannelRow({ channel }: { channel: PublicContactChannel }) {
	const days = channel.verifiedDaysAgo;
	// Issue #300: `word-break: break-all` tore long links mid-segment
	// (「my-web-2/**026**」 on a 375px line — a three-character orphan).
	// A `<wbr>` after each "/" gives the line breaker a path-segment
	// boundary to prefer; `overflow-wrap: break-word` stays as the
	// fallback for a single segment wider than the column. `<wbr>`
	// (rather than an embedded U+200B) keeps the copyable text EXACTLY
	// the URL — selecting the rendered link yields no invisible
	// characters.
	const urlSegments = channel.url.split('/');
	const verifiedLabel =
		channel.audit === 'due'
			? // Issue #833: a `due` channel was verified to exist but its
				// audit window has elapsed. It stays listed — date age alone
				// must not remove a real route — with an explicit
				// re-verification note instead of a freshness claim.
				`${days} 日前に最終確認・要再検証 / last verified ${days} day${days === 1 ? '' : 's'} ago — re-verification due`
			: Number.isNaN(days)
				? '検証日を確認できません / verification date unavailable'
				: days < 0
					? // Defensive only: `auditChannelState` reports a future
						// date as `unknown`, which never reaches the page.
						'検証日が未来です / verification date is in the future'
					: `${days} 日前に検証 / verified ${days} day${days === 1 ? '' : 's'} ago`;
	return (
		<li
			data-channel-id={channel.id}
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
				columnGap: { base: '0', lg: '10' },
				rowGap: { base: '2', lg: '0' },
				paddingBlock: '6',
				borderBlockStartWidth: '1px',
				borderBlockStartColor: 'border.subtle',
				borderBlockStartStyle: 'solid',
			})}
		>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				<span
					lang="ja"
					className={css({
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '600',
						color: 'text.default',
					})}
				>
					{channel.label}
				</span>
				<span
					lang="en"
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{channel.labelEn}
				</span>
			</div>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '2',
					minWidth: '0',
				})}
			>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					<span lang="ja">用途: {PURPOSE_LABEL_JA[channel.purpose]}</span>
					<span lang="en"> · {PURPOSE_LABEL_EN[channel.purpose]}</span>
				</p>
				<a
					href={channel.url}
					rel="noopener noreferrer"
					target="_blank"
					data-testid="contact-channel-link"
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						gap: '2',
						fontFamily: 'sans',
						fontSize: 'md',
						fontWeight: '600',
						color: 'text.accent',
						// Issue #887: `text.accent` is ink, so the underline carries
						// the affordance at rest; the `→` still marks it as leaving
						// this site.
						textDecoration: 'underline',
						textUnderlineOffset: '0.18em',
						textDecorationThickness: '1px',
						overflowWrap: 'break-word',
						_hover: { textDecorationThickness: '2px' },
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
						},
					})}
				>
					<span
						// Flex item inside the inline-flex anchor: a single
						// over-long URL segment must be allowed to shrink
						// below its min-content width, or the row overflows
						// at 375px instead of wrapping at a `<wbr>`.
						className={css({ minWidth: '0' })}
					>
						{urlSegments.map((segment, index) => (
							<Fragment key={`${index}:${segment}`}>
								{index > 0 ? (
									<>
										/
										<wbr />
									</>
								) : null}
								{segment}
							</Fragment>
						))}
					</span>
					<span aria-hidden="true">→</span>
				</a>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{verifiedLabel}
				</span>
			</div>
		</li>
	);
}

function AuditDueNotice() {
	return (
		<p
			data-testid="contact-audit-due"
			className={css({
				margin: '0',
				marginBlockEnd: '6',
				padding: '3',
				borderRadius: 'md',
				borderWidth: '1px',
				borderColor: 'border.subtle',
				borderStyle: 'solid',
				backgroundColor: 'bg.surface',
				fontFamily: 'sans',
				fontSize: 'md',
				lineHeight: '1.6',
				color: 'text.muted',
			})}
		>
			最終確認から時間が経過した channel があります。
			経路の実在は確認済みですが、最新の状態は未確認です。
		</p>
	);
}

function EmptyState({ unverifiable }: { unverifiable: boolean }) {
	return (
		<div
			data-testid="contact-empty"
			data-empty-reason={unverifiable ? 'unverifiable' : 'none'}
			className={css({
				paddingBlock: '12',
				paddingInline: '6',
				borderRadius: 'md',
				borderWidth: '1px',
				borderColor: 'border.subtle',
				borderStyle: 'dashed',
				backgroundColor: 'bg.surface',
				color: 'text.muted',
				fontFamily: 'sans',
				fontSize: 'md',
				lineHeight: '1.6',
			})}
		>
			<p lang="ja" className={css({ margin: '0' })}>
				{unverifiable
					? '現在、確認できる連絡先はありません。 記録されている channel は要再検証の状態のため掲載していません。 再開したときはこのページでお知らせします。'
					: '現在、掲載している連絡先はありません。再開したときはこのページでお知らせします。'}
			</p>
		</div>
	);
}
