import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import type { CurrentProject } from './projects';
import { selectPublicProjects } from './projects';

/**
 * CurrentProjects — the "現在地 / Where I am now" section (Issue #316).
 *
 * A deliberately small, inline section: a handful of projects the
 * owner is working on, published from a committed snapshot
 * (`./projects`). It renders directly below the hero and directly
 * above the capabilities grid.
 *
 * Why it is a snapshot and not a feed
 * ----------------------------------
 * The section makes a claim about *now*, so the claim has to be
 * reviewable. The data lives in the repository (`CURRENT_PROJECTS`),
 * the publication rules live in `selectPublicProjects`, and this
 * component only decides the shape. Nothing here fetches, and no
 * binding is read.
 *
 * Fail-closed
 * -----------
 * The component receives whatever it is handed and publishes only
 * what `selectPublicProjects` allows. An empty set is a published
 * sentence ("現在、公開中の進行中のプロジェクトはありません。"), never
 * an empty list and never an invented placeholder — a reader must be
 * able to tell "nothing is published" from "the page failed".
 *
 * Accessibility / layout notes
 * ----------------------------
 *   - The section is named by its own `<h2>` (`aria-labelledby`), and
 *     each project is an `<h3>` inside a `<li>`: one heading level
 *     below the section title, no skipped level.
 *   - The link carries a VISIBLE label plus an `aria-hidden` arrow, so
 *     the accessible name is the label a reader can see (WCAG 2.2
 *     SC 2.5.3, Label in Name).
 *   - No image and no animation: the section adds no CLS and the
 *     `prefers-reduced-motion` preference is satisfied by there being
 *     nothing that moves.
 *   - The list is one column at 390px and at most two columns from
 *     `md` up.
 */
export interface CurrentProjectsProps {
	/**
	 * The projects to publish. Optional, and the default is the EMPTY
	 * list: a caller that forgets the snapshot publishes the "nothing
	 * is published" sentence rather than a stale one.
	 */
	projects?: readonly CurrentProject[];
}

/** The shared link treatment — the home capabilities grid's link. */
const linkClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	marginBlockStart: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.accent',
	textDecoration: 'none',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '4px',
		borderRadius: '2px',
	},
	_hover: {
		textDecoration: 'underline',
	},
});

export function CurrentProjects({ projects = [] }: CurrentProjectsProps) {
	const published = selectPublicProjects(projects);
	return (
		<section
			aria-labelledby="current-projects-heading"
			data-testid="home-current-projects"
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					id="current-projects-heading"
					eyebrow="00 — Now"
					title="現在地 / Where I am now"
					description="いま進行中のプロジェクトです。公開してよい情報だけを、静的なスナップショットとして手で更新しています。"
					variant="spread"
				>
					{published.length === 0 ? (
						<p
							lang="ja"
							data-testid="home-current-projects-empty"
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.muted',
								lineHeight: '1.6',
							})}
						>
							現在、公開中の進行中のプロジェクトはありません。
						</p>
					) : (
						<ul
							data-testid="home-current-projects-list"
							className={css({
								display: 'grid',
								gridTemplateColumns: {
									base: '1fr',
									md: 'repeat(2, minmax(0, 1fr))',
								},
								rowGap: '8',
								columnGap: { base: '0', md: '6' },
								margin: '0',
								padding: '0',
								listStyle: 'none',
							})}
						>
							{published.map((project) => (
								<li
									key={project.id}
									data-testid="home-current-project"
									data-project-id={project.id}
									className={css({
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'flex-start',
									})}
								>
									<h3
										className={css({
											margin: '0',
											fontFamily: 'heading',
											fontSize: 'xl',
											fontWeight: '700',
											color: 'text.default',
											lineHeight: '1.2',
											letterSpacing: '-0.01em',
										})}
									>
										{project.name}
									</h3>
									<p
										lang="ja"
										className={css({
											margin: '0',
											marginBlockStart: '2',
											fontFamily: 'sans',
											fontSize: 'md',
											color: 'text.muted',
											lineHeight: '1.6',
										})}
									>
										{project.statusJa}
									</p>
									{project.link ? (
										<a href={project.link.href} className={linkClassName}>
											<span>{project.link.label}</span>
											<span aria-hidden="true">→</span>
										</a>
									) : null}
								</li>
							))}
						</ul>
					)}
				</SectionHeading>
			</Container>
		</section>
	);
}
