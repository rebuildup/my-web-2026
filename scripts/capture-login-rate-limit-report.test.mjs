import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ARTEFACT_ENCODE_OPTIONS,
	CAPTURE_VIEWPORT,
	MAX_ARTEFACT_BYTES,
	MISSING_MATRIX_MESSAGE,
	OUTPUT,
	extractTable,
	failureMessage,
	findSecretRow,
	parseCells,
	parseRows,
	refusalMessage,
	renderHtml,
} from './capture-login-rate-limit-report.mjs';

/**
 * Unit tests for the *pure* half of the verification capture
 * (Issue #443). The screenshot itself needs a workerd run plus a
 * Chromium launch, so what is pinned here is everything that decides
 * what the committed artefact says: marker extraction, row parsing, the
 * credential guard, the tone mapping, and the size ceiling.
 */

const START = '<!-- login-rate-limit-matrix:start -->';
const END = '<!-- login-rate-limit-matrix:end -->';

const MEASURED_TABLE = [
	'| endpoint | input / condition | status | error | X-Retry-After |',
	'| --- | --- | --- | --- | --- |',
	'| /api/v1/auth/sign-in/email | existing account / correct password | 200 | — | — |',
	'| /api/v1/auth/sign-in/email | existing account / wrong password | 401 | INVALID_EMAIL_OR_PASSWORD | — |',
	'| /api/v1/auth/sign-in/email | unknown account / any password | 401 | INVALID_EMAIL_OR_PASSWORD | — |',
	'| /api/v1/auth/sign-in/email | brute force burst #4 (same client IP) | 429 | — | 10 |',
].join('\n');

test('artefact contract: committed as WebP under a hard size ceiling', () => {
	// PNG bloats the repository; the capture converts before committing.
	assert.equal(OUTPUT, 'docs/verification/security/login-rate-limit.webp');
	assert.equal(OUTPUT.endsWith('.png'), false);
	// The encode width is derived from the capture viewport, so the
	// assertion is a real coupling check rather than a number that cannot
	// affect the output (`withoutEnlargement` never upscales, so an encode
	// width above the viewport would be inert).
	assert.equal(ARTEFACT_ENCODE_OPTIONS.width, CAPTURE_VIEWPORT.width);
	assert.ok(ARTEFACT_ENCODE_OPTIONS.width <= CAPTURE_VIEWPORT.width);
	assert.equal(ARTEFACT_ENCODE_OPTIONS.quality, 80);
	assert.ok(MAX_ARTEFACT_BYTES <= 300 * 1024, 'the ceiling must stay at or below 300 KB');
});

test('a failed suite is reported by exit code only, never by replayed output', () => {
	// Vitest echoes the received value in a failed assertion's diagnostics,
	// so forwarding the child's raw output could put the very credential
	// the guard rejects into stderr / the CI log. The capture reports only
	// the exit code and withholds the output.
	const message = failureMessage(1);
	assert.match(message, /exited with code 1/);
	assert.match(message, /raw output withheld/);
	for (const secret of ['mk_home_secretvalue', 'session_token=abc', 'local-fixture-password']) {
		assert.ok(!message.includes(secret), `no raw output (${secret}) in the failure line`);
		assert.ok(
			!MISSING_MATRIX_MESSAGE.includes(secret),
			`no raw output (${secret}) in the empty-matrix line`,
		);
	}
});

test('rendered legend keeps the throttle prose intact', () => {
	// A garbled legend shipped once (a corrupted token rendered into the
	// committed artefact) and nothing caught it, because CI neither
	// regenerates nor diffs the image. Pin the one line that explains the
	// 429 row, since it is the only prose the matrix's meaning rests on.
	const html = renderHtml(parseRows(MEASURED_TABLE));
	assert.ok(
		html.includes('throttle が存在判定の lever にならないことの担保。'),
		'the legend must read 「throttle が存在判定の lever にならないことの担保。」',
	);
	assert.equal(html.includes('agemんTrump'), false);
});

test('extractTable reads the block between the suite markers', () => {
	const output = `noise\n${START}\n${MEASURED_TABLE}\n${END}\nmore noise\n`;
	assert.equal(extractTable(output), MEASURED_TABLE);
});

test('extractTable returns null when the suite printed no markers', () => {
	assert.equal(extractTable('vitest ran and passed'), null);
});

test('extractTable survives a runner prefix on every line', () => {
	// The runner interleaves its own stdout with the worker's console.log.
	// A cosmetic runner change must not corrupt the measured rows — the
	// parser recognises a row by its tail, so the chatter is discarded.
	const prefix = 'stdout | test/integration/auth-login-hardening.test.ts > suite > matrix';
	const output = [
		START,
		prefix,
		`${prefix} | endpoint | input / condition | status | error | X-Retry-After |`,
		`${prefix} | --- | --- | --- | --- | --- |`,
		`${prefix} | /api/v1/auth/sign-in/email | unknown account / any password | 401 | INVALID_EMAIL_OR_PASSWORD | — |`,
		END,
	].join('\n');
	const rows = parseRows(extractTable(output));
	assert.equal(rows.length, 1);
	assert.equal(rows[0].input, 'unknown account / any password');
	assert.equal(rows[0].status, '401');
});

