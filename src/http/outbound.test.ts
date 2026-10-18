import { describe, expect, it } from 'vitest';
import {
	MAX_OUTBOUND_URL_LENGTH,
	OUTBOUND_DENIED_HOSTNAMES,
	classifyOutboundRedirect,
	classifyOutboundUrl,
} from './outbound';

/**
 * Classification matrix for the outbound URL policy (Issue #453).
 *
 * These assert the *policy* in isolation, with no I/O: one URL in, one
 * verdict out. The adapter behaviour that sits on top of it — hop
 * re-classification, deadline, size cap — is in
 * `outbound-fetch.test.ts`.
 *
 * Every row here is a hand-written string. Nothing in this file, or in
 * the report generator that renders it, opens a socket.
 */

/** Compact helper: the reason code, or `null` when the URL is accepted. */
function codeOf(raw: string, policy?: Parameters<typeof classifyOutboundUrl>[1]): string | null {
	const verdict = classifyOutboundUrl(raw, policy);
	return verdict.ok ? null : verdict.code;
}

describe('classifyOutboundUrl — accepted', () => {
	const accepted = [
		['an ordinary public https origin', 'https://api.github.com/repos/rebuildup/my-web-2026'],
		['a public http origin', 'http://api.notion.so/v1/pages/abc'],
		['a query string', 'https://example.org/search?q=hello%20world'],
		['a fragment', 'https://example.org/page#section'],
		['an explicit default https port', 'https://api.github.com:443/repos'],
		['an explicit default http port', 'http://api.github.com:80/repos'],
		['a host whose name merely contains a denied substring', 'https://notlocal.example.org/'],
		[
			'a host that ends with an allowed-looking but different label',
			'https://internal.example.org/',
		],
		['a punycode (xn--) host', 'https://xn--eckwd4c7c.xn--zckzah/'],
	] as const;

	for (const [label, url] of accepted) {
		it(`accepts ${label}`, () => {
			const verdict = classifyOutboundUrl(url);
			expect(verdict.ok).toBe(true);
			if (verdict.ok) expect(verdict.url.protocol).toMatch(/^https?:$/);
		});
	}
});

describe('classifyOutboundUrl — protocol', () => {
	const refused = [
		'file:///etc/passwd',
		'gopher://example.org/',
		'data:text/html,<h1>hi',
		'javascript:alert(1)',
		'vbscript:msgbox(1)',
		'ftp://example.org/pub',
		'about:blank',
		'blob:https://example.org/uuid',
		'chrome://settings',
	] as const;

	for (const url of refused) {
		it(`refuses ${url.split(':')[0]}:`, () => {
			expect(codeOf(url)).toBe('protocol_not_allowed');
		});
	}
});

describe('classifyOutboundUrl — reserved and internal names', () => {
	for (const suffix of OUTBOUND_DENIED_HOSTNAMES) {
		it(`refuses the .${suffix} zone`, () => {
			expect(codeOf(`https://host.${suffix}/`)).toBe('host_not_allowed');
			if (!suffix.includes('.')) {
				expect(codeOf(`https://${suffix}/`)).toBe('host_not_allowed');
			}
		});
	}

	it('refuses a single-label host', () => {
		expect(codeOf('http://intranet/admin')).toBe('host_not_allowed');
		expect(codeOf('http://router/')).toBe('host_not_allowed');
	});

	it('refuses an empty label', () => {
		expect(codeOf('https://api..github.com/')).toBe('host_not_allowed');
	});

	it('matches a denied suffix on a label boundary only', () => {
		// `evil-internal.example.org` merely *contains* the word; a
		// substring match here would refuse a legitimate host.
		expect(codeOf('https://evil-internal.example.org/')).toBeNull();
		expect(codeOf('https://metadata.google.internal/')).toBe('host_not_allowed');
	});
});

describe('classifyOutboundUrl — address literals', () => {
	const reserved: readonly (readonly [string, string])[] = [
		['127.0.0.1', 'ipv4 loopback'],
		['127.255.255.254', 'ipv4 loopback upper edge'],
		['0.0.0.0', 'this-network'],
		['10.0.0.1', 'rfc1918 10/8'],
		['172.16.0.1', 'rfc1918 172.16/12 lower edge'],
		['172.31.255.255', 'rfc1918 172.16/12 upper edge'],
		['192.168.1.1', 'rfc1918 192.168/16'],
		['100.64.0.1', 'carrier-grade nat'],
		['169.254.169.254', 'cloud instance metadata'],
		['198.18.0.1', 'benchmarking'],
		['203.0.113.7', 'TEST-NET-3'],
		['224.0.0.1', 'multicast'],
		['255.255.255.255', 'broadcast'],
		['[::1]', 'ipv6 loopback'],
		['[::]', 'ipv6 unspecified'],
		['[fd00::1]', 'ipv6 unique local'],
		['[fe80::1]', 'ipv6 link-local'],
		['[ff02::1]', 'ipv6 multicast'],
		['[::ffff:127.0.0.1]', 'ipv4-mapped loopback'],
		['[64:ff9b::7f00:1]', 'nat64 of loopback'],
		['[2002:7f00:1::]', '6to4 of loopback'],
	];

	for (const [host, label] of reserved) {
		it(`refuses ${label} (${host})`, () => {
			expect(codeOf(`http://${host}/`)).toBe('private_address');
		});
	}

	it('refuses a public literal while the policy requires a hostname', () => {
		expect(codeOf('https://8.8.8.8/resolve')).toBe('ip_literal_not_allowed');
		expect(codeOf('https://[2606:4700:4700::1111]/')).toBe('ip_literal_not_allowed');
	});

	it('accepts a public literal only when the caller opts in', () => {
		expect(codeOf('https://8.8.8.8/resolve', { allowIpLiterals: true })).toBeNull();
		// The opt-in does not extend to the reserved space.
		expect(codeOf('http://127.0.0.1/', { allowIpLiterals: true })).toBe('private_address');
	});

	it('does not let the caller allow-list re-open the address space', () => {
		// `allowedHosts` is a *name* list. If it were matched before the
		// address branch, one string in one policy object would undo the
		// rule this whole module exists to enforce.
		for (const host of [
			'127.0.0.1',
			'10.0.0.5',
			'169.254.169.254',
			'[::1]',
			'[::ffff:127.0.0.1]',
		]) {
			expect(codeOf(`http://${host}/`, { allowedHosts: [host] }), host).toBe('private_address');
		}
		// It still does what it is for: allowing a name the reserved-zone
		// rules would otherwise refuse.
		expect(
			codeOf('https://build.internal/status', { allowedHosts: ['build.internal'] }),
		).toBeNull();
		// And the address opt-in still works for a public literal.
		expect(
			codeOf('https://8.8.8.8/resolve', { allowedHosts: ['8.8.8.8'], allowIpLiterals: true }),
		).toBeNull();
	});

	it('refuses an ambiguous octal-style literal', () => {
		// `0177.0.0.1` is decimal 177 to one resolver and octal to
		// another; the URL parser normalises it to 127.0.0.1, which the
		// loopback rule then refuses.
		expect(codeOf('http://0177.0.0.1/')).toBe('private_address');
		// An out-of-range octet never produces a URL at all.
		expect(codeOf('http://256.0.0.1/')).toBe('invalid_url');
	});
});

