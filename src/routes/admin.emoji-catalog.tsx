import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { css } from '../../styled-system/css';
import { CatalogView } from '../admin/emoji-catalog/catalog';
import { insertCatalogEntryFn, listCatalog } from '../admin/emoji-catalog/load';
import { getCurrentSession } from '../admin/public';
import {
	buttonAccent,
	eyebrowMonoSm,
	noteMonoSmFlush,
	noteSansSmBare,
	vStackGap1,
	vStackGap4,
} from '../editorial/primitives/shared-styles';

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
	const router = useRouter();
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
			// Refetch the route loader so the new row appears in the list.
			await router.invalidate();
		} catch (err) {
			const reason = (err as { reason?: string; message?: string }).reason;
			const message = (err as { message?: string }).message;
			setError(reason ?? message ?? '作成に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={css(vStackGap4)}>
			<span className={css(eyebrowMonoSm)}>New entry</span>
			<form onSubmit={onSubmit} className={css(vStackGap4)}>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr) auto' },
						gap: '4',
						alignItems: 'end',
					})}
				>
					<label className={css(vStackGap1)}>
						<span className={css(noteSansSmBare)}>Slug (:thumbs_up: 形式)</span>
						<input
							type="text"
							name="slug"
							placeholder="thumbs_up"
							pattern="[a-z][a-z0-9_]*"
							minLength={1}
							maxLength={16}
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
					<label className={css(vStackGap1)}>
						<span className={css(noteSansSmBare)}>Glyph (1 絵文字)</span>
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
						className={css(buttonAccent)}
					>
						{busy ? 'Creating…' : 'Add'}
					</button>
				</div>

				{error && (
					<p role="alert" className={css(noteMonoSmFlush)}>
						{error}
					</p>
				)}
			</form>
		</div>
	);
}
