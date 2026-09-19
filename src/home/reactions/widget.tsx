import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { css } from '../../../styled-system/css';
import { EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';
import type { ReactionAggregate } from '../../http/reactions/schema';
import { resolveEmojiSlug } from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { addHomeReaction, removeHomeReaction } from './load';

const MAX_RECORDED_CHIPS = 8;
const EMOJI_SLUG_REGEX = /^[a-z][a-z0-9_]*$/;
const MAX_EMOJI_SLUG_LEN = 16;

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
 * Branch 43 picker rewrite — `emoji-picker-react` integration +
 * visitor-driven catalog growth:
 *
 *   - The library picker (ealush/emoji-picker-react v4) owns the
 *     full picker UX: category navigation, search, sticky section
 *     headers, scroll viewport. We render it with
 *     `emojiStyle="native"` so every glyph is a plain Unicode
 *     character — there is **no** CDN fetch and **no** bundled emoji
 *     image set in the SSR / client bundles.
 *
 *   - `reaction_emoji_catalog` is the canonical storage mapping.
 *     When the visitor clicks an emoji the picker resolves to a
 *     slug + codepoint; if the slug is **already** in the catalog
 *     the loader accepts it as before; if the slug is **unknown**
 *     the loader auto-inserts it (with `created_by='visitor'` and
 *     the picker-supplied codepoint) before forwarding the reaction
 *     to /api/v1/reactions. This lets visitors react with any
 *     standard Unicode emoji without operator intervention — the
 *     catalog grows organically. Admin-disabled slugs are still
 *     rejected (auto-register never silently re-enables a curated
 *     entry).
 *
 *   - The picker is rendered inside a native `<dialog>` opened by a
 *     trigger button. It is **not** embedded in the page; ESC and
 *     backdrop click close it. The library is loaded lazily and only
 *     when the dialog opens, keeping the SSR HTML small and the
 *     initial paint focused on the recorded-reactions panel.
 *
 *   - When a recorded reaction chip is decremented to count 0 (the
 *     visitor removed their only reaction), the chip is dropped from
 *     the local state instead of rendering as "0". This matches the
 *     aggregate API contract — a `(kind, value)` with `count === 0`
 *     is not surfaced.
 *
 * State is optimistic and fire-and-forget — the click handler applies
 * the new aggregate list immediately and returns without awaiting the
 * server fn. We do NOT roll back the optimistic state on `ok: false`;
 * the rollback blink was the dominant source of perceived lag (branch
 * 43 visitor feedback), and the next page load reconciles with the
 * real aggregate state. Server errors surface as an inline alert and
 * a `console.error`, but the visitor's chip stays visible.
 */
const EmojiPicker = lazy(() => import('emoji-picker-react'));

export interface ReactionsWidgetProps {
	data: HomeReactionsData;
}

/**
 * Derive a catalog-shaped slug from an `EmojiClickData` event.
 *
 *   - First try `clicked.names` — the library ships up-to-date
 *     Unicode CLDR names; we pick the first one that fits the
 *     `^[a-z][a-z0-9_]*$` slug grammar (e.g. `thumbs_up`).
 *   - If no name fits (rare; e.g. some newer Unicode additions), fall
 *     back to `u_<unified-lowercase>` (e.g. `u_1faf6`). This is a
 *     stable, opaque identifier that still passes the slug grammar.
 *
 * Returns `null` when neither path yields a valid slug — caller
 * surfaces an inline error instead of forwarding the reaction.
 *
 * Exported for unit testing.
 */
export function deriveSlugFromPicker(clicked: EmojiClickData): string | null {
	for (const name of clicked.names) {
		if (name.length >= 1 && name.length <= MAX_EMOJI_SLUG_LEN && EMOJI_SLUG_REGEX.test(name)) {
			return name;
		}
	}
	const fallback = `u_${clicked.unified.toLowerCase()}`;
	if (fallback.length <= MAX_EMOJI_SLUG_LEN && EMOJI_SLUG_REGEX.test(fallback)) {
		return fallback;
	}
	return null;
}

/**
 * Skeleton placeholder rendered inside the picker slot during SSR
 * and during the lazy chunk load. Sized to match the mounted picker
 * so the dialog's content area does not jump after hydration.
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

interface PickerModalProps {
	/** Controlled open state — drives `dialog.showModal()` / `close()`. */
	open: boolean;
	onClose: () => void;
	onSelect: (clicked: EmojiClickData) => void;
}

