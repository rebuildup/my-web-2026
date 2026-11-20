import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import type { StackItemView, StackPageData, StackSectionView } from './resolve';

/**
 * `/stack` page composition (Issue #381).
 *
 * Presentation only — the article data lives in `stack.ts` and the
 * resolved versions arrive through the route loader (`load.ts`), so
 * this component renders exactly what the server resolved and never
 * re-derives a fact.
 *
 * Layout mirrors `/links`: skip link → hero → one section per
 * `STACK_SECTIONS` entry → item rows. Sections are mapped from the
 * data array, so a later Issue appending a section needs no change
 * here.
 *
 * Undetermined contract: an item whose version could not be resolved
 * renders the 「未確定」 badge instead of a guessed value — the same
 * fail-closed posture the data module documents.
 */
export function StackPage({ data }: { data: StackPageData }) {
	return (
		<>
			<a href="#main" className={skipLinkStyle}>
				本文へスキップ
			</a>
			<section aria-labelledby="stack-hero-title" className={heroStyle}>
				<Container>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						my-web-2026 · /stack
					</span>
					<h1
						id="stack-hero-title"
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
						開発スタック / Stack
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
						このサイトを動かしている技術の一覧です。version は{' '}
						<code className={inlineCodeStyle}>package.json</code> と{' '}
						<code className={inlineCodeStyle}>profile.yaml</code> から読み取り、根拠となる source
						へのリンクを各項目に付けています。開発記事や整備 PR の 参照先として使えます。
					</p>
				</Container>
			</section>
			<main id="main">
				{data.sections.map((section, index) => (
					<StackSectionBlock key={section.id} section={section} index={index + 1} />
				))}
			</main>
		</>
	);
}

function StackSectionBlock({
	section,
	index,
}: {
	section: StackSectionView;
	index: number;
}) {
	return (
		<section
			aria-labelledby={`stack-section-${section.id}`}
			data-testid={`stack-section-${section.id}`}
			className={css({
				paddingBlock: { base: '16', lg: '24' },
				borderTopWidth: '1px',
				borderTopStyle: 'solid',
				borderTopColor: 'border.subtle',
			})}
		>
			<Container>
				<SectionHeading
					id={`stack-section-${section.id}`}
					eyebrow={`${String(index).padStart(2, '0')} — ${section.titleEn}`}
					title={section.title}
					description={section.description}
					variant="default"
				/>
				<ul
					data-testid={`stack-items-${section.id}`}
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '0',
						margin: '0',
						marginBlockStart: '10',
						padding: '0',
						listStyle: 'none',
					})}
				>
					{section.items.map((item) => (
						<StackItemRow key={item.id} item={item} />
					))}
				</ul>
			</Container>
		</section>
	);
}

function StackItemRow({ item }: { item: StackItemView }) {
	return (
		<li
			data-testid={`stack-item-${item.id}`}
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
				columnGap: { base: '0', lg: '10' },
				rowGap: '3',
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
					gap: '2',
					alignItems: 'flex-start',
				})}
			>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					{item.name}
				</h3>
				<VersionBadge version={item.version} />
			</div>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
				})}
			>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.7',
						color: 'text.default',
					})}
				>
					{item.responsibility}
				</p>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.7',
						color: 'text.muted',
					})}
				>
					<span className={css({ fontWeight: '600', color: 'text.default' })}>採用理由 — </span>
					{item.reason}
				</p>
				{item.evidence.length > 0 ? (
					<ul
						aria-label="根拠 source"
						className={css({
							display: 'flex',
							flexWrap: 'wrap',
							gap: '2',
							margin: '0',
							padding: '0',
							listStyle: 'none',
						})}
					>
						{item.evidence.map((link) => (
							<li key={link.href}>
								<a
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										gap: '1',
										fontFamily: 'mono',
										fontSize: 'xs',
										fontWeight: '600',
										color: 'text.accent',
										textDecoration: 'underline',
										textUnderlineOffset: '0.18em',
										textDecorationThickness: '1px',
										_hover: { textDecorationThickness: '2px' },
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									<span>{link.label}</span>
									<span aria-hidden="true">↗</span>
								</a>
							</li>
						))}
					</ul>
				) : null}
			</div>
		</li>
	);
}

/**
 * Version badge. `resolved` shows the label the loader read from the
 * live source; `undetermined` shows 「未確定」 — never a guess;
 * `none` renders nothing (the item has no meaningful version).
 */
function VersionBadge({ version }: { version: StackItemView['version'] }) {
	if (version.state === 'none') return null;
	if (version.state === 'undetermined') {
		return (
			<Badge tone="neutral">
				<span lang="ja">未確定</span>
			</Badge>
		);
	}
	return (
		<Badge tone="accent">
			<span className={css({ fontFamily: 'mono' })}>{version.label}</span>
		</Badge>
	);
}

const skipLinkStyle = css({
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
});

const heroStyle = css({
	paddingBlock: { base: '16', lg: '32' },
});

const inlineCodeStyle = css({
	fontFamily: 'mono',
	fontSize: '0.9em',
});
