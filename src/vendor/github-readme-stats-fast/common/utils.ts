/**
 * Common utilities for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/common/utils.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 *
 * Changes for Workers:
 * - Replaced `axios` with native `fetch`
 * - Removed `dotenv`, `emoji-name-map`, `word-wrap` dependencies
 * - Added TypeScript types
 * - `request()` now uses native fetch to GitHub GraphQL API
 * - `logger` routes through src/logging (Issue #996), silent in tests
 */

import { themes } from '../themes/index.ts';
import { createAuditLogger } from '../../../logging/logger';

const TRY_AGAIN_LATER = 'Please try again later';

const SECONDARY_ERROR_MESSAGES: Record<string, string> = {
	MAX_RETRY: 'You can deploy own instance or wait until public will be no longer limited',
	NO_TOKENS: 'Please add an env variable called PAT_1 with your GitHub API token',
	USER_NOT_FOUND: 'Make sure the provided username is not an organization',
	GRAPHQL_ERROR: TRY_AGAIN_LATER,
	GITHUB_REST_API_ERROR: TRY_AGAIN_LATER,
	WAKATIME_USER_NOT_FOUND: 'Make sure you have a public WakaTime profile',
};

/**
 * Custom error class to handle custom GRS errors.
 */
export class CustomError extends Error {
	public readonly type: string;
	public readonly secondaryMessage: string;

	constructor(message: string, type: string) {
		super(message);
		this.name = 'CustomError';
		this.type = type;
		this.secondaryMessage = SECONDARY_ERROR_MESSAGES[type] || type;
	}

	static readonly MAX_RETRY = 'MAX_RETRY';
	static readonly NO_TOKENS = 'NO_TOKENS';
	static readonly USER_NOT_FOUND = 'USER_NOT_FOUND';
	static readonly GRAPHQL_ERROR = 'GRAPHQL_ERROR';
	static readonly GITHUB_REST_API_ERROR = 'GITHUB_REST_API_ERROR';
	static readonly WAKATIME_ERROR = 'WAKATIME_ERROR';
}

/**
 * Auto layout utility, allows us to layout things vertically or horizontally with
 * proper gaping.
 */
export function flexLayout({
	items,
	gap,
	direction = 'column',
	sizes = [],
}: {
	items: string[];
	gap: number;
	direction?: 'column' | 'row';
	sizes?: number[];
}): string[] {
	let lastSize = 0;
	return items.filter(Boolean).map((item, i) => {
		const size = sizes[i] || 0;
		let transform = `translate(${lastSize}, 0)`;
		if (direction === 'column') {
			transform = `translate(0, ${lastSize})`;
		}
		lastSize += size + gap;
		return `<g transform="${transform}">${item}</g>`;
	});
}

/**
 * Creates a node to display the primary programming language of the repository/gist.
 */
export function createLanguageNode(langName: string, langColor: string): string {
	return `
    <g data-testid="primary-lang">
      <circle data-testid="lang-color" cx="0" cy="-5" r="6" fill="${langColor}" />
      <text data-testid="lang-name" class="gray" x="15">${langName}</text>
    </g>
    `;
}

/**
 * Creates an icon with label to display repository/gist stats like forks, stars, etc.
 */
export function iconWithLabel(
	icon: string,
	label: number | string,
	testid: string,
	iconSize: number,
): string {
	if (typeof label === 'number' && label <= 0) {
		return '';
	}
	const iconSvg = `
      <svg
        class="icon"
        y="-12"
        viewBox="0 0 16 16"
        version="1.1"
        width="${iconSize}"
        height="${iconSize}"
      >
        ${icon}
      </svg>
    `;
	const text = `<text data-testid="${testid}" class="gray">${label}</text>`;
	return flexLayout({ items: [iconSvg, text], gap: 20 }).join('');
}

/**
 * Retrieves num with suffix k(thousands) precise to 1 decimal if greater than 999.
 */
export function kFormatter(num: number): string | number {
	return Math.abs(num) > 999
		? Math.sign(num) * Number.parseFloat((Math.abs(num) / 1000).toFixed(1)) + 'k'
		: Math.sign(num) * Math.abs(num);
}

/**
 * Checks if a string is a valid hex color.
 */
export function isValidHexColor(hexColor: string): boolean {
	return new RegExp(/^([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{4})$/).test(
		hexColor,
	);
}

/**
 * Returns boolean if value is either "true" or "false" else the value as it is.
 */
export function parseBoolean(value: string | boolean | undefined): boolean | undefined {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		if (value.toLowerCase() === 'true') {
			return true;
		} else if (value.toLowerCase() === 'false') {
			return false;
		}
	}
	return undefined;
}

