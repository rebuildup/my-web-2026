import { createServerFn } from '@tanstack/react-start';
import type { BilingualText, PublicDataLifecycleEntry } from '../../privacy/data-lifecycle';

/**
 * The published data-lifecycle wording for the footer notice
 * (Issue #1009).
 *
 * `src/privacy/data-lifecycle.ts` is the registry: it also holds
 * `pending` entries (documented, published nowhere) and per-entry
 * `evidence` / `publication.note` provenance. `PrivacyNotice` renders
 * inside the home composer, so a plain import would bundle the whole
 * registry — pending claims included — into the client JavaScript.
 * This server function is the boundary: the client receives only the
 * projected published entries, and the registry stays out of the
 * client graph because the value import is deferred into the handler.
 */
export interface PrivacyNoticeData {
	readonly entries: readonly PublicDataLifecycleEntry[];
	readonly deletionRequestChannel: { readonly statement: BilingualText };
}

export const getPrivacyNoticeData = createServerFn({ method: 'GET' }).handler(
	async (): Promise<PrivacyNoticeData> => {
		const { getPublishedPublicDataLifecycle, PUBLIC_DELETION_REQUEST_CHANNEL } = await import(
			'../../privacy/data-lifecycle'
		);
		return {
			entries: getPublishedPublicDataLifecycle(),
			deletionRequestChannel: PUBLIC_DELETION_REQUEST_CHANNEL,
		};
	},
);

/**
 * The compact pointer copy for the non-home reaction surfaces
 * (Issue #370). Same boundary rule as `getPrivacyNoticeData`: the
 * registry stays out of the client graph, so the value import is
 * deferred into the handler and the routes receive only the two
 * bilingual strings the one-line notice renders.
 */
export interface CompactPrivacyNoticeData {
	readonly statement: BilingualText;
	readonly linkLabel: BilingualText;
}

export const getCompactPrivacyNotice = createServerFn({ method: 'GET' }).handler(
	async (): Promise<CompactPrivacyNoticeData> => {
		const { PUBLIC_COMPACT_DATA_NOTICE } = await import('../../privacy/data-lifecycle');
		return PUBLIC_COMPACT_DATA_NOTICE;
	},
);
