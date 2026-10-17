import { describe, expect, it } from 'vitest';
import {
	SANDBOX_TOKENS,
	attachToolMessageGuard,
	classifyToolFrameSrc,
	createToolMessageGuard,
	evaluateToolEmbedPolicy,
	parseTokenList,
	postToToolWindow,
	resolveExpectedToolOrigin,
	resolveToolFrameSrc,
	toEmbedSubject,
} from './embed-policy';
import type {
	ToolDeliveryLike,
	ToolHostMessageDeclaration,
	ToolMessageEventLike,
} from './embed-policy';
import { listAllTools } from './registry';

/**
 * Tool embed policy — contract tests (Issue #465).
 *
 * Three groups of assertions:
 *
 *   1. The LIVE manifest passes the policy. `pnpm run tools:check`
 *      already gates this at build time, but the route depends on it
 *      at request time, so the runtime unit test proves the same
 *      property without shelling out to git.
 *   2. Fixtures prove each rule REJECTS. Every fixture is a local
 *      object literal — no Tool repo, no network, no production
 *      resource is involved, per the issue's "local fixture/test
 *      resource" constraint.
 *   3. The runtime message guard refuses everything that is not
 *      origin-exact + source-exact + type-allowlisted, and no
 *      listener is attached at all without a declaration.
 *
 * Fixtures are deliberately hostile: they are what a future manifest
 * edit (or a compromised Tool build artefact) would look like.
 */

/** A minimal valid `same_origin_static` delivery block. */
function okDelivery(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'same_origin_static',
		artifact_path: '/tools/fixture/app',
		entry_html: '/tools/fixture/app/index.html',
		iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
		...overrides,
	};
}

function codes(delivery: ToolDeliveryLike | Record<string, unknown>): string[] {
	return evaluateToolEmbedPolicy(toEmbedSubject('fixture', delivery as ToolDeliveryLike)).map(
		(v) => v.code,
	);
}

describe('Tool embed policy — the live manifest', () => {
	it('every manifest entry satisfies the embed policy', () => {
		const violations = listAllTools().flatMap((tool) =>
			evaluateToolEmbedPolicy(toEmbedSubject(tool.slug, tool.delivery)).map(
				(v) => `${v.slug}: ${v.code}`,
			),
		);
		expect(violations).toEqual([]);
	});

	it('both served Tools declare allow-scripts + no-referrer', () => {
		const served = listAllTools().filter(
			(
				t,
			): t is typeof t & {
				delivery: {
					kind: 'same_origin_static';
					iframe?: { sandbox: string; referrer_policy: string };
				};
			} => t.delivery.kind === 'same_origin_static',
		);
		expect(served.length).toBeGreaterThan(0);
		for (const tool of served) {
			expect(tool.delivery.iframe?.sandbox).toBe('allow-scripts');
			expect(tool.delivery.iframe?.referrer_policy).toBe('no-referrer');
		}
	});

	it('no manifest Tool declares a host_message contract (no listener is attached)', () => {
		// The strongest form of "an unexpected message cannot reach the
		// host": there is no handler to reach. If a future Tool adds
		// one, this test is the tripwire that forces the contract to be
		// reviewed.
		for (const tool of listAllTools()) {
			const message = 'host_message' in tool.delivery ? tool.delivery.host_message : undefined;
			expect(message, `${tool.slug} suddenly declares host_message`).toBeUndefined();
		}
	});

	it('host_disabled entries are not policed (no frame is rendered)', () => {
		expect(codes({ kind: 'host_disabled', disabled_reason: 'fixture' })).toEqual([]);
	});
});