/**
 * Parse string to array of strings.
 */
export function parseArray(str: string | undefined): string[] {
	if (!str) {
		return [];
	}
	return str.split(',');
}

/**
 * Clamp the given number between the given range.
 */
export function clampValue(number: number | string, min: number, max: number): number {
	const parsed = typeof number === 'string' ? Number.parseInt(number, 10) : number;
	if (Number.isNaN(parsed)) {
		return min;
	}
	return Math.max(min, Math.min(parsed, max));
}

/**
 * Check if the given string is a valid gradient.
 */
export function isValidGradient(colors: string[]): boolean {
	return colors.length > 2 && colors.slice(1).every((color) => isValidHexColor(color));
}

/**
 * Retrieves a gradient if color has more than one valid hex codes else a single color.
 */
export function fallbackColor(
	color: string | undefined,
	fallbackColor: string | string[],
): string | string[] {
	let gradient: string[] | null = null;

	const colors = color ? color.split(',') : [];
	if (colors.length > 1 && isValidGradient(colors)) {
		gradient = colors;
	}

	return (gradient ? gradient : isValidHexColor(color ?? '') && `#${color}`) || fallbackColor;
}

export interface CardColors {
	titleColor: string;
	iconColor: string;
	textColor: string;
	bgColor: string | string[];
	borderColor: string;
	ringColor: string;
}

/**
 * Returns theme based colors with proper overrides and defaults.
 */
export function getCardColors({
	title_color,
	text_color,
	icon_color,
	bg_color,
	border_color,
	ring_color,
	theme,
	fallbackTheme = 'default',
}: {
	title_color?: string;
	text_color?: string;
	icon_color?: string;
	bg_color?: string;
	border_color?: string;
	ring_color?: string;
	theme?: string;
	fallbackTheme?: string;
}): CardColors {
	const defaultTheme = themes[fallbackTheme];
	const selectedTheme = themes[theme ?? ''] || defaultTheme;
	const defaultBorderColor = selectedTheme.border_color || defaultTheme.border_color;

	const titleColor = fallbackColor(
		title_color || selectedTheme.title_color,
		'#' + defaultTheme.title_color,
	) as string;

	const ringColor = fallbackColor(ring_color || selectedTheme.ring_color, titleColor) as string;

	const iconColor = fallbackColor(
		icon_color || selectedTheme.icon_color,
		'#' + defaultTheme.icon_color,
	) as string;

	const textColor = fallbackColor(
		text_color || selectedTheme.text_color,
		'#' + defaultTheme.text_color,
	) as string;

	const bgColor = fallbackColor(bg_color || selectedTheme.bg_color, '#' + defaultTheme.bg_color);

	const borderColor = fallbackColor(
		border_color || defaultBorderColor,
		'#' + defaultBorderColor,
	) as string;

	if (
		typeof titleColor !== 'string' ||
		typeof textColor !== 'string' ||
		typeof ringColor !== 'string' ||
		typeof iconColor !== 'string' ||
		typeof borderColor !== 'string'
	) {
		throw new Error('Unexpected behavior, all colors except background should be string.');
	}

	return { titleColor, iconColor, textColor, bgColor, borderColor, ringColor };
}

const ERROR_CARD_LENGTH = 576.5;

/**
 * Encode string as HTML.
 */
export function encodeHTML(str: string): string {
	return str
		.replace(/[\u00A0-\u9999<>&](?!#)/gim, (i) => {
			return '&#' + i.charCodeAt(0) + ';';
		})
		.replace(/\u0008/gim, '');
}

const UPSTREAM_API_ERRORS = [TRY_AGAIN_LATER, SECONDARY_ERROR_MESSAGES.MAX_RETRY];

/**
 * Renders error message on the card.
 * SANITIZED: Never includes tokens, internal URLs, or stack traces.
 */
