import { Suspense, lazy, useEffect, useMemo, useState, useTransition } from 'react';
import { css } from '../../../styled-system/css';
import { EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';
import type { ReactionAggregate } from '../../http/reactions/schema';
import { resolveEmojiSlug } from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { addHomeReaction, removeHomeReaction } from './load';

const MAX_RECORDED_CHIPS = 8;

/**
 * Visitor-facing emoji reactions widget for the home page
 * (Ticket E / Branch 37; picker rewrite on branch 43).
 *
 * Reactions are stored as opaque `:slug:` identifiers (e.g.
 * `:thumbs_up:`). The DB-backed catalog (`reaction_emoji_catalog`,
 * Ticket G / branch 39) maps slugs to emoji codepoints at render time
 * so the home stays the single place that knows how to draw a
 * reaction.
 *
 * Branch 43 picker rewrite — `emoji-picker-react` integration:
 *
 *   - The library picker (ealush/emoji-picker-react v4) owns the
 *     full picker UX: category navigation, search, sticky section
 *     headers, scroll viewport, recent / suggested entries. We render
 *     it with `emojiStyle="native"` so every glyph is rendered as a
 *     plain Unicode character — there is **no** CDN fetch and **no**
 *     bundled emoji image set in the SSR / client bundles.
 *
 *   - `reaction_emoji_catalog` remains the canonical source of truth
 *     for which slugs are recordable. The library ships its own
 *     bundled Unicode emoji metadata (categories, names, search
 *     index) but that metadata is read-only UX data; the storage
 *     layer still validates slugs against `reaction_emoji_catalog`
 *     server-side. Branch 43 therefore keeps the library metadata
 *     separate from the catalog metadata — there is no dual
 *     ownership of stored reactions.
 *
 *   - On click, we resolve the picker event's `unified` (a string
 *     like `"1f44d"`) back to a catalog slug via the
 *     `unifiedToSlug` map. Unknown emojis (e.g. someone clicks a
 *     not-yet-curated animal glyph) get a friendly inline error and
 *     are not recorded. This keeps the picker UX open while the
 *     catalog stays curated.
 *
 *   - The library component is loaded lazily and only on the
 *     client. SSR HTML for the picker slot is a placeholder of the
 *     sane size; the picker hydrates after mount.
 *
 * State is optimistic — we update the in-memory aggregate list
 * immediately and roll back on `ok: false` from the server fn.
 */
const EmojiPicker = lazy(() => import('emoji-picker-react'));

export interface ReactionsWidgetProps {
	data: HomeReactionsData;
}

/**
 * Build a `unified code → slug` lookup from the catalog. The library
 * identifies every emoji by its unified (e.g. `"1f44d"` for 👍); the
 * catalog identifies the same emoji by its display codepoint string
 * (e.g. `"👍"`). This function bridges the two.
 */
function buildUnifiedToSlug(
	catalog: readonly { slug: string; codepoint: string; enabled: boolean }[],
): ReadonlyMap<string, string> {
	const out = new Map<string, string>();
	for (const entry of catalog) {
		if (!entry.enabled) continue;
		const cp = entry.codepoint.codePointAt(0);
		if (cp === undefined) continue;
		out.set(cp.toString(16), entry.slug);
	}
	return out;
}

/**
 * Skeleton placeholder rendered during SSR and during the first
 * client paint. Sized to match the mounted picker so the layout
 * does not jump after hydration.
 */
function PickerSkeleton() {
	return (
		<div
			aria-hidden="true"
			data-testid="home-reactions-picker-skeleton"
			className={css({
				width: 'full',
				height: '120',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				backgroundColor: 'bg.muted',
			})}
		/>
	);
}

export function ReactionsWidget({ data }: ReactionsWidgetProps) {
	const [aggregates, setAggregates] = useState<readonly ReactionAggregate[]>(data.aggregates);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const unifiedToSlug = useMemo(() => buildUnifiedToSlug(data.catalog), [data.catalog]);
	const visibleAggregates = aggregates.slice(0, MAX_RECORDED_CHIPS);

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

	const handleEmojiClick = (clicked: EmojiClickData) => {
		const slug = unifiedToSlug.get(clicked.unified);
		if (!slug) {
			setError(
				`${clicked.emoji} (unified=${clicked.unified}) は現在の reaction_emoji_catalog に登録されていません`,
			);
			return;
		}
		toggleReaction('emoji', slug);
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
				{mounted ? (
					<Suspense fallback={<PickerSkeleton />}>
						<EmojiPicker
							onEmojiClick={handleEmojiClick}
							emojiStyle={EmojiStyle.NATIVE}
							theme={Theme.AUTO}
							skinTonesDisabled
							searchPlaceholder="thumbs_up や :smile: などで検索"
							lazyLoadEmojis
							width="100%"
							height={420}
							previewConfig={{ showPreview: false }}
						/>
					</Suspense>
				) : (
					<PickerSkeleton />
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
