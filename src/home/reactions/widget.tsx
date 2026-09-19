import { useMemo, useState, useTransition } from 'react';
import { css } from '../../../styled-system/css';
import type { ReactionAggregate } from '../../http/reactions/schema';
import {
	MAX_EMOJI_SLUG_LEN,
	listActiveSlugs,
	resolveEmojiSlug,
	validateEmojiSlug,
} from './emoji-catalog';
import type { HomeReactionsData } from './load';
import { addHomeReaction, removeHomeReaction } from './load';

const MAX_CHIPS = 8;
const SLUG_PATTERN = /:[a-z][a-z0-9_]*:/;

/**
 * Visitor-facing emoji reactions widget for the home page (Ticket E).
 *
 * Reactions are stored as opaque `:slug:` identifiers (e.g.
 * `:thumbs_up:`). The catalog (`emoji-catalog.ts`) maps slugs to
 * emoji codepoints at render time so the home stays the single place
 * that knows how to draw a reaction. The reactions API treats the
 * `value` field as an opaque string ≤16 chars, so the storage shape
 * is unchanged from the backend's perspective.
 *
 * UX:
 *   - Click on an existing chip to remove your prior reaction (the
 *     server dedupes by `(target_key, principal, actor_id, kind,
 *     value)`, so a returning visitor sees the chip they already
 *     reacted to and can deselect it).
 *   - Click on a picker chip (the second row, sourced from
 *     `EMOJI_CATALOG`) to add a new reaction.
 *   - Type `:slug:` in the input and press 送信 to submit. Slug
 *     validation runs on both client (here) and server (load.ts).
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
	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);

	const visibleAggregates = aggregates.slice(0, MAX_CHIPS);
	// Catalog is now DB-backed (Ticket G, branch 39). The SSR loader
	// primes the active set; the picker always shows the full active
	// vocabulary. Visitor-membership is not tracked client-side in
	// 0.3.0 (see ADR-0011), so the server dedupes any duplicate PUT.
	const pickerSlugs = useMemo(() => listActiveSlugs(data.catalog), [data.catalog]);

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

	const submitDraft = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const value = draft.trim().toLowerCase();
		if (!SLUG_PATTERN.test(value)) {
			setError('invalid_slug_format');
			return;
		}
		try {
			const slug = validateEmojiSlug(data.catalog, value.slice(1, -1));
			toggleReaction('emoji', slug);
			setDraft('');
		} catch (e) {
			setError(e instanceof Error ? e.message : 'invalid_slug');
		}
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
				gap: '4',
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
						まだ反応はありません — 最初のリアクションを送ってみましょう
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
					flexWrap: 'wrap',
					gap: '2',
					border: 'none',
					padding: '0',
					margin: '0',
				})}
			>
				{pickerSlugs.map((slug) => {
					const glyph = resolveEmojiSlug(data.catalog, slug) ?? '?';
					return (
						<button
							key={slug}
							type="button"
							disabled={pending}
							onClick={() => toggleReaction('emoji', slug)}
							title={`:${slug}:`}
							className={css({
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: '8',
								height: '8',
								borderRadius: 'full',
								borderWidth: '1px',
								borderColor: 'border.subtle',
								borderStyle: 'solid',
								backgroundColor: 'bg.canvas',
								color: 'text.default',
								fontSize: 'lg',
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
						</button>
					);
				})}
			</fieldset>

			<form
				onSubmit={submitDraft}
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
				})}
			>
				<label
					htmlFor="home-reactions-draft"
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
					})}
				>
					+ :slug:
				</label>
				<input
					id="home-reactions-draft"
					name="emoji"
					type="text"
					value={draft}
					maxLength={MAX_EMOJI_SLUG_LEN + 2}
					onChange={(e) => setDraft(e.target.value)}
					placeholder=":thumbs_up:"
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						paddingInline: '3',
						height: '8',
						minWidth: '20',
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
				<button
					type="submit"
					disabled={pending || draft.trim().length === 0}
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						paddingInline: '4',
						height: '8',
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
						_disabled: { opacity: 0.6, cursor: 'not-allowed' },
					})}
				>
					送信
				</button>
			</form>
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
