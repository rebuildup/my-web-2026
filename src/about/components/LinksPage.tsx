import { css } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Split } from '../../editorial/primitives/Grid';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
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
 *
 * The component renders whatever `groups` it is given — the route
 * adapter passes the committed `ABOUT_LINK_GROUPS`. A group with no
 * links is not rendered at all, and when NOTHING is publishable the
 * page renders an honest empty message rather than an empty frame
 * (same contract as `SkillsList` / `CareerTimeline`).
 */
export interface LinksPageProps {
	readonly groups: readonly AboutLinkGroup[];
}

export function LinksPage({ groups }: LinksPageProps) {
	const visibleGroups = groups.filter((group) => group.links.length > 0);
	return (
		<>
			<SkipLink />
			<PageSection rhythm="hero" labelledBy="links-hero-title">
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
			</PageSection>
			<main id="main">
				{visibleGroups.length === 0 ? (
					<LinksEmptyState />
				) : (
					visibleGroups.map((group, index) => (
						<LinkGroupSection key={group.id} group={group} index={index + 1} />
					))
				)}
			</main>
		</>
	);
}

function LinksEmptyState() {
	return (
		<PageSection labelledBy="links-empty-title" separator>
			<h2
				id="links-empty-title"
				lang="ja"
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					lineHeight: '1.4',
					color: 'text.default',
				})}
			>
				公開しているリンクはまだありません
			</h2>
			<p
				lang="ja"
				className={css({
					margin: '0',
					marginBlockStart: '4',
					fontFamily: 'sans',
					fontSize: 'md',
					lineHeight: '1.6',
					color: 'text.muted',
					maxWidth: '640px',
				})}
			>
				連絡先は
				<a href="/contact" className={inlineLinkStyle}>
					/contact
				</a>
				に掲載している verified channel を参照してください。
			</p>
		</PageSection>
	);
}

function LinkGroupSection({ group, index }: { group: AboutLinkGroup; index: number }) {
	return (
		<PageSection labelledBy={`links-group-${group.id}`} separator>
			<SectionHeading
				id={`links-group-${group.id}`}
				eyebrow={`${String(index).padStart(2, '0')} — ${group.labelEn}`}
				title={group.label}
				variant="default"
			/>
			<Stack as="ul" gap="0" data-testid={`links-group-${group.id}`} className={listResetClassName}>
				{group.links.map((link) => (
					<LinkRow key={link.id} link={link} />
				))}
			</Stack>
		</PageSection>
	);
}

function LinkRow({ link }: { link: AboutLink }) {
	return (
		<Split as="li" rowGap="2" separated>
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
		</Split>
	);
}

const inlineLinkStyle = css({
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
});
