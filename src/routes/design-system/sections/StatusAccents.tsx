import { css } from '../../../../styled-system/css';
import { Badge } from '../../../editorial/primitives/Badge';

/**
 * StatusAccents — `positive / negative / warning` status badges
 * paired with the four content-category left-border treatments.
 *
 * The status badges use the existing `Badge` primitive with a
 * tone mapping that consumes the semantic accent tokens directly
 * (see below). The category left-border cards use a 4px border
 * on the inline-start edge painted by the category token — this is
 * the same left-border pattern the portfolio cards use to identify
 * their first facet.
 *
 * Tokens consumed:
 *
 *   - `accent.positive`              OK / live status foreground.
 *   - `accent.negative`              error / unreachable foreground.
 *   - `accent.warning`               degraded status foreground.
 *   - `accent.category.{design,code,writing,tool}`
 *                                   content-category identifier.
 *   - `border.subtle`                card outline.
 */

export function StatusAccents() {
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '10',
			})}
		>
			<StatusRow />
			<CategoryRow />
		</div>
	);
}

function StatusRow() {
	const entries: ReadonlyArray<StatusEntry> = [
		{
			token: 'accent.positive',
			role: 'OK / live',
			label: 'Live',
			note: 'Running, healthy, available — green.',
			tone: 'positive',
		},
		{
			token: 'accent.negative',
			role: 'Error / unreachable',
			label: 'Error',
			note: 'Service down, build failed — red.',
			tone: 'negative',
		},
		{
			token: 'accent.warning',
			role: 'Degraded',
			label: 'Degraded',
			note: 'Partially healthy, needs attention — amber.',
			tone: 'warning',
		},
	];
	return (
		<section
			aria-label="Status badges"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '4',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<header
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					Status
				</span>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					Three status accents — positive / negative / warning. Foreground contrast 4.5 : 1 以上
					(WCAG AA) を `bg.canvas` / `bg.inverse` 両方で満たします。
				</p>
			</header>
			<ul
				className={css({
					margin: '0',
					padding: '0',
					listStyle: 'none',
					display: 'grid',
					gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
					gap: '4',
				})}
			>
				{entries.map((entry) => (
					<li key={entry.token}>
						<StatusTile entry={entry} />
					</li>
				))}
			</ul>
		</section>
	);
}

interface StatusEntry {
	token: string;
	role: string;
	label: string;
	note: string;
	tone: 'positive' | 'negative' | 'warning';
}

const STATUS_FG = {
	positive: css({ color: 'accent.positive' }),
	negative: css({ color: 'accent.negative' }),
	warning: css({ color: 'accent.warning' }),
};

function StatusTile({ entry }: { entry: StatusEntry }) {
	return (
		<article
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '6',
				paddingInline: '6',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				backgroundColor: 'bg.canvas',
			})}
			data-status-token={entry.token}
		>
			<header
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '2',
				})}
			>
				<Badge tone="neutral">{entry.role}</Badge>
			</header>
			<h3
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					color: 'text.default',
					letterSpacing: '-0.01em',
				})}
			>
				<span className={STATUS_FG[entry.tone]}>{entry.label}</span>
			</h3>
			<p
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'sm',
					lineHeight: '1.6',
					color: 'text.muted',
				})}
			>
				{entry.note}
			</p>
			<footer
				className={css({
					marginBlockStart: 'auto',
					paddingBlockStart: '3',
					borderTop: '1px solid {colors.border.subtle}',
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
					})}
				>
					{entry.token}
				</code>
			</footer>
		</article>
	);
}

type CategoryFamily = 'design' | 'code' | 'writing' | 'tool';

interface CategoryEntry {
	token: `accent.category.${CategoryFamily}`;
	label: string;
	note: string;
	family: CategoryFamily;
}

/**
 * Per-family left-border colour map. Each entry maps the family
 * name to the literal semantic token path so Panda's
 * `borderInlineStartColor` accepts the value statically
 * (dynamic template strings are not a supported token path).
 */
const CATEGORY_BORDER = {
	design: css({ borderInlineStartColor: 'accent.category.design' }),
	code: css({ borderInlineStartColor: 'accent.category.code' }),
	writing: css({ borderInlineStartColor: 'accent.category.writing' }),
	tool: css({ borderInlineStartColor: 'accent.category.tool' }),
} as const;

function CategoryRow() {
	const entries: ReadonlyArray<CategoryEntry> = [
		{
			token: 'accent.category.design',
			label: 'Design',
			note: 'Pink. Portfolio facet が design 起点の作品、 左border で識別。',
			family: 'design',
		},
		{
			token: 'accent.category.code',
			label: 'Code',
			note: 'Cyan. Portfolio facet が develop 起点の作品、 実装寄りの surface で識別。',
			family: 'code',
		},
		{
			token: 'accent.category.writing',
			label: 'Writing',
			note: 'Yellow-brown. Portfolio facet が other / 散文寄りの作品。',
			family: 'writing',
		},
		{
			token: 'accent.category.tool',
			label: 'Tool',
			note: 'Indigo. Tool surface の category tag、 portfolio facet が video の作品。',
			family: 'tool',
		},
	];
	return (
		<section
			aria-label="Category accents"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '4',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<header
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					Category
				</span>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					Content category の 4 色。 同程度の彩度 × 異なる hue (pink ≈ 330°, cyan ≈ 190°, yellow ≈
					50°, indigo ≈ 240°) で一目で区別できます。
				</p>
			</header>
			<ul
				className={css({
					margin: '0',
					padding: '0',
					listStyle: 'none',
					display: 'grid',
					gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
					gap: '4',
				})}
			>
				{entries.map((entry) => (
					<li key={entry.token}>
						<CategoryCard entry={entry} />
					</li>
				))}
			</ul>
		</section>
	);
}

function CategoryCard({ entry }: { entry: CategoryEntry }) {
	return (
		<article
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				paddingBlock: '4',
				paddingInline: '6',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				backgroundColor: 'bg.canvas',
				borderInlineStartWidth: '4px',
			})}
			data-category-token={entry.token}
		>
			<div className={CATEGORY_BORDER[entry.family]}>
				<header
					className={css({
						display: 'flex',
						alignItems: 'baseline',
						justifyContent: 'space-between',
						gap: '3',
						paddingBlock: '1',
					})}
				>
					<h3
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: 'lg',
							fontWeight: '700',
							color: 'text.default',
							letterSpacing: '-0.01em',
						})}
					>
						{entry.label}
					</h3>
					<code
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
						})}
					>
						{entry.token}
					</code>
				</header>
				<p
					className={css({
						margin: '0',
						paddingBlock: '2',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.muted',
					})}
				>
					{entry.note}
				</p>
			</div>
		</article>
	);
}
