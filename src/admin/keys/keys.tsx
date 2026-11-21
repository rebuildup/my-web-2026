import { useServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	bodySansMdPlain,
	buttonGhost,
	eyebrowMonoSm,
	listStackGap3,
	noteMonoSm,
	noteSansMdPlain,
	rowGap3,
	spaceCompact,
	spaceSection,
	vStackGap4,
	vStackGap10,
} from '../../editorial/primitives/shared-styles';
import { deleteApiKey } from './load';
import type { AdminApiKey } from './load';

/**
 * Admin API keys UI.
 *
 * The step-up panel and the create form are composed by the route and
 * arrive here as one `createSection` node, so the route can share one
 * step-up state between "confirm" and "create" without this view
 * importing any server-only module. Plaintext key disclosure happens
 * inside the create form, shown exactly once at creation time (the
 * Better Auth plugin hashes before persisting; we never see the
 * plaintext again).
 *
 * Permissions shape (resource/action) is project-owned:
 *   `{ access_counter: ["read","write"], reactions: ["read","write"] }`
 * See ADR-0009 §3.
 */
export interface KeysViewProps {
	keys: readonly AdminApiKey[];
	createSection: ReactNode;
}

export function KeysView({ keys, createSection }: KeysViewProps) {
	return (
		<section
			className={css({
				paddingBlock: spaceSection,
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="02 — API keys"
					title="API キー / API keys"
					description="他のレポジトリから my-web-2026 の API を呼ぶための Bearer キー。plaintext は作成時に一度だけ表示。"
					variant="spread"
				>
					<div className={css(vStackGap10)}>
						{createSection}

						<div className={css(vStackGap4)}>
							<span className={css(eyebrowMonoSm)}>Issued</span>
							{keys.length === 0 ? (
								<p className={css(noteSansMdPlain)}>まだ API キーはありません。</p>
							) : (
								<ul className={css(listStackGap3)}>
									{keys.map((k) => (
										<KeyRow key={k.id} apiKey={k} />
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

function KeyRow({ apiKey }: { apiKey: AdminApiKey }) {
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 3fr) minmax(0, 4fr) auto' },
				alignItems: 'baseline',
				gap: spaceCompact,
				paddingBlock: '4',
				borderBlockStart: '1px solid {colors.border.subtle}',
			})}
		>
			<span className={css(noteMonoSm)}>
				{apiKey.prefix ?? 'mk_'}
				{apiKey.start ? `…${apiKey.start}` : ''}
			</span>
			<span className={css(bodySansMdPlain)}>
				{apiKey.name ?? '(unnamed)'} — {summarizePermissions(apiKey.permissions)}
			</span>
			<div className={css(rowGap3)}>
				{apiKey.enabled ? (
					<Badge tone="accent">enabled</Badge>
				) : (
					<Badge tone="neutral">disabled</Badge>
				)}
				<RevokeButton id={apiKey.id} />
			</div>
		</li>
	);
}

function summarizePermissions(perms: AdminApiKey['permissions']): string {
	const entries = Object.entries(perms);
	if (entries.length === 0) return 'no scopes';
	return entries
		.map(([resource, actions]) => `${resource}:${(actions ?? []).join('+')}`)
		.join(', ');
}

function RevokeButton({ id }: { id: string }) {
	const revoke = useServerFn(deleteApiKey);
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					await revoke({ data: { id } });
				} finally {
					setBusy(false);
				}
			}}
			className={css(buttonGhost)}
		>
			{busy ? '…' : 'revoke'}
		</button>
	);
}
