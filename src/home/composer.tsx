import { css } from '../../styled-system/css';
import type { HomeCounterData } from './access/load';
import { CounterTile } from './access/tiles';
import type { Capability } from './capabilities/capability';
import { CapabilitiesGrid } from './capabilities/grid';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
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
	counter: HomeCounterData;
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
 *   - Hero             (page entry; own 4/8 grid)
 *   - 01 — Capabilities (planned / live cards; spread SectionHeading)
 *   - 02 — System status (binding probes; spread SectionHeading)
 *   - 03 — Reactions   (visitor emoji reactions against home-page)
 *   - 04 — Access counter (page-view counter; spread SectionHeading
 *                            + Dashboard KPI tile in 8/12 children slot)
 *   - Footer            (edition / identity / index / privacy notice)
 *
 * Branch 43 redesign: every body section now participates in the
 * shared editorial coordinate system (`<Container>` →
 * `<SectionHeading variant="spread">`). Reactions and counter no
 * longer roll their own inline eyebrow / heading / padding.
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
					<Container>
						<SectionHeading
							id="reactions-heading"
							eyebrow="03 — Reactions"
							title="みんなの反応 / Reactions"
							description="このページへのリアクションを送ることができます (匿名・1 ブラウザ 1 票)。"
							variant="spread"
						>
							<ReactionsWidget data={data.reactions} />
						</SectionHeading>
					</Container>
				</section>
				<section
					aria-labelledby="access-counter-heading"
					className={css({
						paddingBlock: { base: '16', lg: '24' },
					})}
				>
					<Container>
						<SectionHeading
							id="access-counter-heading"
							eyebrow="04 — Access counter"
							title="ページビュー / Page views"
							description="各リクエストは短時間ウィンドウ内で重複加算されません。"
							variant="spread"
						>
							<CounterTile data={data.counter} />
						</SectionHeading>
					</Container>
				</section>
			</main>
			<Footer />
		</>
	);
}
