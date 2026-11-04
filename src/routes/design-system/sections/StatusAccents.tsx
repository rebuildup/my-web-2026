import { css } from '../../../../styled-system/css';
import { Badge } from '../../../editorial/primitives/Badge';
import { StateMark } from '../../../editorial/primitives/StateMark';

/**
 * StatusAccents — status shown by SHAPE and WORD, paired with the four
 * content-category marks.
 *
 * Issue #812: the state and the classification are carried by the
 * WORD and by the SHAPE (`StateMark`), never by colour alone, and the
 * cards carry no chrome (no frame, no radius, no canvas fill) that
 * would put a white surface back on the page.
 *
 * Issue #887 (direction B): the status hue is gone. `accent.positive`
 * / `accent.negative` / `accent.warning` are TRANSITIONAL aliases
 * that resolve to `mono.ink.text`, so the status row below
 * demonstrates the rule itself — silhouette + word on monochrome ink
 * — rather than a colour it no longer has. The only colour that
 * survives in this section is the CLASSIFICATION colour on the
 * category marks, because a content classification is a fact about
 * the work, not a state.
 *
 * Tokens consumed:
 *
 *   - `accent.positive` / `accent.negative` / `accent.warning`
 *     transitional aliases → `mono.ink.text` (ink); named here and in
 *     the ledger so the tile says which alias it stands for.
 *   - `accent.category.{design,code,writing,tool}`
 *                                   content-category mark.
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
			note: '状態は丸（disc）の印と Live の語で示す。色はない。',
			mark: 'ok',
		},
		{
			token: 'accent.negative',
			role: 'Error / unreachable',
			label: 'Error',
			note: '状態は十字（cross）の印と Error の語で示す。色はない。',
			mark: 'unreachable',
		},
		{
			token: 'accent.warning',
			role: 'Degraded',
			label: 'Degraded',
			note: '状態は三角（triangle）の印と Degraded の語で示す。色はない。',
			mark: 'degraded',
		},
	];
	return (
		<section
			aria-label="Status — shape and word"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '4',
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
					状態は色では示しません。印（StateMark）の形と語が状態を担います。 accent.positive /
					negative / warning は mono.ink.text（墨）に解決される暫定エイリアスで、
					色としての区別は持ちません（Issue #887）。
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
	/**
	 * The silhouette that carries the state (Issue #812). The mark is
	 * painted in the heading's own ink — Issue #887 removed the status
	 * hue it used to borrow — so silhouette and word are the whole
	 * signal.
	 */
	mark: 'ok' | 'unreachable' | 'degraded';
}

function StatusTile({ entry }: { entry: StatusEntry }) {
	return (
		<article
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '2',
				paddingInline: '6',
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
					display: 'flex',
					alignItems: 'center',
					gap: '2',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					color: 'text.default',
					letterSpacing: '-0.01em',
				})}
			>
				<StateMark kind={entry.mark} size="sm" />
				{entry.label}
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
					paddingBlockStart: '2',
				})}
			>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
					})}
				>
					{entry.token} → mono.ink.text（墨）
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
 * Per-family mark colour map. Each entry maps the family name to the
 * literal semantic token path so Panda's `color` utility accepts the
 * value statically (dynamic template strings are not a supported
 * token path).
 *
 * Issue #812: the family colour paints the 8px mark only. The word
 * beside it stays in `text.default`.
 */
const CATEGORY_MARK = {
	design: css({ color: 'accent.category.design' }),
	code: css({ color: 'accent.category.code' }),
	writing: css({ color: 'accent.category.writing' }),
	tool: css({ color: 'accent.category.tool' }),
} as const;

function CategoryRow() {
	const entries: ReadonlyArray<CategoryEntry> = [
		{
			token: 'accent.category.design',
			label: 'Design',
			note: '分類は diamond の形と語で示す。色は補助。',
			family: 'design',
		},
		{
			token: 'accent.category.code',
			label: 'Code',
			note: '分類は square の形と語で示す。色は補助。',
			family: 'code',
		},
		{
			token: 'accent.category.writing',
			label: 'Writing',
			note: '分類は stacked bars の形と語で示す。色は補助。',
			family: 'writing',
		},
		{
			token: 'accent.category.tool',
			label: 'Tool',
			note: '分類は chevron の形と語で示す。色は補助。',
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
					Content category の 4
					系統。形（StateMark）と語で分類し、色は補助の印として添えます。同じ形の
					色だけを変える表現は使いません。
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
			})}
			data-category-token={entry.token}
		>
			<div>
				<header
					className={css({
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '3',
						paddingBlock: '1',
					})}
				>
					<h3
						className={css({
							margin: '0',
							display: 'flex',
							alignItems: 'center',
							gap: '2',
							fontFamily: 'heading',
							fontSize: 'lg',
							fontWeight: '700',
							color: 'text.default',
							letterSpacing: '-0.01em',
						})}
					>
						<span className={CATEGORY_MARK[entry.family]}>
							<StateMark kind={entry.family} size="sm" />
						</span>
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
