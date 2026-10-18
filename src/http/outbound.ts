/**
 * Outbound URL policy — the SSRF boundary for server-initiated fetches
 * (Issue #453).
 *
 * ## What this owns
 *
 * Every time the Worker fetches a URL that did not come from the
 * project's own code — a Notion page URL, a GitHub repository URL, an
 * X post URL, an uploaded image's origin — the destination is attacker
 * influenceable. This module is the single place that decides whether
 * such a URL may be requested at all.
 *
 * It answers exactly one question, for one URL, with no I/O:
 *
 *   "given the shipped policy, may the Worker open a connection to
 *    this absolute URL?"
 *
 * It answers it **fail-closed**: anything not positively recognised as
 * an ordinary public web URL is refused with a stable reason code.
 *
 * ## The rules
 *
 * | Dimension | Rule | Reason code |
 * | --- | --- | --- |
 * | shape | parses as an absolute URL, at most {@link MAX_OUTBOUND_URL_LENGTH} characters, no control characters or whitespace | `invalid_url`, `url_too_long` |
 * | protocol | `http:` / `https:` only | `protocol_not_allowed` |
 * | authority | no `user:password@` userinfo | `credentials_in_url` |
 * | name | multi-label ASCII hostname, not a reserved or internal suffix | `host_not_allowed` |
 * | address | loopback, private, link-local, CGNAT, multicast, reserved, and the IPv4-mapped / NAT64 / 6to4 embeddings of those | `private_address` |
 * | address | any other IP **literal** | `ip_literal_not_allowed` |
 * | port | 80 / 443 only | `port_not_allowed` |
 *
 * ## Two decisions worth stating out loud
 *
 * 1. **IP literals are refused, public ones included.** A literal
 *    cannot be validated against DNS, and the Workers runtime resolves
 *    the name itself; refusing literals removes "was the resolved
 *    address the one that was checked?" from the failure modes. A
 *    caller that genuinely needs a literal says so with
 *    `allowIpLiterals` in one place, and the runtime-level guard below
 *    still holds underneath it.
 * 2. **The runtime is the second line of defence, not the first.**
 *    Every environment in this repo — `wrangler.jsonc`,
 *    `wrangler.production.jsonc`, `cloudflare.config.ts` and
 *    `vitest.config.ts` — enables the `global_fetch_strictly_public`
 *    compatibility flag, which makes `fetch()` itself refuse a
 *    connection that resolves to a non-public address. This module
 *    decides *before* a connection is attempted, so a refused URL never
 *    reaches DNS at all; the flag covers the DNS-rebinding residue the
 *    module cannot. See "Known limits" in
 *    `docs/security/outbound-fetch.md`.
 *
 * ## Redirects
 *
 * A redirect is a **new URL** and is classified by the same function on
 * the next iteration of the adapter's hop loop
 * (`src/http/outbound-fetch.ts`). `classifyOutboundUrl` itself knows
 * nothing about hops: `redirect: 'manual'` plus a bounded hop budget
 * is the adapter's contract, so "the redirect target was checked" is a
 * property of the loop rather than a claim this module makes.
 *
 * ## No imports
 *
 * Deliberately dependency-free, so the report generator
 * (`scripts/capture-ssrf-url-adapter-report.mjs`) can import it under
 * plain Node and a policy change is reviewable without tracing a call
 * graph.
 */

/** Protocol schemes the Worker may fetch. */
export const OUTBOUND_ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

/** Ports the Worker may fetch. `http:` implies 80, `https:` implies 443. */
export const OUTBOUND_ALLOWED_PORTS = [80, 443] as const;

/**
 * Longest accepted URL. 2048 characters is above the practical browser
 * limit and far above any real API URL, while keeping the string that
 * reaches `fetch()` — and every log line that mentions it — bounded.
 */
export const MAX_OUTBOUND_URL_LENGTH = 2048;

/**
 * Hostnames refused by name, before any address reasoning. Each entry
 * is either an exact hostname (`localhost`) or, when it contains a dot,
 * a suffix matched on label boundaries (`evil.internal`).
 *
 * Sources: RFC 6761 (`.invalid`), RFC 6762 (`.test`, `.example`,
 * `.localhost`), RFC 8375 (`.home.arpa`), plus the internal-suffix
 * conventions split-horizon DNS deployments actually use (`.local`
 * mDNS, `.internal`, `.lan`, `.intranet`, `.corp`, `.private`). None of
 * these can name a host on the public internet, so refusing them costs
 * no real capability and closes the "resolves only inside my network"
 * class without a DNS lookup.
 */
