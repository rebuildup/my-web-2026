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
 * (`height={420}`) so the dialog's content area does not jump after
 * hydration. The border colour matches the modal's
 * `--epr-picker-border-color` override (see `PickerModal`) so the
 * skeleton and the picker read as the same surface.
 */
function PickerSkeleton() {
	return (
		<div
			aria-hidden="true"
			data-testid="home-reactions-picker-skeleton"
			className={css({
				width: 'full',
				height: '420px',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.strong',
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
				// Native <dialog> UA stylesheet already centers the
				// element via `position: fixed; inset: 0; margin: auto`,
				// but we restate the explicit positioning so cross-
				// browser quirks (and any future CSS reset that
				// touches `dialog`) cannot desync our intent.
				position: 'fixed',
				inset: '0',
				margin: 'auto',
				border: 'none',
				padding: '0',
				backgroundColor: 'transparent',
				color: 'text.default',
				// `maxWidth` and `width` use literal `rem` values because
				// Panda's spacing scale tops out at `96` (24rem); passing
				// a non-token numeric like `'120'` would compile to
				// `120px` and crush the picker into a 3-emoji-wide
				// column (visitor feedback: "おかしなところに表示され
				// るし極端に縦長").
				maxWidth: '30rem',
				width: 'calc(100vw - 32px)',
				maxHeight: 'min(560px, 85vh)',
				height: 'auto',
				borderRadius: 'lg',
				'&::backdrop': {
					backgroundColor: 'rgba(0, 0, 0, 0.45)',
				},
			})}
		>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
					borderRadius: 'lg',
					// The picker library draws its own 1px border via
					// `--epr-picker-border-color`; we let it serve as
					// the modal border so the picker and the dialog
					// read as one surface (no doubled hairline). The
					// picker's default #e7e7e7 is too light against
					// bg.canvas, so we override the CSS variable to
					// `border.strong` instead of stacking another
					// border on the wrapper.
					'--epr-picker-border-color': 'colors.border.strong',
					backgroundColor: 'bg.canvas',
					// Picker's internal `.epr-body` is the only
					// scrollable element. Style its scrollbar to
					// match the editorial palette: thin, rounded,
					// brand-aware thumb. Firefox uses the
					// `scrollbar-*` longhands; WebKit/Blink fall
					// through to the pseudo-element rules below.
					'& .epr-body': {
						scrollbarWidth: 'thin',
						scrollbarColor: '{colors.border.strong} transparent',
					},
					'& .epr-body::-webkit-scrollbar': {
						width: '8px',
						height: '8px',
					},
					'& .epr-body::-webkit-scrollbar-track': {
						backgroundColor: 'transparent',
					},
					'& .epr-body::-webkit-scrollbar-thumb': {
						backgroundColor: '{colors.border.strong}',
						borderRadius: '999px',
						border: '2px solid transparent',
						backgroundClip: 'padding-box',
					},
					'& .epr-body::-webkit-scrollbar-thumb:hover': {
						backgroundColor: '{colors.text.muted}',
						backgroundClip: 'padding-box',
					},
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

/**
 * Local aggregate shape — the server-facing `ReactionAggregate`
 * (`kind`, `value`, `count`) plus an optional `codepoint` captured at
 * click time so the chip can render the actual glyph even before the
 * server-side auto-register lands the slug in `data.catalog`.
 *
 * `codepoint` is **client-side only**. It is never sent to the
 * server — the picker-to-catalog contract flows through the dedicated
 * `codepoint` field on `addHomeReaction`'s input schema.
 */
type LocalReactionAggregate = ReactionAggregate & { codepoint?: string };

export interface ComputeToggleInput {
	currentViewerReactions: readonly { kind: 'emoji' | 'image'; value: string }[];
	currentAggregates: readonly LocalReactionAggregate[];
	kind: ReactionAggregate['kind'];
	value: string;
	codepoint?: string;
}

export interface ComputeToggleOutput {
	/** Which server call the click handler should fire. */
	action: 'add' | 'remove';
	/** Next `viewer_reactions` snapshot — mirrors the optimistic state after this click. */
	nextViewerReactions: readonly { kind: 'emoji' | 'image'; value: string }[];
	/** Next `aggregates` snapshot — mirrors the optimistic chip layout after this click. */
	nextAggregates: readonly LocalReactionAggregate[];
}

/**
 * Pure toggle state machine — extracted from the widget so the
 * ADD → REMOVE → ADD interaction can be unit-tested without a DOM.
 *
 * Toggle decision uses the visitor's own reaction set, NOT the
 * public aggregate count. The aggregate count is "everyone's total"
 * — a second visitor to click an emoji a prior visitor reacted with
 * sees `count > 0` but has never reacted with it themselves.
 * Sending DELETE then would optimistically decrement and bounce
 * back on the next reload (P1 review finding).
 *
 * Optimistic aggregate mutation:
 *   - remove → decrement matching chip; drop the chip if its count
 *     hits 0 (the upstream API never surfaces count=0 chips).
 *   - add → INCREMENT matching chip if it already exists from
 *     another visitor's reaction; otherwise APPEND with count=1 +
 *     picker-supplied codepoint. The previous widget code APPENDED
 *     unconditionally, which produced a duplicate chip when the
 *     emoji was already in the aggregate (P1 review finding — the
 *     chip count went `…5, 1` instead of `…6`).
 */
export function computeToggleState(input: ComputeToggleInput): ComputeToggleOutput {
	const exists = input.currentViewerReactions.some(
		(r) => r.kind === input.kind && r.value === input.value,
	);
	if (exists) {
		return {
			action: 'remove',
			nextViewerReactions: input.currentViewerReactions.filter(
				(r) => !(r.kind === input.kind && r.value === input.value),
			),
			nextAggregates: input.currentAggregates
				.map((a) =>
					a.kind === input.kind && a.value === input.value ? { ...a, count: a.count - 1 } : a,
				)
				.filter((a) => a.count > 0),
		};
	}
	const alreadyInAggregate = input.currentAggregates.find(
		(a) => a.kind === input.kind && a.value === input.value,
	);
	const nextAggregates = alreadyInAggregate
		? input.currentAggregates.map((a) =>
				a.kind === input.kind && a.value === input.value ? { ...a, count: a.count + 1 } : a,
			)
		: [
				...input.currentAggregates,
				{ kind: input.kind, value: input.value, count: 1, codepoint: input.codepoint },
			];
	return {
		action: 'add',
		nextViewerReactions: [
			...input.currentViewerReactions,
			{ kind: input.kind, value: input.value },
		],
		nextAggregates,
	};
}

export function ReactionsWidget({ data }: ReactionsWidgetProps) {
	const [aggregates, setAggregates] = useState<readonly LocalReactionAggregate[]>(data.aggregates);
	// Local mirror of `data.viewer_reactions` so the toggle predicate
	// reflects the visitor's most recent successful action, not just
	// the SSR snapshot. Without this, a second click on a chip this
	// visitor already added would still see `exists === false` and
	// send a redundant PUT (P1 review finding — the local state did
	// not update after the first click).
	const [viewerReactions, setViewerReactions] = useState<
		readonly { kind: 'emoji' | 'image'; value: string }[]
	>(data.viewer_reactions);
	const [error, setError] = useState<string | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);

	const visibleAggregates = aggregates.slice(0, MAX_RECORDED_CHIPS);

	/**
	 * Resolve a chip to its visible glyph. The DB-backed catalog
	 * (`data.catalog`) is the canonical source; when the slug isn't
	 * there yet (visitor-driven auto-register hasn't landed on a
	 * subsequent page load), the picker-supplied codepoint carries the
	 * chip until the catalog catches up.
	 */
	const resolveChipGlyph = (chip: LocalReactionAggregate): string => {
		if (chip.kind === 'emoji') {
			return resolveEmojiSlug(data.catalog, chip.value) ?? chip.codepoint ?? `:${chip.value}:`;
		}
		return '?';
	};

	const toggleReaction = (
		kind: ReactionAggregate['kind'],
		value: string,
		codepoint?: string,
	): void => {
		setError(null);
		const { action, nextAggregates, nextViewerReactions } = computeToggleState({
			currentViewerReactions: viewerReactions,
			currentAggregates: aggregates,
			kind,
			value,
			codepoint,
		});
		setAggregates(nextAggregates);
		setViewerReactions(nextViewerReactions);

		// Fire-and-forget: the click handler must return immediately so
		// the chip animation + modal close feel instant. The server
		// call runs in the background; an error only surfaces as a
		// toast — we do NOT roll the optimistic state back, because
		// the laggy rollback blink is the worse UX (per branch 43
		// visitor feedback: "リアクションつけるときラグがあるから
		// そこは非同期でいい"). The next page load reconciles with the
		// real aggregate state.
		const target = data.target_key;
		const promise =
			action === 'remove'
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
						const glyph = resolveChipGlyph(chip);
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
