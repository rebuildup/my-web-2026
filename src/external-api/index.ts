/**
 * Public surface of the external-read obligation (Issue #499).
 *
 * Consumers import from here rather than from a module inside the
 * obligation, so the internal split (contract / transport / reader /
 * adapter / display) can move without touching call sites. Only what a
 * consumer needs to BUILD a read or RENDER one is exported; the
 * transport helpers stay internal on purpose, because "how a request
 * is issued" is this obligation's decision, not a consumer's.
 */

export {
	applyBlocked,
	applyFailure,
	applySuccess,
	classifyThrown,
	DEFAULT_EXTERNAL_READ_POLICY,
	EXTERNAL_FAILURE_LABEL,
	ExternalReadError,
	freshnessOf,
	initialBreaker,
	LOADING_SNAPSHOT,
	allowAttempt,
	recordOutcome,
	resolveReadPolicy,
	retryDelayMs,
	withRecomputedFreshness,
} from './contract';
export type {
	ExternalBreaker,
	ExternalBreakerState,
	ExternalFailureReason,
	ExternalFreshness,
	ExternalReadPolicy,
	ExternalSnapshot,
	ExternalSource,
} from './contract';
export { createExternalReader } from './reader';
export type { ExternalAdapter, ExternalReader, ExternalReaderOptions } from './reader';
export { ExternalReadCard } from './ExternalReadCard';
export type { ExternalReadCardProps } from './ExternalReadCard';
export { createGitHubRepoAdapter, GITHUB_REPO_SOURCE, parseGitHubRepoFacts } from './github';
export type { GitHubRepoAdapterOptions, GitHubRepoFacts } from './github';
