import { Fragment } from 'react';
import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import type { Channel } from './schema';
import { PURPOSE_LABEL_EN, PURPOSE_LABEL_JA, daysSinceVerified } from './schema';

export interface ContactPageProps {
	channels: readonly Channel[];
	now: number;
	/**
	 * When true the page renders the empty-state message instead
	 * of a list. Driven by the loader, not the data — the data
	 * path always passes through the fail-closed gate first.
	 */
	empty: boolean;
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
 *   - No pricing / commission / shop affordance — explicitly absent
 *
 * Each channel row carries: label / label-en / purpose label
 * (用途) / verified-relative date / external link with safe
 * rel-target attrs.
 *
 * No JS interactivity. The page is fully static SSR.
 */
export function ContactPage({ channels, now, empty }: ContactPageProps) {
	return (
		<>
			<a
				href="#main"
				className={css({
					position: 'absolute',
					left: '0',
					top: '0',
					padding: '2',
					backgroundColor: 'bg.canvas',
					color: 'text.default',
					textDecoration: 'none',
					transform: 'translateY(-200%)',
					_focusVisible: {
						transform: 'translateY(0)',
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				本文へスキップ
			</a>
			<section
				aria-labelledby="contact-hero-title"
				className={css({
					// Issue #300: hero beat is 16/32 (layout-system.md §3.3) —
					// was 16/24, i.e. a body-section rhythm on a hero.
					paddingBlock: { base: '16', lg: '32' },
				})}
			>
				<Container>
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
						価格・制作依頼 (commission)
						のお問い合わせは、現時点ではこのページでは受け付けていません。 公開されている channel
						経由でお問い合わせください。
					</p>
				</Container>
			</section>
			<main id="main">
				<section
					aria-labelledby="channels-heading"
					className={css({
						paddingBlock: { base: '16', lg: '24' },
					})}
				>
					<Container>
						<SectionHeading
							id="channels-heading"
							eyebrow="01 — Channels"
							title="現在利用可能な channel"
							description="各 channel には用途 (採用・技術的な議論・配布) を明示しています。Channel は 30 日以内に deploy-time で再検証されたものだけを掲載しています。"
							variant="default"
						/>
						{empty ? <EmptyState /> : <ChannelList channels={channels} now={now} />}
					</Container>
				</section>
			</main>
		</>
	);
}

function ChannelList({
	channels,
	now,
}: {
	channels: readonly Channel[];
	now: number;
}) {
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
				<ChannelRow key={ch.id} channel={ch} now={now} />
			))}
		</ul>
	);
}

function ChannelRow({ channel, now }: { channel: Channel; now: number }) {
	const days = daysSinceVerified(channel, now);
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
		Number.isFinite(days) && days >= 0
			? `${days} 日前に検証 / verified ${days} day${days === 1 ? '' : 's'} ago`
			: '検証日不明 / verified_at unparseable';
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
						textDecoration: 'none',
						overflowWrap: 'break-word',
						_hover: { textDecoration: 'underline' },
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
						},
					})}
				>
					<span>
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

function EmptyState() {
	return (
		<div
			data-testid="contact-empty"
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
				現在 re-verified されている channel はありません。channel を追加するには、
				<code>src/contact/channels.json</code> に <code>active: true</code> と現在日付の{' '}
				<code>verified_at</code> を持つ entry を追加してください。
			</p>
		</div>
	);
}
