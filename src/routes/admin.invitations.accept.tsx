import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { AcceptInvitationView } from '../admin/invitations/accept-view';
import { acceptInvitation, probeInvitation } from '../admin/invitations/accept';

/**
 * `/admin/invitations/accept?token=...` — invitation landing page.
 *
 * Probes the invitation token server-side and renders one of three
 * states (invalid, expired/consumed, valid form). The probe is the
 * ONLY information leak about the token: the plaintext token never
 * appears in logs, error responses, or referer headers after this
 * page loads.
 *
 * The view receives the server-side `acceptInvitation` as a
 * `submit` prop so the view file remains free of
 * `@tanstack/react-start/server` imports.
 */
const SearchSchema = z.object({
	token: z.string().min(20).max(256),
});

export const Route = createFileRoute('/admin/invitations/accept')({
	validateSearch: SearchSchema,
	loaderDeps: ({ search }) => ({ token: search.token }),
	loader: async ({ deps }) => {
		const probe = await probeInvitation({ data: { token: deps.token } });
		return { probe, token: deps.token };
	},
	component: AcceptInvitationRoute,
});

function AcceptInvitationRoute() {
	const { probe, token } = Route.useLoaderData();
	const accept = useServerFn(acceptInvitation);
	return (
		<AcceptInvitationView
			probe={probe}
			token={token}
			submit={async ({ name, password }) => {
				const result = await accept({ data: { token, name, password } });
				return result;
			}}
		/>
	);
}
