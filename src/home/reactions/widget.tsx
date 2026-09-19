import { useMemo, useState, useTransition } from 'react';
import { css } from '../../../styled-system/css';
import type { ReactionAggregate } from '../../http/reactions/schema';
import { resolveEmojiSlug } from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { addHomeReaction, removeHomeReaction } from './load';

const MAX_RECORDED_CHIPS = 8;

/**
 * Visitor-facing emoji reactions widget for the home page (Ticket E /
 * Branch 37; picker rewrite on branch 43).
 *
 * Reactions are stored as opaque `:slug:` identifiers (e.g.
 * `:thumbs_up:`). The DB-backed catalog (`reaction_emoji_catalog`,
 * Ticket G / branch 39) maps slugs to emoji codepoints at render time
 * so the home stays the single place that knows how to draw a
 * reaction.
 *
 * Branch 43 rewrite — picker UX:
 *
 *   - The widget is laid out as two fieldsets:
 *     (1) **Recorded reactions** — one chip per aggregate; click to
 *         remove. Capped at `MAX_RECORDED_CHIPS`.
 *     (2) **Catalog picker** — a search input + a grid of catalog
 *         entries. Search filters by slug; click to add.
 *   - The pre-branch-43 free-text `:slug:` form is removed. The
 *     picker is the only add path.
 *   - All visible glyphs resolve from `HomeReactionsData.catalog`.
 *
 * Why no library (branch 43 ADR-style note):
 *
 *   The `reaction_emoji_catalog` table is the **canonical source of
 *   truth** for emoji metadata (Ticket G). Surveyed libraries
 *   (frimousse, emoji-mart, emoji-picker-react) all either bundle or
 *   fetch Emojibase as their canonical data source, which would
 *   create dual ownership of emoji metadata on top of our catalog.
 *   The picker is small enough (~150 LOC) to build in-house while
 *   keeping the catalog as the single source of truth.
 *
 * State is optimistic — we update the in-memory aggregate list
 * immediately and roll back on `ok: false` from the server fn.
 */
export interface ReactionsWidgetProps {
	data: HomeReactionsData;
}

