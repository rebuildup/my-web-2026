import { createServerFn } from '@tanstack/react-start';
import { probeCloudflareHealth } from '../../cloudflare/health';
import { getExternalBoundaryHealth } from './health';
import type { SystemServiceStatus } from './health';

/**
 * Assemble the status snapshot required by the home surface.
 *
 * Home owns the composition. Cloudflare and HTTP own their own health
 * contracts, so changes to binding probes do not belong to Home. The
 * external-boundary descriptor was moved here from `src/http/`
 * because the home status tiles are its sole consumer.
 */
export const getHomeSystemStatus = createServerFn({ method: 'GET' }).handler(
	async (): Promise<readonly SystemServiceStatus[]> => {
		const cloudflare = await probeCloudflareHealth();
		const external = getExternalBoundaryHealth();
		return [external, ...cloudflare];
	},
);