describe('Tool embed policy — sandbox tokens', () => {
	it('accepts allow-scripts with an accepted referrer policy', () => {
		expect(codes(okDelivery())).toEqual([]);
	});

	it('rejects a missing delivery.iframe block (no implicit default)', () => {
		const delivery = okDelivery();
		(delivery as { iframe?: unknown }).iframe = undefined;
		expect(codes(delivery)).toEqual(['embed.iframe.missing']);
	});

	it('rejects an empty sandbox value', () => {
		expect(codes(okDelivery({ iframe: { sandbox: '', referrer_policy: 'no-referrer' } }))).toEqual([
			'embed.sandbox.missing',
		]);
	});

	it('rejects allow-scripts + allow-same-origin (same-origin sandbox escape)', () => {
		// The artefact is served from the HOST origin, so
		// allow-same-origin gives the Tool the host origin: cookies,
		// localStorage, and same-origin fetch to /api/v1/*.
		expect(
			codes(
				okDelivery({
					iframe: { sandbox: 'allow-scripts allow-same-origin', referrer_policy: 'no-referrer' },
				}),
			),
		).toEqual(['embed.sandbox.same-origin-escape', 'embed.sandbox.forbidden-token']);
	});

	it('rejects the pair regardless of token order', () => {
		expect(
			codes(
				okDelivery({
					iframe: { sandbox: 'allow-same-origin allow-scripts', referrer_policy: 'no-referrer' },
				}),
			),
		).toContain('embed.sandbox.same-origin-escape');
	});

	it('rejects allow-same-origin on its own', () => {
		expect(
			codes(
				okDelivery({ iframe: { sandbox: 'allow-same-origin', referrer_policy: 'no-referrer' } }),
			),
		).toEqual(['embed.sandbox.forbidden-token']);
	});

	it('rejects every navigation / escape / storage token', () => {
		for (const token of [
			'allow-top-navigation',
			'allow-top-navigation-by-user-activation',
			'allow-top-navigation-to-custom-protocols',
			'allow-popups-to-escape-sandbox',
			'allow-storage-access-by-user-activation',
		]) {
			expect(
				codes(
					okDelivery({
						iframe: { sandbox: `allow-scripts ${token}`, referrer_policy: 'no-referrer' },
					}),
				),
				token,
			).toContain('embed.sandbox.forbidden-token');
		}
	});

	it('rejects an unknown token instead of silently degrading the sandbox', () => {
		// A typo like "allow-script" would otherwise render a frame with
		// NO script permission at all — a functional bug that reads like
		// a working sandbox in review.
		expect(
			codes(okDelivery({ iframe: { sandbox: 'allow-script', referrer_policy: 'no-referrer' } })),
		).toEqual(['embed.sandbox.unknown-token']);
	});

	it('rejects a repeated token', () => {
		expect(
			codes(
				okDelivery({
					iframe: { sandbox: 'allow-scripts allow-scripts', referrer_policy: 'no-referrer' },
				}),
			),
		).toEqual(['embed.sandbox.duplicate-token']);
	});

	it('accepts a conditional token only with BOTH a grant and a written reason', () => {
		const withBoth = okDelivery({
			iframe: {
				sandbox: 'allow-scripts allow-downloads',
				referrer_policy: 'no-referrer',
				allow: 'downloads',
				sandbox_rationale: 'The Tool exports a user-authored Markdown file.',
			},
		});
		expect(codes(withBoth)).toEqual([]);

		const grantOnly = okDelivery({
			iframe: {
				sandbox: 'allow-scripts allow-downloads',
				referrer_policy: 'no-referrer',
				allow: 'downloads',
			},
		});
		expect(codes(grantOnly)).toEqual(['embed.sandbox.conditional-without-rationale']);

		const reasonOnly = okDelivery({
			iframe: {
				sandbox: 'allow-scripts allow-downloads',
				referrer_policy: 'no-referrer',
				sandbox_rationale: 'The Tool exports a user-authored Markdown file.',
			},
		});
		expect(codes(reasonOnly)).toEqual(['embed.sandbox.conditional-without-grant']);
	});

	it('enumerates the full HTML sandbox token set (no silent no-ops)', () => {
		// If a browser adds a token, the allowlist must be revisited
		// explicitly rather than accepted by default.
		expect([...SANDBOX_TOKENS].sort()).toEqual(
			[
				'allow-downloads',
				'allow-forms',
				'allow-modals',
				'allow-orientation-lock',
				'allow-pointer-lock',
				'allow-popups',
				'allow-popups-to-escape-sandbox',
				'allow-presentation',
				'allow-same-origin',
				'allow-scripts',
				'allow-storage-access-by-user-activation',
				'allow-top-navigation',
				'allow-top-navigation-by-user-activation',
				'allow-top-navigation-to-custom-protocols',
			].sort(),
		);
	});
});

