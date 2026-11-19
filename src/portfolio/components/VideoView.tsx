import { useState } from 'react';
import { css } from '../../../styled-system/css';
import type { PortfolioProject } from '../schema';
import { projectCover, projectVideo } from '../views';
import { FACET_LABEL } from '../vocabulary';
import { MediaPlaceholder } from './MediaPlaceholder';
import { PortfolioMediaFigure } from './PortfolioMedia';
import { PortfolioVideoFacade } from './PortfolioVideoFacade';

/**
 * VideoView — the `?view=video` exhibition mode (Issue #1048).
 *
 * The successor of my-web-2025's `VideoGallery` + `VideoDetailPanel`:
 * a thumbnail grid where a project with a playable video opens its
 * player IN the tile instead of navigating away. The 2025 panel was a
 * side sheet; the 2026 detail page already owns the full record, so
 * the tile's still stays a link to `/portfolio/<slug>` and only the
 * play affordance swaps the frame for `PortfolioVideoFacade`.
 *
 * Honesty contract:
 *   - the play button exists only when `projectVideo` returns a
 *     facade — the same `selectPortfolioVideo` gate the detail page
 *     uses, so a tile can never offer playback the detail page would
 *     refuse;
 *   - a project with no cover renders `MediaPlaceholder`, not a
 *     fabricated thumbnail;
 *   - at most ONE tile plays at a time (`playingSlug`), so a page of
 *     iframes can never mount by accident — the predecessor mounted
 *     lazily per panel, and the Issue #910 owner decision already
 *     removed autoplay from the embed itself.
 *
 * This component holds client state (which tile is playing), so it
 * hydrates: SSR renders every tile as a still, and the play toggle
 * appears on hydration. No markup differs between the two renders.
 */
export interface VideoViewProps {
	projects: readonly PortfolioProject[];
}

export function VideoView({ projects }: VideoViewProps) {
	const [playingSlug, setPlayingSlug] = useState<string | null>(null);
	return (
		<ol
			className={css({
				listStyle: 'none',
				margin: '0',
				padding: '0',
				display: 'grid',
				gridTemplateColumns: {
					base: '1fr',
					sm: 'repeat(2, minmax(0, 1fr))',
					lg: 'repeat(3, minmax(0, 1fr))',
				},
				columnGap: { base: '0', sm: '6' },
				rowGap: '10',
			})}
		>
			{projects.map((project) => (
				<VideoTile
					key={project.id}
					project={project}
					playing={playingSlug === project.slug}
					onPlay={() => setPlayingSlug(project.slug)}
					onStop={() => setPlayingSlug(null)}
				/>
			))}
		</ol>
	);
}

function VideoTile({
	project,
	playing,
	onPlay,
	onStop,
}: {
	project: PortfolioProject;
	playing: boolean;
	onPlay: () => void;
	onStop: () => void;
}) {
	const cover = projectCover(project);
	const video = projectVideo(project);
	const detailHref = `/portfolio/${project.slug}`;
	const firstFacet = project.facets[0];
	const showFrame = playing && video !== null;

	return (
		<li className={css({ display: 'grid', minWidth: '0' })}>
			<article
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					minWidth: '0',
				})}
			>
				<div className={css({ position: 'relative', minWidth: '0' })}>
					{showFrame ? (
						<>
							<PortfolioVideoFacade video={video} />
							<button
								type="button"
								onClick={onStop}
								aria-label={`Close video player for ${project.title}`}
								className={css({
									position: 'absolute',
									top: '2',
									right: '2',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									h: '8',
									w: '8',
									borderRadius: 'full',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: 'border.subtle',
									backgroundColor: 'bg.surface',
									color: 'text.default',
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '700',
									cursor: 'pointer',
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								<span aria-hidden="true">×</span>
							</button>
						</>
					) : cover ? (
						<a
							href={detailHref}
							aria-label={project.title}
							className={css({
								display: 'block',
								textDecoration: 'none',
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '4px',
									borderRadius: '6px',
								},
							})}
						>
							<PortfolioMediaFigure media={cover} loading="lazy" frameAspectRatio="16 / 9" />
						</a>
					) : (
						<MediaPlaceholder ratio="16 / 9" />
					)}
					{video !== null && !showFrame ? (
						/* The button is sized to the play glyph itself
						   (`inset: 0` + `margin: auto` + fixed box centres
						   it), so the rest of the thumbnail still hits the
						   detail link underneath — play and "open detail"
						   stay two distinct targets, like the predecessor's
						   tile vs. panel split. */
						<button
							type="button"
							onClick={onPlay}
							aria-label={`Play video for ${project.title}`}
							className={css({
								position: 'absolute',
								inset: '0',
								margin: 'auto',
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								h: '12',
								w: '12',
								borderRadius: 'full',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: 'border.strong',
								backgroundColor: 'bg.surface',
								color: 'text.default',
								fontFamily: 'sans',
								fontSize: 'lg',
								paddingInlineStart: '1',
								cursor: 'pointer',
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '2px',
								},
							})}
						>
							<span aria-hidden="true">▶</span>
						</button>
					) : null}
				</div>
				<header
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
						minWidth: '0',
					})}
				>
					<h3
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: 'lg',
							fontWeight: '700',
							color: 'text.default',
							lineHeight: '1.3',
							letterSpacing: '-0.01em',
						})}
					>
						<a
							href={detailHref}
							className={css({
								color: 'inherit',
								textDecoration: 'underline',
								textUnderlineOffset: '0.18em',
								textDecorationThickness: '1px',
								textDecorationColor: 'border.strong',
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '4px',
									borderRadius: '2px',
								},
								_hover: {
									textDecorationThickness: '2px',
									textDecorationColor: 'currentColor',
								},
							})}
						>
							{project.title}
						</a>
					</h3>
					<p
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: 'sm',
							color: 'text.muted',
							lineHeight: '1.5',
							lineClamp: '1',
						})}
					>
						{project.summary}
					</p>
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
							color: 'text.muted',
						})}
					>
						{firstFacet ? FACET_LABEL[firstFacet] : 'Project'}
						{project.periodLabel ? ` · ${project.periodLabel}` : ''}
					</p>
				</header>
			</article>
		</li>
	);
}