export const OUTBOUND_DENIED_HOSTNAMES: readonly string[] = [
	'localhost',
	'localhost.localdomain',
	'invalid',
	'test',
	'example',
	'local',
	'internal',
	'home.arpa',
	'lan',
	'intranet',
	'corp',
	'private',
];

/** Stable reason codes for a refused URL. Consumers switch on these. */
export type OutboundUrlRefusalCode =
	| 'invalid_url'
	| 'url_too_long'
	| 'protocol_not_allowed'
	| 'credentials_in_url'
	| 'host_not_allowed'
	| 'private_address'
	| 'ip_literal_not_allowed'
	| 'port_not_allowed';

export type OutboundUrlVerdict =
	| { readonly ok: true; readonly url: URL }
	| { readonly ok: false; readonly code: OutboundUrlRefusalCode; readonly reason: string };

/**
 * Caller-supplied adjustments to the shipped policy.
 *
 * Every field is an *addition to a deny-by-default decision*, never a
 * switch that turns the whole check off. An empty / absent policy is
 * the strictest policy, which is what the adapter uses by default.
 */
export interface OutboundUrlPolicy {
	/** Hostnames accepted even if a rule below would refuse them. Compared case-insensitively and without a trailing dot. */
	readonly allowedHosts?: readonly string[];
	/** Ports accepted in addition to {@link OUTBOUND_ALLOWED_PORTS}. */
	readonly allowedPorts?: readonly number[];
	/** Extra host suffixes to refuse. Checked with the same label-boundary rule as the built-in list. */
	readonly deniedHostSuffixes?: readonly string[];
	/**
	 * Accept an IP literal that is not in a refused range.
	 *
	 * Off by default and deliberately awkward: the Workers runtime
	 * enforces `global_fetch_strictly_public` underneath, so turning
	 * this on widens the *classifier*, not what can actually be
	 * reached. It exists so an integration with a documented fixed
	 * address can say so explicitly instead of by accident.
	 */
	readonly allowIpLiterals?: boolean;
}

/* ------------------------------------------------------------------ */
/* Address classification                                              */
/* ------------------------------------------------------------------ */

/**
 * C0 controls, DEL and C1, plus every Unicode space / zero-width /
 * line-separator form. The WHATWG parser silently strips tab, CR and LF
 * from a URL, so a value that reads as `https://evil.example\n@site`
 * is a different URL to the parser than to the reader; refusing the whole
 * string is the only way the two can be made to agree.
 *
 * Written as a code-point scan rather than a regex: the character class
 * would have to embed the C0 range literally, and a literal control
 * character in a source pattern is both unreadable and something the
 * formatter and the linter each have an opinion about.
 */
function hasControlOrSpace(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 0x20) return true;
		if (code >= 0x7f && code <= 0xa0) return true;
		if (code === 0x1680 || code === 0x2028 || code === 0x2029) return true;
		if (code >= 0x2000 && code <= 0x200f) return true;
		if (code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff) {
			return true;
		}
	}
	return false;
}

interface Ipv4Parts {
	readonly value: number;
}

/**
 * IPv4 ranges that must never be reachable from a public Worker.
 *
 * The link-local entry (`169.254.0.0/16`) is the one that matters most
 * in practice: `169.254.169.254` is the cloud instance-metadata
 * endpoint on every major provider, and an SSRF that can read it is a
 * credential-exfiltration primitive.
 *
 * The `TEST-NET` ranges are reserved by RFC 5737 and the
 * benchmarking / 6to4-relay ranges by RFC 2544 / RFC 7526. They are
 * listed so the deny-list reads as "the reserved address space" rather
 * than as an arbitrary set of numbers.
 */