test('parseCells reads a row by its tail, so prefix and content are both safe', () => {
	// Unprefixed.
	assert.deepEqual(parseCells('| a | b | 429 | — | 10 |'), ['a', 'b', '429', '—', '10']);
	// Prefixed by the runner: the chatter falls in the discarded head.
	assert.deepEqual(parseCells('stdout | test/x.test.ts > suite > test | a | b | 429 | — | 10 |'), [
		'a',
		'b',
		'429',
		'—',
		'10',
	]);
	// A cell containing `>` is content, not a prefix, and survives intact.
	assert.deepEqual(parseCells('| a | burst 3 > 2 | 401 | E | — |'), [
		'a',
		'burst 3 > 2',
		'401',
		'E',
		'—',
	]);
	// Not a row at all.
	assert.equal(parseCells('RUN v4.1.11 /repo'), null);
	assert.equal(parseCells('| too | few | columns |'), null);
});

test('parseRows drops the header and the separator, and keeps every measurement', () => {
	const rows = parseRows(MEASURED_TABLE);
	assert.equal(rows.length, 4);
	assert.deepEqual(rows[0], {
		index: '1',
		endpoint: '/api/v1/auth/sign-in/email',
		input: 'existing account / correct password',
		status: '200',
		code: '—',
		retryAfter: '—',
	});
	assert.equal(rows[3].status, '429');
	assert.equal(rows[3].retryAfter, '10');
});

test('parseRows survives a missing Markdown separator', () => {
	// The first measurement must never be silently swallowed because the
	// separator row is absent.
	const rows = parseRows(
		[
			'| endpoint | input / condition | status | error | X-Retry-After |',
			'| /api/v1/auth/sign-in/email | unknown account / any password | 401 | INVALID_EMAIL_OR_PASSWORD | — |',
		].join('\n'),
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].input, 'unknown account / any password');
});

test('credential guard accepts the measured rows', () => {
	assert.equal(findSecretRow(parseRows(MEASURED_TABLE)), undefined);
});

test('credential guard rejects a row carrying a session cookie or an API key', () => {
	const leaky = parseRows(
		[
			'| endpoint | input / condition | status | error | X-Retry-After |',
			'| --- | --- | --- | --- | --- |',
			'| /api/v1/auth/sign-in/email | leaks a token | 200 | session_token=abc | — |',
		].join('\n'),
	);
	assert.ok(findSecretRow(leaky), 'a row mentioning a token must be refused');

	const apiKey = parseRows(
		[
			'| endpoint | input / condition | status | error | X-Retry-After |',
			'| --- | --- | --- | --- | --- |',
			'| /api/v1/auth/sign-in/email | key mk_home_secretvalue | 200 | — | — |',
		].join('\n'),
	);
	assert.ok(findSecretRow(apiKey), 'a row carrying an API key prefix must be refused');
});

test('the refusal reports the row number and never the row content', () => {
	// Echoing the rejected cell would re-emit the credential the guard
	// exists to keep out of the artefact — into the terminal and into
	// whatever CI log captured it.
	const rows = parseRows(
		[
			'| endpoint | input / condition | status | error | X-Retry-After |',
			'| --- | --- | --- | --- | --- |',
			'| /api/v1/auth/sign-in/email | key mk_home_secretvalue | 200 | — | — |',
		].join('\n'),
	);
	const leak = findSecretRow(rows);
	assert.ok(leak, 'the guard must reject the API-key row');

	const message = refusalMessage(leak);
	assert.match(message, /refusing to render row 1\b/, 'the row number locates the rejection');
	assert.ok(!message.includes('mk_home_secretvalue'), 'no API key in the refusal');
	for (const cell of Object.entries(leak)
		// `index` is what the refusal is *meant* to report; `—` is the
		// empty-cell placeholder, not row content.
		.filter(([field, value]) => field !== 'index' && value !== '—')
		.map(([, value]) => value)) {
		assert.ok(!message.includes(cell), `no row content (${cell}) in the refusal`);
	}
});

test('rendered report escapes markup and separates ok / reject / throttle', () => {
	const html = renderHtml(parseRows(MEASURED_TABLE));
	assert.ok(html.includes('tr class="ok"'), '200 rows are ok');
	assert.ok(html.includes('tr class="reject"'), '401 rows are reject');
	assert.ok(html.includes('tr class="throttle"'), '429 rows are throttle');
	assert.ok(html.includes('INVALID_EMAIL_OR_PASSWORD'));
	assert.ok(html.includes('X-Retry-After'));
	// Renderer must not be able to inject markup from a measured cell.
	const injected = renderHtml([
		{
			index: '1',
			endpoint: '<script>x</script>',
			input: '"onload="alert(1)',
			status: '200',
			code: '—',
			retryAfter: '—',
		},
	]);
	assert.equal(injected.includes('<script>'), false);
	assert.ok(injected.includes('&lt;script&gt;'));
});
