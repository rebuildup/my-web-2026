import { css } from '../../styled-system/css';
import type { Capability } from './capabilities/capability';
import { CapabilitiesGrid } from './capabilities/grid';
import { Footer } from './footer';
import { Hero } from './hero';
import type { HomeReactionsData } from './reactions/load';
import { ReactionsWidget } from './reactions/widget';
import type { SystemService, SystemServiceStatus } from './status/health';
import { StatusTiles } from './status/tiles';

export interface HomePageData {
	capabilities: readonly Capability[];
	services: readonly SystemService[];
	statuses: readonly SystemServiceStatus[];
	observedAt: string;
	reactions: HomeReactionsData;
}

export interface HomePageProps {
	data: HomePageData;
}

/**
 * Canonical composition for GET /.
 *
 * The route owns routing; this component owns the home reading order.
 * Individual sections keep their own change reasons below src/home/.
 *
 * Reading order (Issue #31 spread):
 *   - Hero             (page entry)
 *   - 01 — Capabilities (planned / live cards)
 *   - 02 — System status (binding probes)
 *   - 03 — Reactions   (visitor emoji reactions against home-page)
 *   - 04 — Access counter (page-view counter; 0.4.0 follow-up)
 *   - Footer            (edition / identity / index / privacy notice)
 */
export function HomePage({ data }: HomePageProps) {
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
			<Hero />
			<main id="main">
				<CapabilitiesGrid capabilities={data.capabilities} />
				<StatusTiles
					services={data.services}
					statuses={data.statuses}
					observedAt={data.observedAt}
				/>
				<section
					aria-labelledby="reactions-heading"
					className={css({
						paddingBlock: { base: '16', lg: '24' },
					})}
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							03 — Reactions
						</span>
						<h2
							id="reactions-heading"
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'sans',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.15',
								letterSpacing: '-0.02em',
								color: 'text.default',
							})}
						>
							みんなの反応 / Reactions
						</h2>
						<p
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
							このページへのリアクションを送ることができます (匿名・1 ブラウザ 1 票)。
						</p>
						<div
							className={css({
								marginBlockStart: '6',
							})}
						>
							<ReactionsWidget data={data.reactions} />
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</>
	);
}