const IPV4_BLOCKED_RANGES: readonly { base: string; bits: number; label: string }[] = [
	{ base: '0.0.0.0', bits: 8, label: 'this-network (RFC 1122)' },
	{ base: '10.0.0.0', bits: 8, label: 'private-use (RFC 1918)' },
	{ base: '100.64.0.0', bits: 10, label: 'carrier-grade NAT (RFC 6598)' },
	{ base: '127.0.0.0', bits: 8, label: 'loopback' },
	{
		base: '169.254.0.0',
		bits: 16,
		label: 'link-local, including the 169.254.169.254 instance-metadata endpoint',
	},
	{ base: '172.16.0.0', bits: 12, label: 'private-use (RFC 1918)' },
	{ base: '192.0.0.0', bits: 24, label: 'IETF protocol assignments (RFC 6890)' },
	{ base: '192.0.2.0', bits: 24, label: 'TEST-NET-1 (RFC 5737)' },
	{ base: '192.88.99.0', bits: 24, label: '6to4 relay anycast (RFC 7526)' },
	{ base: '192.168.0.0', bits: 16, label: 'private-use (RFC 1918)' },
	{ base: '198.18.0.0', bits: 15, label: 'benchmarking (RFC 2544)' },
	{ base: '198.51.100.0', bits: 24, label: 'TEST-NET-2 (RFC 5737)' },
	{ base: '203.0.113.0', bits: 24, label: 'TEST-NET-3 (RFC 5737)' },
	{ base: '224.0.0.0', bits: 4, label: 'multicast' },
	{
		base: '240.0.0.0',
		bits: 4,
		label: 'reserved, including the 255.255.255.255 broadcast address',
	},
];

function parseIpv4(host: string): Ipv4Parts | null {
	const parts = host.split('.');
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		// No leading zeros and no shorthand: `0177.0.0.1` is decimal
		// 177 to one resolver and octal to another, so it is not an
		// address, it is an ambiguity.
		if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		value = value * 256 + octet;
	}
	return { value: value >>> 0 };
}

/** `public`, or the label of the reserved range it fell into. */
function classifyIpv4(
	host: string,
): { kind: 'public' } | { kind: 'reserved'; label: string } | null {
	const ip = parseIpv4(host);
	if (!ip) return null;
	for (const range of IPV4_BLOCKED_RANGES) {
		const base = parseIpv4(range.base);
		if (!base) continue;
		const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
		if ((ip.value & mask) >>> 0 === (base.value & mask) >>> 0) {
			return { kind: 'reserved', label: range.label };
		}
	}
	return { kind: 'public' };
}

/** IPv6 in 8 hextets, or `null` when `host` is not an IPv6 literal. */
function parseIpv6(host: string): number[] | null {
	if (!host.includes(':')) return null;

	// A zone id (`fe80::1%eth0`) only ever names a local interface, and
	// a scoped *public* address is not addressable anyway; drop it
	// before parsing so the remainder is still judged.
	const zoneIndex = host.indexOf('%');
	const value = zoneIndex === -1 ? host : host.slice(0, zoneIndex);

	// A literal may carry an embedded IPv4 in its low 32 bits.
	let tail: [number, number] | null = null;
	const lastColon = value.lastIndexOf(':');
	const embedded = value.slice(lastColon + 1);
	if (embedded.includes('.')) {
		const ip = parseIpv4(embedded);
		if (!ip) return null;
		tail = [Math.floor(ip.value / 65536), ip.value % 65536];
	}

	const halves = value.split('::');
	if (halves.length > 2) return null;

	const toWords = (groups: string[]): number[] | null => {
		const out: number[] = [];
		for (const group of groups) {
			if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
			out.push(Number.parseInt(group, 16));
		}
		return out;
	};

	const head = toWords(halves[0] === '' ? [] : halves[0].split(':'));
	const tailGroups = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : null;
	const rear = toWords(tailGroups ?? []);
	if (!head || !rear) return null;

	let words: number[];
	if (tailGroups === null) {
		if (head.length !== 8) return null;
		words = head;
	} else {
		const fill = 8 - head.length - rear.length;
		if (fill < 1) return null;
		words = [...head, ...new Array<number>(fill).fill(0), ...rear];
	}
	if (tail) words = [...words.slice(0, 6), tail[0], tail[1]];
	return words;
}