/**
 * Native `<dialog>` modal hosting the emoji picker. The dialog is
 * always mounted so React keeps a stable node for the lazy chunk to
 * hydrate into; visibility is owned by the browser (closed by default
 * until `showModal()` is called).
 */
function PickerModal({ open, onClose, onSelect }: PickerModalProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	const handleSelect = (clicked: EmojiClickData) => {
		onSelect(clicked);
		onClose();
	};

	// Backdrop click — the dialog element itself is the click target
	// for clicks outside the inner content. Native <dialog> already
	// dispatches ESC as a `cancel` event → `close`, so we don't need a
	// redundant onKeyDown. The biome `useKeyWithClickEvents` rule is
	// aware of `onClose` + `onClick` on `<dialog>` in upstream but not
	// in our pinned 1.9.x release, so we scope the suppression here.
	const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDialogElement>) => {
		if (event.target === dialogRef.current) onClose();
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: <dialog> handles ESC natively via the `cancel` event
		<dialog
			ref={dialogRef}
			aria-label="Add a reaction"
			onClose={onClose}
			onClick={handleBackdropMouseDown}
			className={css({
				border: 'none',
				padding: '0',
				backgroundColor: 'transparent',
				color: 'text.default',
				maxWidth: '120',
				width: 'calc(100vw - 32px)',
				borderRadius: 'lg',
				'&::backdrop': {
					backgroundColor: 'rgba(0, 0, 0, 0.45)',
				},
			})}
		>
			<div
				className={css({
					overflow: 'hidden',
					borderRadius: 'lg',
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: 'border.subtle',
					backgroundColor: 'bg.canvas',
				})}
			>
				<Suspense fallback={<PickerSkeleton />}>
					<EmojiPicker
						onEmojiClick={handleSelect}
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
			</div>
		</dialog>
	);
}

export function ReactionsWidget({ data }: ReactionsWidgetProps) {
	const [aggregates, setAggregates] = useState<readonly ReactionAggregate[]>(data.aggregates);
	const [error, setError] = useState<string | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);

	const visibleAggregates = aggregates.slice(0, MAX_RECORDED_CHIPS);

	const toggleReaction = (
		kind: ReactionAggregate['kind'],
		value: string,
		codepoint?: string,
	): void => {
		setError(null);
		const before = aggregates;
		const exists = before.some((a) => a.kind === kind && a.value === value);
		// Optimistic update: when an existing chip is decremented and
		// hits 0, drop it from the local list. The upstream reactions
		// API surfaces aggregates with `count > 0`, so showing a "0"
		// chip in the UI would be inconsistent with what a fresh
		// load would render.
		const next: ReactionAggregate[] = exists
			? before
					.map((a) => (a.kind === kind && a.value === value ? { ...a, count: a.count - 1 } : a))
					.filter((a) => a.count > 0)
			: [...before, { kind, value, count: 1 }];
		setAggregates(next);

		// Fire-and-forget: the click handler must return immediately so
		// the chip animation + modal close feel instant. The server
		// call runs in the background; an error only surfaces as a
		// toast — we do NOT roll the optimistic state back, because
		// the laggy rollback blink is the worse UX (per branch 43
		// visitor feedback: "リアクションつけるときラグがあるから
		// そこは非同期でいい"). The next page load reconciles with the
		// real aggregate state.
		const target = data.target_key;
		const promise = exists
			? removeHomeReaction({ data: { target, kind, value } })
			: addHomeReaction({ data: { target, kind, value, codepoint } });
		void promise
			.then((result) => {
				if (!result.ok) setError(result.reason ?? 'upstream_error');
			})
			.catch((err: unknown) => {
				console.error('[home.reactions] toggle failed', err);
				setError('upstream_error');
			});
	};

	const handlePickerSelect = (clicked: EmojiClickData) => {
		const slug = deriveSlugFromPicker(clicked);
		if (!slug) {
			setError(`${clicked.emoji} (unified=${clicked.unified}) の slug を導出できませんでした`);
			return;
		}
		toggleReaction('emoji', slug, clicked.emoji);
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
						まだ反応はありません — 下のボタンから送ってみましょう
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

			<div>
				<button
					type="button"
					onClick={() => setPickerOpen(true)}
					data-testid="home-reactions-open-picker"
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						gap: '2',
						paddingInline: '4',
						height: '9',
						borderRadius: 'md',
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
					})}
				>
					<span aria-hidden="true">+</span>
					リアクションを追加
				</button>
			</div>

			<PickerModal
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				onSelect={handlePickerSelect}
			/>
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
