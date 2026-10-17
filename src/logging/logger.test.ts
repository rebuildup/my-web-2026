import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuditLogger } from './logger';
import { REDACTED, REDACTED_EMAIL } from './redact';

/**
 * Audit-logger contract (Issue #467).
 *
 * The redaction unit is proven separately in `redact.test.ts`. What
 * matters HERE is that the logger is the only door to `console`, and
 * that it closes it: every canary handed to a logger method must be
 * absent from the captured console call — in the prefix, in the
 * message, and in every detail argument.
 */

/** Captured console traffic for one test. */
interface CapturedRecord {
	method: string;
	text: string;
}

function captureConsole(): CapturedRecord[] {
	const records: CapturedRecord[] = [];
	for (const method of ['debug', 'log', 'warn', 'error'] as const) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			records.push({ method, text: args.map(renderArg).join(' ') });
		});
	}
	return records;
}

/**
 * How a console call would actually be read back: strings verbatim,
 * structured values as JSON. A devtools console shows objects as JSON,
 * so the assertions must see the redacted fields — not `[object
 * Object]`, which would make every leak assertion vacuous.
 */
function renderArg(arg: unknown): string {
	if (typeof arg === 'string') return arg;
	try {
		return JSON.stringify(arg) ?? String(arg);
	} catch {
		return String(arg);
	}
}

const CANARY_TOKEN = 'mk_canary_secret_0000';
const CANARY_EMAIL = 'canary.person@example.invalid';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createAuditLogger — no canary survives', () => {
	it.each(['debug', 'info', 'warn', 'error'] as const)(
		'%s() redacts the message and every detail argument',
		(level) => {
			const records = captureConsole();
			const logger = createAuditLogger('boundary');
			logger[level](
				`upstream failed: Bearer ${CANARY_TOKEN} for ${CANARY_EMAIL}`,
				{ authorization: `Bearer ${CANARY_TOKEN}`, cookie: 'mw_actor_id=abc' },
				new Error(`nested ${CANARY_TOKEN}`),
				['plain', { api_key: CANARY_TOKEN }],
			);
			expect(records).toHaveLength(1);
			const [record] = records;
			expect(record?.text).not.toContain(CANARY_TOKEN);
			expect(record?.text).not.toContain(CANARY_EMAIL);
			expect(record?.text).toContain(REDACTED);
			expect(record?.text).toContain(REDACTED_EMAIL);
			expect(record?.text.startsWith('[boundary] ')).toBe(true);
		},
	);

	it('routes each level to the matching console method', () => {
		const records = captureConsole();
		const logger = createAuditLogger('home.access');
		logger.debug('d');
		logger.info('i');
		logger.warn('w');
		logger.error('e');
		expect(records.map((record) => record.method)).toEqual(['debug', 'log', 'warn', 'error']);
	});

	it('audit() emits one redacted JSON line with a stable key order', () => {
		const records = captureConsole();
		const logger = createAuditLogger('auth.email');
		logger.audit('email.stub', {
			to: CANARY_EMAIL,
			subject: `invite for ${CANARY_EMAIL}`,
			authorization: `Bearer ${CANARY_TOKEN}`,
			bodyLength: 412,
		});
		expect(records).toHaveLength(1);
		const [record] = records;
		expect(record?.method).toBe('log');
		const line = record?.text ?? '';
		expect(line.startsWith('[auth.email] {')).toBe(true);
		expect(line).not.toContain(CANARY_EMAIL);
		expect(line).not.toContain(CANARY_TOKEN);
		const payload = JSON.parse(line.slice('[auth.email] '.length)) as Record<string, unknown>;
		expect(Object.keys(payload).slice(0, 3)).toEqual(['event', 'at', 'to']);
		expect(payload.event).toBe('email.stub');
		expect(payload.to).toBe(REDACTED_EMAIL);
		expect(payload.subject).toBe(`invite for ${REDACTED_EMAIL}`);
		expect(payload.authorization).toBe(REDACTED);
		expect(payload.bodyLength).toBe(412);
	});

	it('audit() survives a field whose value cannot be walked', () => {
		const records = captureConsole();
		const logger = createAuditLogger('boundary');
		logger.audit('unhandled', { request: new Request('https://rebuildup.dev/?token=x') });
		expect(records).toHaveLength(1);
		expect(records[0]?.text).toContain('[Request]');
	});
});
