import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { css } from '../../styled-system/css';
import { KeysView } from '../admin/keys/keys';
import { createApiKey, listApiKeys } from '../admin/keys/load';
import { getCurrentSession } from '../admin/public';
import type { ApiKeyPermissions } from '../admin/keys/load';

/**
 * `/admin/keys` — admin API key management.
 *
 * Loader: admin-only. Lists existing API keys plus their scopes.
 * The create form lives in this route component (composition over a
 * generic UI primitive) so that `useServerFn(createApiKey)` wires
 * here, and the view stays free of server-only imports.
 *
 * The plaintext key returned by `createApiKey` is shown exactly once
 * inside the create form, then never again (the plugin hashes before
 * persisting).
 */
export const Route = createFileRoute('/admin/keys')({
	loader: async () => {
		const session = await getCurrentSession();
		if (!session) {
			throw redirect({ to: '/admin/login' });
		}
		if (session.user.role !== 'admin') {
			throw redirect({ to: '/admin' });
		}
		const keys = await listApiKeys({ data: {} });
		return { keys };
	},
	component: KeysRoute,
});

function KeysRoute() {
	const { keys } = Route.useLoaderData();
	return <KeysView keys={keys} createForm={<CreateKeyForm />} />;
}

const RESOURCE_LABELS: Record<string, string> = {
	access_counter: 'access_counter',
	reactions: 'reactions',
};

function CreateKeyForm() {
	const create = useServerFn(createApiKey);
	const [name, setName] = useState('');
	const [scopes, setScopes] = useState<Record<string, { read: boolean; write: boolean }>>({
		access_counter: { read: false, write: false },
		reactions: { read: false, write: false },
	});
	const [busy, setBusy] = useState(false);
	const [plaintext, setPlaintext] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const toggleScope = (resource: string, action: 'read' | 'write') => {
		setScopes((prev) => ({
			...prev,
			[resource]: { ...prev[resource], [action]: !prev[resource][action] },
		}));
	};

	const anyScopeSelected = Object.values(scopes).some((s) => s.read || s.write);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const permissions: Record<string, ('read' | 'write')[]> = {};
			for (const [resource, s] of Object.entries(scopes)) {
				const actions: ('read' | 'write')[] = [];
				if (s.read) actions.push('read');
				if (s.write) actions.push('write');
				if (actions.length > 0) permissions[resource] = actions;
			}
			const typedPermissions = permissions as ApiKeyPermissions;
			const result = await create({ data: { name, permissions: typedPermissions } });
			setPlaintext(result.plaintext);
			setName('');
			setScopes({
				access_counter: { read: false, write: false },
				reactions: { read: false, write: false },
			});
		} catch (err) {
			const reason = (err as { reason?: string }).reason;
			setError(reason ?? '作成に失敗しました。');
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
				New API key
			</span>
			<form
				onSubmit={onSubmit}
				className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
			>
				<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
					<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
						Name
					</span>
					<input
						type="text"
						name="name"
						placeholder="my-other-repo (display name)"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						minLength={1}
						maxLength={120}
						className={css({
							fontFamily: 'sans',
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

				<fieldset
					className={css({
						border: 'none',
						padding: '0',
						margin: '0',
						display: 'flex',
						flexDirection: 'column',
						gap: '3',
					})}
				>
					<legend
						className={css({
							fontFamily: 'sans',
							fontSize: 'sm',
							color: 'text.muted',
							padding: '0',
							margin: '0',
						})}
					>
						Scopes (resource / action)
					</legend>
					{Object.keys(RESOURCE_LABELS).map((resource) => (
						<div
							key={resource}
							className={css({
								display: 'grid',
								gridTemplateColumns: 'minmax(0, 2fr) auto auto',
								alignItems: 'center',
								gap: '4',
								paddingBlock: '2',
								paddingInline: '3',
								border: '1px solid {colors.border.subtle}',
								borderRadius: '4',
							})}
						>
							<span className={css({ fontFamily: 'mono', fontSize: 'sm', color: 'text.default' })}>
								{RESOURCE_LABELS[resource]}
							</span>
							<ScopeCheckbox
								label="read"
								checked={scopes[resource]?.read ?? false}
								onChange={() => toggleScope(resource, 'read')}
							/>
							<ScopeCheckbox
								label="write"
								checked={scopes[resource]?.write ?? false}
								onChange={() => toggleScope(resource, 'write')}
							/>
						</div>
					))}
				</fieldset>

				<button
					type="submit"
					disabled={busy || name.length === 0 || !anyScopeSelected}
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
					{busy ? 'Creating…' : 'Create API key'}
				</button>
			</form>

			{error && (
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{error}
				</p>
			)}

			{plaintext && (
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
						paddingBlock: '4',
						paddingInline: '4',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '4',
						background: 'bg.surface',
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
						Plaintext key (1 回のみ表示 / shown once)
					</span>
					<code
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							wordBreak: 'break-all',
							color: 'text.default',
						})}
					>
						{plaintext}
					</code>
					<button
						type="button"
						onClick={() => navigator.clipboard.writeText(plaintext)}
						className={css({
							alignSelf: 'flex-start',
							fontFamily: 'sans',
							fontSize: 'xs',
							fontWeight: '600',
							color: 'text.inverse',
							background: 'bg.accent',
							border: 'none',
							borderRadius: 'full',
							paddingInline: '3',
							paddingBlock: '1',
							cursor: 'pointer',
						})}
					>
						copy
					</button>
				</div>
			)}
		</div>
	);
}

function ScopeCheckbox({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<label
			className={css({
				display: 'inline-flex',
				alignItems: 'center',
				gap: '2',
				fontFamily: 'sans',
				fontSize: 'xs',
				color: 'text.muted',
				cursor: 'pointer',
			})}
		>
			<input type="checkbox" checked={checked} onChange={onChange} />
			{label}
		</label>
	);
}