export function renderError(
	message: string,
	secondaryMessage = '',
	options: {
		title_color?: string;
		text_color?: string;
		bg_color?: string;
		border_color?: string;
		theme?: string;
	} = {},
): string {
	const { title_color, text_color, bg_color, border_color, theme = 'default' } = options;

	const { titleColor, textColor, bgColor, borderColor } = getCardColors({
		title_color,
		text_color,
		icon_color: '',
		bg_color,
		border_color,
		ring_color: '',
		theme,
	});

	return `
    <svg width="${ERROR_CARD_LENGTH}"  height="120" viewBox="0 0 ${ERROR_CARD_LENGTH} 120" fill="${bgColor}" xmlns="http://www.w3.org/2000/svg">
    <style>
    .text { font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${titleColor} }
    .small { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${textColor} }
    .gray { fill: #858585 }
    </style>
    <rect x="0.5" y="0.5" width="${
			ERROR_CARD_LENGTH - 1
		}" height="99%" rx="4.5" fill="${bgColor}" stroke="${borderColor}"/>
    <text x="25" y="45" class="text">Something went wrong!${
			UPSTREAM_API_ERRORS.includes(secondaryMessage)
				? ''
				: ' file an issue at https://tiny.one/readme-stats'
		}</text>
    <text data-testid="message" x="25" y="55" class="text small">
      <tspan x="25" dy="18">${encodeHTML(message)}</tspan>
      <tspan x="25" dy="18" class="gray">${encodeHTML(secondaryMessage)}</tspan>
    </text>
    </svg>
  `;
}

/**
 * Split text over multiple lines based on the card width.
 */
export function wrapTextMultiline(text: string, width = 59, maxLines = 3): string[] {
	const fullWidthComma = '，';
	const encoded = encodeHTML(text);
	const isChinese = encoded.includes(fullWidthComma);

	let wrapped: string[];

	if (isChinese) {
		wrapped = encoded.split(fullWidthComma);
	} else {
		// Simple word-wrap implementation (replaces `word-wrap` package)
		const words = encoded.split(' ');
		const lines: string[] = [];
		let currentLine = '';
		for (const word of words) {
			if ((currentLine + ' ' + word).trim().length > width) {
				if (currentLine) lines.push(currentLine.trim());
				currentLine = word;
			} else {
				currentLine = (currentLine + ' ' + word).trim();
			}
		}
		if (currentLine) lines.push(currentLine.trim());
		wrapped = lines;
	}

	const lines = wrapped.map((line) => line.trim()).slice(0, maxLines);

	if (wrapped.length > maxLines) {
		lines[maxLines - 1] += '...';
	}

	return lines.filter(Boolean);
}

const noop = () => {};

/**
 * Issue #996: `console` is owned by `src/logging/logger.ts` — the only
 * module allowed to touch it in `src/**`. The previous `console`
 * fallback let upstream GraphQL error payloads reach the Worker log
 * stream outside the redaction contract, and the literal-`console.`
 * gate could not see the alias. Diagnostics now go through the audit
 * logger, which redacts before emitting; test mode stays silent.
 */
const vendorAudit = createAuditLogger('github-readme-stats');

const UPSTREAM_TIMEOUT_MS = 15_000;

export const logger =
	typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
		? { log: noop, error: noop }
		: {
				log: (detail: unknown) => vendorAudit.audit('vendor-info', { detail }),
				error: (detail: unknown) => vendorAudit.audit('vendor-error', { detail }),
			};

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const CONSTANTS = {
	ONE_MINUTE: MIN,
	FIVE_MINUTES: 5 * MIN,
	TEN_MINUTES: 10 * MIN,
	FIFTEEN_MINUTES: 15 * MIN,
	THIRTY_MINUTES: 30 * MIN,

	TWO_HOURS: 2 * HOUR,
	FOUR_HOURS: 4 * HOUR,
	SIX_HOURS: 6 * HOUR,
	EIGHT_HOURS: 8 * HOUR,
	TWELVE_HOURS: 12 * HOUR,

	ONE_DAY: DAY,
	TWO_DAY: 2 * DAY,
	SIX_DAY: 6 * DAY,
	TEN_DAY: 10 * DAY,

	CARD_CACHE_SECONDS: DAY,
	TOP_LANGS_CACHE_SECONDS: 6 * DAY,
	PIN_CARD_CACHE_SECONDS: 10 * DAY,
	ERROR_CACHE_SECONDS: 10 * MIN,
};

/**
 * Missing query parameter class.
 */
export class MissingParamError extends Error {
	public readonly missedParams: string[];
	public readonly secondaryMessage: string | undefined;

	constructor(missedParams: string[], secondaryMessage?: string) {
		const msg = `Missing params ${missedParams
			.map((p) => `"${p}"`)
			.join(', ')} make sure you pass the parameters in URL`;
		super(msg);
		this.name = 'MissingParamError';
		this.missedParams = missedParams;
		this.secondaryMessage = secondaryMessage;
	}
}

/**
 * Retrieve text length (approximate).
 */