describe('Tool embed policy — referrer policy', () => {
	it('rejects a missing referrer policy', () => {
		expect(codes(okDelivery({ iframe: { sandbox: 'allow-scripts' } }))).toEqual([
			'embed.referrer-policy.missing',
		]);
	});

	it('accepts only no-referrer / same-origin / strict-origin', () => {
		for (const policy of ['no-referrer', 'same-origin', 'strict-origin']) {
			expect(
				codes(okDelivery({ iframe: { sandbox: 'allow-scripts', referrer_policy: policy } })),
				policy,
			).toEqual([]);
		}
	});

	it('rejects every policy that can leak the host URL cross-origin', () => {
		for (const policy of [
			'unsafe-url',
			'origin',
			'origin-when-cross-origin',
			'strict-origin-when-cross-origin',
			'no-referrer-when-downgrade',
		]) {
			expect(
				codes(okDelivery({ iframe: { sandbox: 'allow-scripts', referrer_policy: policy } })),
				policy,
			).toEqual(['embed.referrer-policy.not-allowed']);
		}
	});
});

describe('Tool embed policy — frame origin', () => {
	it('classifies root-relative paths as same-origin', () => {
		expect(classifyToolFrameSrc('/tools/prototype/app/index.html')).toBe('same-origin');
	});

	it('classifies protocol-relative URLs as cross-origin (looks like a path, is not)', () => {
		expect(classifyToolFrameSrc('//evil.example/app/index.html')).toBe('cross-origin');
	});

	it('classifies absolute http(s) URLs as cross-origin', () => {
		expect(classifyToolFrameSrc('https://tool.example/app/')).toBe('cross-origin');
	});

	it('classifies non-http schemes and garbage as unresolved', () => {
		for (const src of [
			'',
			'   ',
			'javascript:alert(1)',
			'data:text/html,x',
			'blob:https://x/y',
			'nonsense',
		]) {
			expect(classifyToolFrameSrc(src), src).toBe('unresolved');
		}
	});

	it('rejects a cross-origin src for a same_origin_static entry', () => {
		expect(codes(okDelivery({ entry_html: 'https://evil.example/app/index.html' }))).toContain(
			'embed.frame-src.cross-origin',
		);
		expect(codes(okDelivery({ entry_html: '//evil.example/app/index.html' }))).toContain(
			'embed.frame-src.cross-origin',
		);
	});

	it('rejects an embeddable entry with no frame src at all', () => {
		// Both halves are reported: no src to frame, and no sandbox to
		// frame it with. Reporting them together is what lets one
		// manifest edit be fixed in one pass.
		expect(codes({ kind: 'same_origin_static' })).toEqual([
			'embed.frame-src.missing',
			'embed.iframe.missing',
		]);
	});

	it('resolves the frame src from entry_html, artifact_path, or external_url', () => {
		expect(
			resolveToolFrameSrc({
				kind: 'same_origin_static',
				artifact_path: '/tools/x/app',
				entry_html: '/tools/x/app/index.html',
			}),
		).toBe('/tools/x/app/index.html');
		expect(resolveToolFrameSrc({ kind: 'same_origin_static', artifact_path: '/tools/x/app' })).toBe(
			'/tools/x/app/index.html',
		);
		expect(
			resolveToolFrameSrc({ kind: 'external_exception', external_url: 'https://tool.example/' }),
		).toBe('https://tool.example/');
		expect(resolveToolFrameSrc({ kind: 'host_disabled' })).toBe('');
	});

	it('rejects a plaintext http external_url for an external_exception frame', () => {
		expect(
			codes({
				kind: 'external_exception',
				external_url: 'http://tool.example/',
				iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
			}),
		).toEqual(['embed.frame-src.not-https']);
	});

	it('accepts an https external_exception frame with a declared policy', () => {
		expect(
			codes({
				kind: 'external_exception',
				external_url: 'https://tool.example/',
				iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
			}),
		).toEqual([]);
	});
});

