import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { ABOUT_LINK_GROUPS, type AboutLink, type AboutLinkGroup } from '../links';

/**
 * `/links` page composition (Issue #390).
 *
 * Presentation only — the inventory lives in `src/about/links.ts`
 * and reaches the page through the route, never through a fetch.
 *
 * Layout mirrors `/contact`: skip link → hero → one section per
 * link group → a closing note that points contact-shaped requests
 * at `/contact` (the page deliberately carries no e-mail address —
 * Issue #390 keeps private channels out of this surface).
 */
export function LinksPage() {
	return (
		<>
			<a href="#main" className={skipLinkStyle}>
				本文へスキップ
			</a>
			<section aria-labelledby="links-hero-title" className={heroStyle}>
				<Container>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						my-web-2026 · /links
					</span>
					<h1
						id="links-hero-title"
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
						リンク集 / Links
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
						公開している外部アカウントとサイト内ページの一覧です。連絡先は
						<a href="/contact" className={inlineLinkStyle}>
							/contact
						</a>
						に掲載している verified channel を参照してください。
					</p>
				</Container>
			</section>
			<main id="main">
				{ABOUT_LINK_GROUPS.map((group, index) => (
					<LinkGroupSection key={group.id} group={group} index={index + 1} />
				))}
			</main>
		</>
	);
}

function LinkGroupSection({ group, index }: { group: AboutLinkGroup; index: number }) {
	return (
		<section
			aria-labelledby={`links-group-${group.id}`}
			className={css({
				paddingBlock: { base: '16', lg: '24' },
				borderTopWidth: '1px',
				borderTopStyle: 'solid',
				borderTopColor: 'border.subtle',
			})}
		>
			<Container>
				<SectionHeading
					id={`links-group-${group.id}`}
					eyebrow={`${String(index).padStart(2, '0')} — ${group.labelEn}`}
					title={group.label}
					variant="default"
				/>
				<ul
					data-testid={`links-group-${group.id}`}
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '0',
						margin: '0',
						padding: '0',
						listStyle: 'none',
					})}
				>
					{group.links.map((link) => (
						<LinkRow key={link.id} link={link} />
					))}
				</ul>
			</Container>
		</section>
	);
}

function LinkRow({ link }: { link: AboutLink }) {
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
				columnGap: { base: '0', lg: '10' },
				rowGap: '2',
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
					{link.title}
				</span>
				<span
					lang="en"
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{link.description}
				</span>
			</div>
			<a
				href={link.url}
				{...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
				className={css({
					display: 'inline-flex',
					alignItems: 'center',
					gap: '2',
					alignSelf: { base: 'start', lg: 'center' },
					fontFamily: 'sans',
					fontSize: 'md',
					fontWeight: '600',
					color: 'text.accent',
					textDecoration: 'underline',
					textUnderlineOffset: '0.18em',
					textDecorationThickness: '1px',
					wordBreak: 'break-all',
					_hover: { textDecorationThickness: '2px' },
					_focusVisible: {
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				<span>{link.url}</span>
				{link.external ? <span aria-hidden="true">↗</span> : null}
			</a>
		</li>
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

const inlineLinkStyle = css({
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
});
