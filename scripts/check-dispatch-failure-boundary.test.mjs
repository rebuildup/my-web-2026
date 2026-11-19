import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkDispatchFailureBoundary } from './check-dispatch-failure-boundary.mjs';

/**
 * Fixture tests for the Issue #995 entrypoint gate. The shipped
 * `src/server.ts` must pass; each mutation below removes or reorders
 * one invariant and must fail, so the gate cannot decay into a
 * comment check.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_SOURCE = readFileSync(join(REPO_ROOT, 'src/server.ts'), 'utf8');

test('the shipped src/server.ts satisfies the failure boundary', () => {
	assert.deepEqual(checkDispatchFailureBoundary(REAL_SOURCE), []);
});

test('a dispatch without the catch fails', () => {
	const mutated = REAL_SOURCE.replace(/\btry \{/, 'if (true) {').replace(
		/\} catch \(error\) \{[\s\S]*?\n\t\t\}/,
		'}',
	);
	// Removing the try/catch removes the audit record too.
	assert.ok(checkDispatchFailureBoundary(mutated).length > 0);
});

test('a bare runtime 500 in the catch fails', () => {
	const mutated = REAL_SOURCE.replace(
		'dispatchInternalErrorResponse(generateRequestId())',
		"new Response('Internal Server Error', { status: 500 })",
	);
	const violations = checkDispatchFailureBoundary(mutated);
	assert.ok(violations.some((v) => v.includes('bare `Internal Server Error`')));
});

test('dropping the SSR failure document fails', () => {
	const mutated = REAL_SOURCE.replace('createSsrFailureResponse(request)', 'response');
	const violations = checkDispatchFailureBoundary(mutated);
	assert.ok(violations.some((v) => v.includes('createSsrFailureResponse')));
});

test('observation after the header chain fails the ordering check', () => {
	// Move the observeRequestAnomaly call after applySecurityHeaders by
	// swapping the two statements textually.
	const observeCall = /observeRequestAnomaly\(url\.pathname, response\.status\);\n/;
	const securityCall =
		/(applySecurityHeaders\(request, response, toolRouteSecurityPolicy\(url\.pathname\)\);)/;
	const mutated = REAL_SOURCE.replace(observeCall, '').replace(
		securityCall,
		'$1\n\t\tobserveRequestAnomaly(url.pathname, response.status);',
	);
	const violations = checkDispatchFailureBoundary(mutated);
	assert.ok(violations.some((v) => v.includes('order broken')));
});

test('a source with no dispatch-failure record fails fast', () => {
	const violations = checkDispatchFailureBoundary('export default { fetch() {} }');
	assert.deepEqual(violations, ['missing `dispatch-failure` audit record in the dispatch catch']);
});