export function ReactionsWidget({ data }: ReactionsWidgetProps) {
	const [aggregates, setAggregates] = useState<readonly ReactionAggregate[]>(data.aggregates);
	const [pending, startTransition] = useTransition();
	const [search, setSearch] = useState('');
	const [error, setError] = useState<string | null>(null);

	const visibleAggregates = aggregates.slice(0, MAX_RECORDED_CHIPS);

	const filteredCatalog = useMemo(() => {
		const q = search.trim().toLowerCase();
		return data.catalog.filter((entry) => {
			if (!entry.enabled) return false;
			if (!q) return true;
			return entry.slug.includes(q);
		});
	}, [data.catalog, search]);

	const toggleReaction = (kind: ReactionAggregate['kind'], value: string): void => {
		setError(null);
		const before = aggregates;
		const exists = before.some((a) => a.kind === kind && a.value === value);
		const next: ReactionAggregate[] = exists
			? before.map((a) =>
					a.kind === kind && a.value === value ? { ...a, count: Math.max(0, a.count - 1) } : a,
				)
			: [...before, { kind, value, count: 1 }];
		setAggregates(next);

		startTransition(async () => {
			const target = data.target_key;
			const result = exists
				? await removeHomeReaction({ data: { target, kind, value } })
				: await addHomeReaction({ data: { target, kind, value } });
			if (!result.ok) {
				setAggregates(before);
				setError(result.reason ?? 'upstream_error');
			}
		});
	};

	if (!data.enabled) {
		return (
			<div
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				reactions disabled — consumer API key not configured (run
				scripts/bootstrap-home-api-key.mjs)
			</div>
		);
	}

	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '6',
			})}
		>
			<fieldset
				aria-label="Recorded reactions"
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '3',
					border: 'none',
					padding: '0',
					margin: '0',
					minHeight: '10',
					alignItems: 'center',
				})}
			>
				{visibleAggregates.length === 0 ? (
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						まだ反応はありません — 下のピッカーから送ってみましょう
					</span>
				) : (
					visibleAggregates.map((chip) => {
						const glyph =
							chip.kind === 'emoji'
								? (resolveEmojiSlug(data.catalog, chip.value) ?? `:${chip.value}:`)
								: '?';
						return (
							<button
								key={`${chip.kind}:${chip.value}`}
								type="button"
								disabled={pending}
								onClick={() => toggleReaction(chip.kind, chip.value)}
								title={`:${chip.value}:`}
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									paddingInline: '3',
									height: '8',
									borderRadius: 'full',
									borderWidth: '1px',
									borderColor: 'border.subtle',
									borderStyle: 'solid',
									backgroundColor: 'bg.canvas',
									color: 'text.default',
									fontFamily: 'sans',
									fontSize: 'md',
									cursor: 'pointer',
									_hover: { borderColor: 'border.focus' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
									_disabled: { opacity: 0.6, cursor: 'not-allowed' },
								})}
							>
								<span aria-hidden="true">{glyph}</span>
								<span
									className={css({
										fontFamily: 'mono',
										fontSize: 'sm',
										color: 'text.muted',
									})}
								>
									{chip.count}
								</span>
							</button>
						);
					})
				)}
			</fieldset>

			<fieldset
				aria-label="Add a reaction"
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					border: 'none',
					padding: '0',
					margin: '0',
				})}
			>
				<div
					className={css({
						display: 'flex',
						alignItems: 'center',
						gap: '3',
					})}
				>
					<label
						htmlFor="home-reactions-picker-search"
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
						})}
					>
						search
					</label>
					<input
						id="home-reactions-picker-search"
						type="search"
						inputMode="search"
						autoComplete="off"
						spellCheck={false}
						value={search}
						onChange={(event) => setSearch(event.currentTarget.value)}
						placeholder="thumbs_up"
						className={css({
							display: 'inline-flex',
							alignItems: 'center',
							paddingInline: '3',
							height: '8',
							minWidth: '40',
							maxWidth: '64',
							flex: '1',
							borderRadius: 'md',
							borderWidth: '1px',
							borderColor: 'border.subtle',
							borderStyle: 'solid',
							backgroundColor: 'bg.canvas',
							color: 'text.default',
							fontFamily: 'mono',
							fontSize: 'md',
							_focusVisible: {
								outline: '2px solid {colors.border.focus}',
								outlineOffset: '2px',
							},
						})}
					/>
				</div>
				{filteredCatalog.length === 0 ? (
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						一致する絵文字がありません — search を空にして全文表示
					</p>
				) : (
					<ul
						className={css({
							display: 'grid',
							gridTemplateColumns: {
								base: 'repeat(4, minmax(0, 1fr))',
								md: 'repeat(6, minmax(0, 1fr))',
								lg: 'repeat(8, minmax(0, 1fr))',
							},
							gap: '2',
							margin: '0',
							padding: '0',
							listStyle: 'none',
						})}
					>
						{filteredCatalog.map((entry) => (
							<li key={entry.slug}>
								<button
									type="button"
									disabled={pending}
									onClick={() => toggleReaction('emoji', entry.slug)}
									aria-label={`Add :${entry.slug}: reaction`}
									title={`:${entry.slug}:`}
									className={css({
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'center',
										justifyContent: 'center',
										gap: '1',
										width: 'full',
										height: '14',
										borderRadius: 'md',
										borderWidth: '1px',
										borderColor: 'border.subtle',
										borderStyle: 'solid',
										backgroundColor: 'bg.canvas',
										color: 'text.default',
										fontSize: '2xl',
										lineHeight: '1',
										cursor: 'pointer',
										_hover: { borderColor: 'border.focus' },
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
										_disabled: { opacity: 0.6, cursor: 'not-allowed' },
									})}
								>
									<span aria-hidden="true">{entry.codepoint}</span>
									<span
										className={css({
											fontFamily: 'mono',
											fontSize: 'xs',
											color: 'text.muted',
											letterSpacing: '0.02em',
										})}
									>
										:{entry.slug}:
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</fieldset>
			{error ? (
				<p
					role="alert"
					className={css({
						margin: '0',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{error}
				</p>
			) : null}
		</div>
	);
}
