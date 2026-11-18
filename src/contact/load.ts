import { createServerFn } from '@tanstack/react-start';
import type { PublicContactChannel } from './public';

/**
 * The `/contact` channel list, resolved server-side (Issue #1009).
 *
 * `src/contact/public.ts` imports `channels.json` at module scope.
 * A route file is isomorphic — anything it imports at the top level
 * is evaluated for the client bundle too — so calling
 * `getVisiblePublicChannels` directly from the route loader shipped
 * the entire channel file (including `$note` provenance and inactive
 * entries) to every visitor's browser. This server function is the
 * boundary: the client receives only the projected records the page
 * renders, and `public.ts` stays out of the client graph because the
 * import below is type-only and the value import is deferred into
 * the handler.
 */
export const getContactChannels = createServerFn({ method: 'GET' }).handler(
	async (): Promise<readonly PublicContactChannel[]> => {
		const { getVisiblePublicChannels } = await import('./public');
		return getVisiblePublicChannels();
	},
);
