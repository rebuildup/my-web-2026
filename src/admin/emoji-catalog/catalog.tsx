import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	insertCatalogEntryFn,
	rebindCatalogEntryFn,
	removeCatalogEntryFn,
	setCatalogEntryEnabledFn,
} from './load';
import type { AdminCatalogEntry } from './load';

/**
 * Admin emoji-catalog UI — Ticket G (branch 39).
 *
 * The create form lives in the route component (composition) so
 * `useServerFn` wiring lives next to the route loader. This view
 * owns the list + per-row actions.
 *
 * Per-row actions: rebind codepoint, toggle enabled, remove. Each
 * action is a single-purpose button so the admin UI surface area
 * matches the documented CRUD verbs.
 */
export interface CatalogViewProps {
	entries: readonly AdminCatalogEntry[];
	createForm: ReactNode;
}

export function CatalogView({ entries, createForm }: CatalogViewProps) {
	return (
		<section
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="04 — Reactions / Catalog"
					title="絵文字カタログ / Emoji catalog"
					description="リアクション用の絵文字 slug と glyph の対応表。スラッグは不透明キーなので削除しても過去のリアクションは失われません。"
					variant="spread"
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '10',
						})}
					>
						{createForm}

						<div
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '4',
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
								Entries
							</span>
							{entries.length === 0 ? (
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										color: 'text.muted',
									})}
								>
									カタログは空です。
								</p>
							) : (
								<ul
									className={css({
										margin: '0',
										padding: '0',
										listStyle: 'none',
										display: 'flex',
										flexDirection: 'column',
										gap: '3',
									})}
								>
									{entries.map((entry) => (
										<CatalogRow key={entry.slug} entry={entry} />
									))}
								</ul>
							)}
						</div>
					</div>
				</SectionHeading>
			</Container>
		</section>
	);
}

function CatalogRow({ entry }: { entry: AdminCatalogEntry }) {
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'auto minmax(0, 2fr) minmax(0, 2fr) auto' },
				alignItems: 'baseline',
				gap: { base: '2', md: '6' },
				paddingBlock: '4',
				borderBlockStart: '1px solid {colors.border.subtle}',
			})}
		>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'xl',
					color: 'text.default',
				})}
				aria-hidden="true"
			>
				{entry.codepoint}
			</span>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.default',
				})}
			>
				:{entry.slug}:
			</span>
			<span
				className={css({
					fontFamily: 'sans',
					fontSize: 'xs',
					color: 'text.muted',
				})}
				title={`updated ${entry.updatedAt}`}
			>
				{entry.enabled ? 'enabled' : 'disabled'} · by {entry.createdBy ?? 'system'} ·{' '}
				{entry.codepoint.length} cp
			</span>
			<div
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
				})}
			>
				{entry.enabled ? (
					<Badge tone="accent">enabled</Badge>
				) : (
					<Badge tone="neutral">disabled</Badge>
				)}
				<ToggleButton slug={entry.slug} enabled={entry.enabled} />
				<RebindButton slug={entry.slug} codepoint={entry.codepoint} />
				<RemoveButton slug={entry.slug} />
			</div>
		</li>
	);
}

function ToggleButton({ slug, enabled }: { slug: string; enabled: boolean }) {
	const toggle = useServerFn(setCatalogEntryEnabledFn);
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					await toggle({ data: { slug, enabled: !enabled } });
					// Refetch the route loader so the row reflects the new
					// `enabled` value (the loader is the source of truth,
					// not local state).
					await router.invalidate();
				} finally {
					setBusy(false);
				}
			}}
			className={css({
				fontFamily: 'sans',
				fontSize: 'xs',
				fontWeight: '600',
				color: 'text.muted',
				background: 'transparent',
				border: '1px solid {colors.border.subtle}',
				borderRadius: 'full',
				paddingInline: '3',
				paddingBlock: '1',
				cursor: 'pointer',
				_hover: { color: 'text.default' },
				_disabled: { opacity: '0.5' },
			})}
		>
			{busy ? '…' : enabled ? 'disable' : 'enable'}
		</button>
	);
}

function RebindButton({ slug, codepoint }: { slug: string; codepoint: string }) {
	const rebind = useServerFn(rebindCatalogEntryFn);
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={async () => {
				const next = window.prompt(`新しい glyph を入力してください (現在: ${codepoint})`);
				if (!next) return;
				setBusy(true);
				try {
					await rebind({ data: { slug, codepoint: next } });
					await router.invalidate();
				} finally {
					setBusy(false);
				}
			}}
			className={css({
				fontFamily: 'sans',
				fontSize: 'xs',
				fontWeight: '600',
				color: 'text.muted',
				background: 'transparent',
				border: '1px solid {colors.border.subtle}',
				borderRadius: 'full',
				paddingInline: '3',
				paddingBlock: '1',
				cursor: 'pointer',
				_hover: { color: 'text.default' },
				_disabled: { opacity: '0.5' },
			})}
		>
			{busy ? '…' : 'rebind'}
		</button>
	);
}

function RemoveButton({ slug }: { slug: string }) {
	const remove = useServerFn(removeCatalogEntryFn);
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={async () => {
				const ok = window.confirm(
					`slug "${slug}" をカタログから削除します。過去のリアクションは D1 に残ります。続行しますか?`,
				);
				if (!ok) return;
				setBusy(true);
				try {
					await remove({ data: { slug } });
					await router.invalidate();
				} finally {
					setBusy(false);
				}
			}}
			className={css({
				fontFamily: 'sans',
				fontSize: 'xs',
				fontWeight: '600',
				color: 'text.muted',
				background: 'transparent',
				border: '1px solid {colors.border.subtle}',
				borderRadius: 'full',
				paddingInline: '3',
				paddingBlock: '1',
				cursor: 'pointer',
				_hover: { color: 'text.default' },
				_disabled: { opacity: '0.5' },
			})}
		>
			{busy ? '…' : 'remove'}
		</button>
	);
}