export function measureText(str: string, fontSize = 10): number {
	const widths = [
		0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		0, 0.2796875, 0.2765625, 0.3546875, 0.5546875, 0.5546875, 0.8890625, 0.665625, 0.190625,
		0.3328125, 0.3328125, 0.3890625, 0.5828125, 0.2765625, 0.3328125, 0.2765625, 0.3015625,
		0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875,
		0.5546875, 0.2765625, 0.2765625, 0.584375, 0.5828125, 0.584375, 0.5546875, 1.0140625, 0.665625,
		0.665625, 0.721875, 0.721875, 0.665625, 0.609375, 0.7765625, 0.721875, 0.2765625, 0.5, 0.665625,
		0.5546875, 0.8328125, 0.721875, 0.7765625, 0.665625, 0.7765625, 0.721875, 0.665625, 0.609375,
		0.721875, 0.665625, 0.94375, 0.665625, 0.665625, 0.609375, 0.2765625, 0.3546875, 0.2765625,
		0.4765625, 0.5546875, 0.3328125, 0.5546875, 0.5546875, 0.5, 0.5546875, 0.5546875, 0.2765625,
		0.5546875, 0.5546875, 0.221875, 0.240625, 0.5, 0.221875, 0.8328125, 0.5546875, 0.5546875,
		0.5546875, 0.5546875, 0.3328125, 0.5, 0.2765625, 0.5546875, 0.5, 0.721875, 0.5, 0.5, 0.5,
		0.3546875, 0.259375, 0.353125, 0.5890625,
	];

	const avg = 0.5279276315789471;
	return (
		str
			.split('')
			.map((c) => (c.charCodeAt(0) < widths.length ? widths[c.charCodeAt(0)] : avg))
			.reduce((cur, acc) => acc + cur) * fontSize
	);
}

export function lowercaseTrim(name: string): string {
	return name.toLowerCase().trim();
}

/**
 * Split array of languages in two columns.
 */
export function chunkArray<T>(arr: T[], perChunk: number): T[][] {
	return arr.reduce((resultArray, item, index) => {
		const chunkIndex = Math.floor(index / perChunk);
		if (!resultArray[chunkIndex]) {
			resultArray[chunkIndex] = [];
		}
		resultArray[chunkIndex].push(item);
		return resultArray;
	}, [] as T[][]);
}

export function parseEmojis(str: string): string {
	if (!str) {
		throw new Error('[parseEmoji]: str argument not provided');
	}
	// Simple emoji parsing - just return as-is for now
	// Upstream used emoji-name-map which we don't vendor
	return str;
}

export function dateDiff(d1: Date, d2: Date): number {
	const date1 = new Date(d1);
	const date2 = new Date(d2);
	const diff = date1.getTime() - date2.getTime();
	return Math.round(diff / (1000 * 60));
}

/**
 * Get GitHub token from environment (Workers bindings).
 * Reads from PAT_1, PAT_2, ... or GITHUB_TOKEN.
 */
export function getGithubToken(env: Record<string, string | undefined>): string | undefined {
	// Try numbered PATs first
	for (let i = 1; i <= 10; i++) {
		const token = env[`GITHUB_README_STATS_PAT_${i}`];
		if (token) return token;
	}
	// Fallback to generic GITHUB_TOKEN
	return env.GITHUB_TOKEN;
}

/**
 * Send GraphQL request to GitHub API using native fetch.
 * Returns the GraphQL data field directly (responseData.data) for compatibility with fetchers.
 */
export async function request<T = unknown>(
	data: { query: string; variables: Record<string, unknown> },
	headers: Record<string, string>,
	env: Record<string, string | undefined>,
): Promise<{
	data: T;
	status: number;
	statusText: string;
	errors?: Array<{ type: string; message: string }>;
}> {
	const token = getGithubToken(env);
	if (!token) {
		throw new CustomError('GitHub token not configured', CustomError.NO_TOKENS);
	}

	const response = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			// workerd's fetch sends no User-Agent; api.github.com rejects
			// such requests with a plain-text 403 that is not JSON, which
			// surfaced as a misleading per-request error card instead of
			// statistics. Same convention as src/http/outbound-fetch.ts.
			'User-Agent': 'my-web-2026 (+https://rebuildup.dev)',
			Authorization: `bearer ${token}`,
			...headers,
		},
		body: JSON.stringify(data),
		// Issue #996: a hung GitHub connection must not hold the Worker
		// request open — the retryer multiplies whatever this allows.
		signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
	});

	const responseData = (await response.json()) as {
		data?: T;
		errors?: Array<{ type: string; message: string }>;
	};
	// Return GraphQL data field directly for fetcher compatibility
	return {
		data: responseData.data as T,
		status: response.status,
		statusText: response.statusText,
		errors: responseData.errors,
	};
}