describe('classifyOutboundUrl — authority and ports', () => {
	it('refuses userinfo, which is the classic origin-confusion trick', () => {
		expect(codeOf('https://api.github.com@evil.example.org/')).toBe('credentials_in_url');
		expect(codeOf('https://api.github.com:token@evil.example.org/')).toBe('credentials_in_url');
		expect(codeOf('https://api.github.com@169.254.169.254/')).toBe('credentials_in_url');
	});

	it('refuses a non-default port', () => {
		expect(codeOf('https://api.github.com:8443/')).toBe('port_not_allowed');
		expect(codeOf('http://api.github.com:8080/')).toBe('port_not_allowed');
		expect(codeOf('https://api.github.com:22/')).toBe('port_not_allowed');
	});

	it('accepts an explicitly allowed extra port', () => {
		expect(codeOf('https://api.github.com:8443/', { allowedPorts: [8443] })).toBeNull();
	});
});

describe('classifyOutboundUrl — shape', () => {
	const invalid = [
		'',
		'   ',
		'not a url',
		'/relative/path',
		'//protocol-relative.example.org/',
		'api.github.com',
		'https://',
		42,
		null,
		undefined,
		{ url: 'https://api.github.com/' },
	] as const;

	for (const value of invalid) {
		it(`refuses ${JSON.stringify(value) ?? String(value)}`, () => {
			expect(codeOf(value as unknown as string)).toBe('invalid_url');
		});
	}

	it('refuses a URL over the length limit', () => {
		const prefix = 'https://api.github.com/';
		expect(codeOf(`${prefix}${'a'.repeat(MAX_OUTBOUND_URL_LENGTH)}`)).toBe('url_too_long');
		expect(codeOf(`${prefix}${'a'.repeat(MAX_OUTBOUND_URL_LENGTH - prefix.length)}`)).toBeNull();
	});

	it('refuses a URL carrying a control character the parser would strip', () => {
		// The WHATWG parser drops tab / CR / LF, so the string a reader
		// sees and the URL the runtime fetches can differ.
		expect(codeOf('https://api.github.com\n@evil.example.org/')).toBe('invalid_url');
		expect(codeOf('https://api.github.com\r\n\t/x')).toBe('invalid_url');
		expect(codeOf('https://api.github.com/\u0000')).toBe('invalid_url');
		expect(codeOf('https://api.github.com/\u3000')).toBe('invalid_url');
		expect(codeOf('https://api.github.com/\ufeff')).toBe('invalid_url');
	});

	it('refuses a non-ASCII host rather than guessing at an IDN mapping', () => {
		// `new URL()` already punycodes this to `xn--wgv71a119e.example`,
		// which the reserved-zone rule refuses on its own; the ASCII
		// guard is what covers a host no TLD rule mentions.
		expect(codeOf('https://日本語.example/')).toBe('host_not_allowed');
	});
});

describe('classifyOutboundRedirect', () => {
	const base = new URL('https://api.github.com/repos/a/b');

	it('resolves a relative Location against the current URL', () => {
		const verdict = classifyOutboundRedirect('/repos/a/b/releases', base);
		expect(verdict.ok).toBe(true);
		if (verdict.ok)
			expect(verdict.url.toString()).toBe('https://api.github.com/repos/a/b/releases');
	});

	it('accepts an absolute Location that is itself allowed', () => {
		const verdict = classifyOutboundRedirect('https://codeload.github.com/a/b/tar.gz', base);
		expect(verdict.ok).toBe(true);
	});

	it('refuses a Location that points back inside the network', () => {
		for (const location of [
			'http://169.254.169.254/latest/meta-data/',
			'http://127.0.0.1:8787/',
			'file:///etc/passwd',
			'http://metadata.google.internal/',
		]) {
			const verdict = classifyOutboundRedirect(location, base);
			expect(verdict.ok).toBe(false);
			if (!verdict.ok) expect(verdict.code).not.toBe('invalid_url');
		}
	});

	it('refuses a scheme-relative Location that leaves the allow-list', () => {
		const verdict = classifyOutboundRedirect('//169.254.169.254/latest/meta-data/', base);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.code).toBe('private_address');
	});
});
