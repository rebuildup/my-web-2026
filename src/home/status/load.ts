import { createServerFn } from '@tanstack/react-start';
import { probeCloudflareHealth } from '../../cloudflare/health';
import { getExternalBoundaryHealth } from '../../http/health';
import type { SystemServiceStatus } from './health';

/**
 * Assemble the status snapshot required by the home surface.
 *
 * Home owns the composition. Cloudflare and HTTP own their own health
 * contracts, so changes to binding probes do not belong to Home.
 */
export const getHomeSystemStatus = createServerFn({ method: 'GET' }).handler(
	async (): Promise<readonly SystemServiceStatus[]> => {
		const cloudflare = await probeCloudflareHealth();
		const external = getExternalBoundaryHealth();
		return [external, ...cloudflare];
	},
);
