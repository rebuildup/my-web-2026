import type { SystemService } from './health';

/**
 * Services the home status surface explains to visitors.
 *
 * The platform owns how each service is probed. Home owns only the
 * presentation metadata and the order in which services are shown.
 */
export const SYSTEM_SERVICES: readonly SystemService[] = [
	{
		id: 'external-boundary',
		label: 'External boundary',
		binding: 'Hono',
		description: 'Public REST endpoints at /api/v1/*.',
	},
	{
		id: 'd1',
		label: 'Internal data',
		binding: 'D1',
		description: 'Structured content queried via createServerFn.',
	},
	{
		id: 'r2',
		label: 'Media',
		binding: 'R2',
		description: 'Blob storage for media and assets.',
	},
] as const;