describe('Tool embed policy — host message contract', () => {
	const contract: ToolHostMessageDeclaration = {
		expected_origin: 'self',
		allowed_types: ['tool:ready', 'tool:resize'],
	};

	it('rejects a wildcard expected_origin', () => {
		expect(
			codes(okDelivery({ host_message: { expected_origin: '*', allowed_types: ['a'] } })),
		).toEqual(['host-message.origin.wildcard']);
	});

	it('rejects a missing / malformed expected_origin', () => {
		expect(codes(okDelivery({ host_message: { allowed_types: ['a'] } }))).toEqual([
			'host-message.origin.invalid',
		]);
		expect(
			codes(
				okDelivery({
					host_message: { expected_origin: 'http://tool.example', allowed_types: ['a'] },
				}),
			),
		).toEqual(['host-message.origin.invalid']);
	});

	it('rejects "self" on a cross-origin frame', () => {
		expect(
			codes({
				kind: 'external_exception',
				external_url: 'https://tool.example/',
				iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
				host_message: contract,
			}),
		).toEqual(['host-message.origin.mismatch']);
	});

	it('rejects an expected_origin that does not match the frame origin', () => {
		expect(
			codes({
				kind: 'external_exception',
				external_url: 'https://tool.example/',
				iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
				host_message: { expected_origin: 'https://other.example', allowed_types: ['a'] },
			}),
		).toEqual(['host-message.origin.mismatch']);
	});

	it('accepts a contract whose expected_origin matches the frame origin', () => {
		expect(
			codes({
				kind: 'external_exception',
				external_url: 'https://tool.example/',
				iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
				host_message: { expected_origin: 'https://tool.example', allowed_types: ['a'] },
			}),
		).toEqual([]);
	});

	it('rejects an empty / malformed allowed_types list', () => {
		expect(
			codes(okDelivery({ host_message: { expected_origin: 'self', allowed_types: [] } })),
		).toEqual(['host-message.types.missing']);
		expect(
			codes(
				okDelivery({ host_message: { expected_origin: 'self', allowed_types: ['Ready Now!'] } }),
			),
		).toEqual(['host-message.types.invalid']);
	});

	it('rejects any source other than the Tool frame window', () => {
		expect(codes(okDelivery({ host_message: { ...contract, source: 'opener' } }))).toEqual([
			'host-message.source.invalid',
		]);
	});
});

