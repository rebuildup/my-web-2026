import { createFileRoute, redirect } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { css } from '../../styled-system/css';
import { CatalogView } from '../admin/emoji-catalog/catalog';
import { insertCatalogEntryFn, listCatalog } from '../admin/emoji-catalog/load';
import { getCurrentSession } from '../admin/public';

/**
 * `/admin/emoji-catalog` — admin reaction emoji catalog CRUD
 * (Ticket G, branch 39).
 *
 * Loader: admin-only. Lists every catalog row (enabled + disabled)
 * with timestamps. The create form lives in this route component
 * so `useServerFn(insertCatalogEntryFn)` wires here, and the view
 * stays free of server-only imports.
 */
export const Route = createFileRoute('/admin/emoji-catalog')({
	loader: async () => {
		const session = await getCurrentSession();
		if (!session) {
			throw redirect({ to: '/admin/login' });
		}
		if (session.user.role !== 'admin') {
			throw redirect({ to: '/admin' });
		}
		const entries = await listCatalog({ data: {} });
		return { entries };
	},
	component: EmojiCatalogRoute,
});

function EmojiCatalogRoute() {
	const { entries } = Route.useLoaderData();
	return <CatalogView entries={entries} createForm={<CreateEntryForm />} />;
}

function CreateEntryForm() {
	const create = useServerFn(insertCatalogEntryFn);
	const [slug, setSlug] = useState('');
	const [codepoint, setCodepoint] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await create({ data: { slug, codepoint } });
			setSlug('');
			setCodepoint('');
		} catch (err) {
			const reason = (err as { reason?: string; message?: string }).reason;
			const message = (err as { message?: string }).message;
			setError(reason ?? message ?? '作成に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
				})}
			>
				New entry
			</span>
			<form
				onSubmit={onSubmit}
				className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
			>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr) auto' },
						gap: '4',
						alignItems: 'end',
					})}
				>
					<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
						<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
							Slug (:thumbs_up: 形式)
						</span>
						<input
							type="text"
							name="slug"
							placeholder="thumbs_up"
							pattern="[a-z][a-z0-9_]*"
							minLength={1}
							maxLength={32}
							value={slug}
							onChange={(e) => setSlug(e.target.value.toLowerCase())}
							required
							className={css({
								fontFamily: 'mono',
								fontSize: 'md',
								paddingInline: '3',
								paddingBlock: '2',
								border: '1px solid {colors.border.subtle}',
								borderRadius: '4',
								background: 'bg.surface',
								color: 'text.default',
							})}
						/>
					</label>
					<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
						<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
							Glyph (1 絵文字)
						</span>
						<input
							type="text"
							name="codepoint"
							placeholder="👍"
							minLength={1}
							maxLength={16}
							value={codepoint}
							onChange={(e) => setCodepoint(e.target.value)}
							required
							className={css({
								fontFamily: 'sans',
								fontSize: 'lg',
								paddingInline: '3',
								paddingBlock: '2',
								border: '1px solid {colors.border.subtle}',
								borderRadius: '4',
								background: 'bg.surface',
								color: 'text.default',
							})}
						/>
					</label>
					<button
						type="submit"
						disabled={busy || slug.length === 0 || codepoint.length === 0}
						className={css({
							fontFamily: 'sans',
							fontSize: 'md',
							fontWeight: '600',
							color: 'text.inverse',
							background: 'bg.accent',
							border: 'none',
							borderRadius: '4',
							paddingBlock: '3',
							paddingInline: '6',
							cursor: 'pointer',
							_disabled: { opacity: '0.5' },
						})}
					>
						{busy ? 'Creating…' : 'Add'}
					</button>
				</div>

				{error && (
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
				)}
			</form>
		</div>
	);
}