function embeddedIpv4(words: readonly number[]): string {
	return `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
}

/**
 * `public`, or the label of the reserved range it fell into.
 *
 * The three tunnelling prefixes (`::ffff:0:0/96`, `64:ff9b::/96`,
 * `2002::/16`) embed a full IPv4 address, so `::ffff:127.0.0.1` and
 * `2002:7f00:0001::` are judged by the IPv4 rules rather than by the
 * IPv6 prefix.
 */
function classifyIpv6(
	host: string,
): { kind: 'public' } | { kind: 'reserved'; label: string } | null {
	const words = parseIpv6(host);
	if (!words) return null;
	const zeroThroughSix = words.slice(0, 6).every((word) => word === 0);

	// `::1` — loopback is one bit in an otherwise zero address, so it
	// is checked before the ranges rather than inside them.
	if (zeroThroughSix && words[6] === 0 && words[7] === 1) {
		return { kind: 'reserved', label: 'loopback (::1)' };
	}
	// `::` and `::2`..`::ffff` below /96 are IPv4-compatible; RFC 4291
	// deprecates the whole block, so nothing legitimate lives there.
	if (zeroThroughSix && words[6] === 0) {
		return { kind: 'reserved', label: 'unspecified / IPv4-compatible (RFC 4291 §2.5.2)' };
	}

	const embeddedV4 = (): { kind: 'public' } | { kind: 'reserved'; label: string } | null => {
		const result = classifyIpv4(embeddedIpv4(words));
		return result === null ? null : result;
	};

	if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
		return embeddedV4() ?? { kind: 'public' };
	}
	if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0)) {
		return embeddedV4() ?? { kind: 'public' };
	}
	if (words[0] === 0x2002) {
		return embeddedV4() ?? { kind: 'public' };
	}

	const inRange = (first: number, bits: number): boolean => {
		const mask = bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff;
		return (words[0] & mask) >>> 0 === (first & mask) >>> 0;
	};

	if (words[0] === 0x0064 && words.slice(1, 4).every((w) => w === 0)) {
		return { kind: 'reserved', label: 'discard-only (RFC 6666)' };
	}
	if (inRange(0x2001, 32) && words[1] === 0x0db8) {
		return { kind: 'reserved', label: 'documentation (RFC 3849)' };
	}
	if (inRange(0xfc00, 7)) return { kind: 'reserved', label: 'unique local (RFC 4193)' };
	if (inRange(0xfe80, 10)) return { kind: 'reserved', label: 'link-local' };
	if (inRange(0xfec0, 10)) return { kind: 'reserved', label: 'site-local (deprecated)' };
	if (inRange(0xff00, 8)) return { kind: 'reserved', label: 'multicast' };
	return { kind: 'public' };
}

type HostVerdict =
	| { readonly ok: true }
	| { readonly ok: false; readonly code: OutboundUrlRefusalCode; readonly reason: string };

/** Exact host, or a label-boundary suffix match (`x.internal`, not `evilinternal`). */
function matchesHostRule(host: string, rule: string): boolean {
	const normalized = rule.replace(/^\.+|\.+$/g, '').toLowerCase();
	if (normalized === '') return false;
	return host === normalized || host.endsWith(`.${normalized}`);
}

function classifyHost(hostname: string, policy: OutboundUrlPolicy): HostVerdict {
	const host = hostname.toLowerCase().replace(/\.+$/, '');
	if (host === '') {
		return { ok: false, code: 'host_not_allowed', reason: 'empty host' };
	}

	if ((policy.allowedHosts ?? []).some((candidate) => matchesHostRule(host, candidate))) {
		return { ok: true };
	}

	// `URL` keeps an IPv6 literal in `hostname` wrapped in brackets, so
	// the address branch runs before the ASCII-name check: `[::1]` is an
	// address, not a malformed hostname.
	const bracketed = host.startsWith('[') && host.endsWith(']');
	const bare = bracketed ? host.slice(1, -1) : host;

	const judgeAddress = (address: { kind: 'public' } | { kind: 'reserved'; label: string }) => {
		if (address.kind === 'reserved') {
			return {
				ok: false,
				code: 'private_address',
				reason: `${bare} is a non-public address — ${address.label}`,
			} as const;
		}
		if (policy.allowIpLiterals !== true) {
			return {
				ok: false,
				code: 'ip_literal_not_allowed',
				reason: `${bare} is a public address literal; the policy requires a hostname`,
			} as const;
		}
		return { ok: true } as const;
	};

	if (bracketed) {
		const address = classifyIpv6(bare);
		if (!address) {
			return { ok: false, code: 'host_not_allowed', reason: `${bare} is not a valid IPv6 literal` };
		}
		return judgeAddress(address);
	}

	// A non-ASCII host is either IDN or a homograph. Punycode is a pure
	// function, so a caller that really needs one passes the `xn--`
	// form through `allowedHosts`; transliterating attacker input here
	// would make the check depend on a normalisation library's revision
	// history, which is exactly the wrong dependency for a security
	// boundary.
	if (!/^[a-z0-9.\-]+$/.test(host)) {
		return {
			ok: false,
			code: 'host_not_allowed',
			reason: 'host is not an ASCII hostname (pass an explicit punycode form via allowedHosts)',
		};
	}

	const address = classifyIpv4(bare);
	if (address) return judgeAddress(address);

	if (!host.includes('.')) {
		return {
			ok: false,
			code: 'host_not_allowed',
			reason: `${host} is a single label; only fully qualified public hostnames are fetched`,
		};
	}
	if (host.includes('..')) {
		return { ok: false, code: 'host_not_allowed', reason: 'host contains an empty label' };
	}
	for (const denied of [...OUTBOUND_DENIED_HOSTNAMES, ...(policy.deniedHostSuffixes ?? [])]) {
		if (matchesHostRule(host, denied)) {
			return {
				ok: false,
				code: 'host_not_allowed',
				reason: `${host} is a reserved or internal name`,
			};
		}
	}
	return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Classify one absolute URL against the outbound policy.
 *
 * On success the returned `URL` is the **WHATWG-normalised** form — the
 * exact string the caller should hand to `fetch()`, so there is no
 * window in which the string that was checked differs from the string
 * that is requested. On failure the reason is safe to log: it names the
 * rule and the offending component, never the submitted value, and a
 * URL carrying credentials never reaches this module's output because
 * it is refused first.
 */
export function classifyOutboundUrl(
	raw: unknown,
	policy: OutboundUrlPolicy = {},
): OutboundUrlVerdict {
	if (typeof raw !== 'string' || raw.length === 0) {
		return { ok: false, code: 'invalid_url', reason: 'url must be a non-empty string' };
	}
	if (raw.length > MAX_OUTBOUND_URL_LENGTH) {
		return {
			ok: false,
			code: 'url_too_long',
			reason: `url is ${raw.length} characters, the limit is ${MAX_OUTBOUND_URL_LENGTH}`,
		};
	}
	if (hasControlOrSpace(raw)) {
		return {
			ok: false,
			code: 'invalid_url',
			reason: 'url contains a control character or whitespace',
		};
	}

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, code: 'invalid_url', reason: 'url is not an absolute URL' };
	}

	if (!OUTBOUND_ALLOWED_PROTOCOLS.includes(url.protocol as 'http:' | 'https:')) {
		return {
			ok: false,
			code: 'protocol_not_allowed',
			reason: `${url.protocol} is not one of ${OUTBOUND_ALLOWED_PROTOCOLS.join(', ')}`,
		};
	}

	if (url.username !== '' || url.password !== '') {
		return {
			ok: false,
			code: 'credentials_in_url',
			reason: 'url carries userinfo; credentials are never sent to a third-party origin',
		};
	}

	const host = classifyHost(url.hostname, policy);
	if (!host.ok) return host;

	// `URL` collapses an absent port to the protocol default, so an
	// explicit `:443` on https is indistinguishable from no port —
	// which is correct, and `:8443` stays visible here.
	const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
	const allowedPorts: readonly string[] = [
		...OUTBOUND_ALLOWED_PORTS.map((value) => String(value)),
		...(policy.allowedPorts ?? []).map((value) => String(value)),
	];
	if (!allowedPorts.includes(port)) {
		return {
			ok: false,
			code: 'port_not_allowed',
			reason: `port ${port} is not one of ${allowedPorts.join(', ')}`,
		};
	}

	return { ok: true, url };
}

/**
 * Resolve a `Location` header against the URL that produced it, then
 * classify the result. The adapter's hop loop calls this for every hop,
 * so an absolute or scheme-relative redirect target goes through
 * exactly the same rules as the caller's own input.
 */
export function classifyOutboundRedirect(
	location: string,
	base: URL,
	policy: OutboundUrlPolicy = {},
): OutboundUrlVerdict {
	let resolved: string;
	try {
		resolved = new URL(location, base).toString();
	} catch {
		return { ok: false, code: 'invalid_url', reason: 'redirect Location is not a usable URL' };
	}
	return classifyOutboundUrl(resolved, policy);
}