describe('Tool embed policy — runtime message guard', () => {
	const HOST_ORIGIN = 'https://host.example';
	const toolWindow = { name: 'tool-frame' };
	const contract: ToolHostMessageDeclaration = {
		expected_origin: 'self',
		allowed_types: ['tool:ready', 'tool:resize'],
	};

	function guardWith(
		dispatch: (m: { type: string; payload: unknown }) => void,
		toolWin: unknown = toolWindow,
	) {
		return createToolMessageGuard({
			slug: 'fixture',
			declaration: contract,
			hostOrigin: HOST_ORIGIN,
			toolWindow: toolWin,
			dispatch,
		});
	}

	function event(overrides: Partial<ToolMessageEventLike>): ToolMessageEventLike {
		return {
			origin: HOST_ORIGIN,
			source: toolWindow,
			data: { type: 'tool:ready', payload: { version: 1 } },
			...overrides,
		};
	}

	it('dispatches an allowlisted message from the exact origin + frame', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		const verdict = guard?.(event({}));
		expect(verdict?.accepted).toBe(true);
		expect(seen).toEqual([{ type: 'tool:ready', payload: { version: 1 } }]);
	});

	it('refuses a foreign origin without dispatching', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		const verdict = guard?.(event({ origin: 'https://evil.example' }));
		expect(verdict).toEqual({ accepted: false, reason: 'origin-mismatch' });
		expect(seen).toEqual([]);
	});

	it('refuses a prefix / superstring origin (exact match, not "starts with")', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		expect(guard?.(event({ origin: 'https://host.example.evil.example' }))).toEqual({
			accepted: false,
			reason: 'origin-mismatch',
		});
		expect(guard?.(event({ origin: 'null' }))).toEqual({
			accepted: false,
			reason: 'origin-mismatch',
		});
		expect(seen).toEqual([]);
	});

	it('refuses a same-origin event from a window that is not the Tool frame', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		expect(guard?.(event({ source: { name: 'some-other-window' } }))).toEqual({
			accepted: false,
			reason: 'source-mismatch',
		});
		expect(guard?.(event({ source: null }))).toEqual({
			accepted: false,
			reason: 'source-mismatch',
		});
		expect(seen).toEqual([]);
	});

	it('refuses every message while the frame is not mounted (toolWindow === null)', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m), null);
		expect(guard?.(event({}))).toEqual({ accepted: false, reason: 'source-mismatch' });
		expect(seen).toEqual([]);
	});

	it('refuses a type outside allowed_types', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		expect(guard?.(event({ data: { type: 'tool:exfiltrate' } }))).toEqual({
			accepted: false,
			reason: 'type-not-allowed',
		});
		expect(seen).toEqual([]);
	});

	it('refuses a non-object payload before parsing it', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		for (const data of ['tool:ready', null, 42, ['tool:ready'], undefined]) {
			expect(guard?.(event({ data })), String(data)).toEqual({
				accepted: false,
				reason: 'malformed-payload',
			});
		}
		expect(guard?.(event({ data: {} }))).toEqual({
			accepted: false,
			reason: 'type-not-allowed',
		});
		expect(seen).toEqual([]);
	});

	it('checks origin BEFORE source, so a hostile frame cannot probe the source branch', () => {
		const seen: unknown[] = [];
		const guard = guardWith((m) => seen.push(m));
		expect(guard?.(event({ origin: 'https://evil.example', source: null }))).toEqual({
			accepted: false,
			reason: 'origin-mismatch',
		});
		expect(seen).toEqual([]);
	});

	it('builds no guard at all without a declaration', () => {
		expect(
			createToolMessageGuard({
				slug: 'fixture',
				declaration: undefined as unknown as ToolHostMessageDeclaration,
				hostOrigin: HOST_ORIGIN,
				toolWindow,
				dispatch: () => {},
			}),
		).toBeNull();
	});

	it('builds no guard when the expected origin cannot be resolved', () => {
		for (const declaration of [
			{ expected_origin: '*', allowed_types: ['a'] },
			{ expected_origin: 'http://tool.example', allowed_types: ['a'] },
			{ allowed_types: ['a'] },
		]) {
			expect(
				createToolMessageGuard({
					slug: 'fixture',
					declaration,
					hostOrigin: HOST_ORIGIN,
					toolWindow,
					dispatch: () => {},
				}),
				JSON.stringify(declaration),
			).toBeNull();
		}
	});

	it('resolves expected origins: self → host origin, literal → itself', () => {
		expect(resolveExpectedToolOrigin({ expected_origin: 'self' }, HOST_ORIGIN)).toBe(HOST_ORIGIN);
		expect(
			resolveExpectedToolOrigin({ expected_origin: 'https://tool.example' }, HOST_ORIGIN),
		).toBe('https://tool.example');
		expect(
			resolveExpectedToolOrigin({ expected_origin: 'self' }, HOST_ORIGIN, 'https://tool.example'),
		).toBeNull();
		expect(
			resolveExpectedToolOrigin(
				{ expected_origin: 'https://tool.example' },
				HOST_ORIGIN,
				'https://other.example',
			),
		).toBeNull();
	});
});

describe('Tool embed policy — listener attachment', () => {
	it('attaches nothing and dispatches nothing when no contract is declared', () => {
		const listeners: ((event: never) => void)[] = [];
		const target = {
			addEventListener(_type: 'message', listener: (event: never) => void) {
				listeners.push(listener);
			},
			removeEventListener(_type: 'message', listener: (event: never) => void) {
				const i = listeners.indexOf(listener);
				if (i >= 0) listeners.splice(i, 1);
			},
		};

		const detach = attachToolMessageGuard({
			target,
			slug: 'fixture',
			declaration: undefined as unknown as ToolHostMessageDeclaration,
			hostOrigin: 'https://host.example',
			toolWindow: { name: 'tool-frame' },
			dispatch: () => {
				throw new Error('dispatch must never run without a declared contract');
			},
		});

		expect(detach).toBeNull();
		expect(listeners).toHaveLength(0);
	});

	it('detaches cleanly, and a detached listener no longer dispatches', () => {
		const listeners: ((event: never) => void)[] = [];
		const seen: unknown[] = [];
		const toolWindow = { name: 'tool-frame' };
		const target = {
			addEventListener(_type: 'message', listener: (event: never) => void) {
				listeners.push(listener);
			},
			removeEventListener(_type: 'message', listener: (event: never) => void) {
				const i = listeners.indexOf(listener);
				if (i >= 0) listeners.splice(i, 1);
			},
		};

		const detach = attachToolMessageGuard({
			target,
			slug: 'fixture',
			declaration: { expected_origin: 'self', allowed_types: ['tool:ready'] },
			hostOrigin: 'https://host.example',
			toolWindow,
			dispatch: (m) => seen.push(m),
		});

		expect(typeof detach).toBe('function');
		expect(listeners).toHaveLength(1);

		(listeners[0] as unknown as (event: unknown) => void)({
			origin: 'https://host.example',
			source: toolWindow,
			data: { type: 'tool:ready' },
		});
		expect(seen).toHaveLength(1);

		detach?.();
		expect(listeners).toHaveLength(0);
	});
});

describe('Tool embed policy — host → Tool direction', () => {
	const contract: ToolHostMessageDeclaration = {
		expected_origin: 'https://tool.example',
		allowed_types: ['tool:ready'],
	};

	it('sends only to the declared target origin', () => {
		const sent: unknown[][] = [];
		const result = postToToolWindow(
			{
				postMessage: (message: unknown, targetOrigin: string) => sent.push([message, targetOrigin]),
			},
			contract,
			'https://tool.example',
			{ type: 'tool:ack' },
		);
		expect(result).toEqual({ sent: true });
		expect(sent).toEqual([[{ type: 'tool:ack' }, 'https://tool.example']]);
	});

	it('refuses targetOrigin "*" unconditionally', () => {
		const result = postToToolWindow({ postMessage: () => {} }, contract, '*', { type: 'tool:ack' });
		expect(result).toEqual({ sent: false, reason: 'wildcard-target-origin' });
	});

	it('refuses a target origin that differs from the declaration', () => {
		const result = postToToolWindow({ postMessage: () => {} }, contract, 'https://evil.example', {
			type: 'tool:ack',
		});
		expect(result).toEqual({ sent: false, reason: 'target-origin-mismatch' });
	});

	it('refuses to send with no contract or no frame window', () => {
		expect(
			postToToolWindow({ postMessage: () => {} }, undefined, 'https://tool.example', {}),
		).toEqual({
			sent: false,
			reason: 'no-contract',
		});
		expect(postToToolWindow(null, contract, 'https://tool.example', {})).toEqual({
			sent: false,
			reason: 'no-target-window',
		});
	});
});

describe('Tool embed policy — token list parsing', () => {
	it('normalises whitespace and drops empties', () => {
		expect(parseTokenList('  allow-scripts   allow-popups ')).toEqual([
			'allow-scripts',
			'allow-popups',
		]);
		expect(parseTokenList(undefined)).toEqual([]);
		expect(parseTokenList('')).toEqual([]);
	});
});
