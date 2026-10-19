#!/usr/bin/env node
/**
 * check-css-syntax — CSS syntax / vocabulary gate for the shipped CSS
 * (Issue #413).
 *
 * Why this gate exists
 * --------------------
 * Panda generates the CSS this project ships, and nothing in the
 * toolchain ever parses it. `pnpm run build` proves the bundle
 * assembles; it does not prove the stylesheet is well formed. A typo in
 * a token value (`translateY` → `translatey`), a half-finished
 * declaration (`color:`), a dropped semicolon, or a property name that
 * no specification defines all produce a **silently dropped
 * declaration**: the rule parses, the page renders without the
 * intended style, and every gate stays green. The W3C CSS validator
 * answers exactly this question, but calling it from CI would make the
 * gate depend on a third-party network service, so this repository
 * validates the same questions offline instead: a CSS-Syntax-level
 * parser plus a reviewed vocabulary (property / at-rule / function
 * names and the enumerated keyword values the project relies on).
 *
 * What it validates
 * -----------------
 *   1. **Syntax** — a real tokenizer + parser (not a regex): unbalanced
 *      blocks, unterminated comments / strings / urls, a declaration
 *      without `:`, an empty property or value, a missing `;` between
 *      declarations, a stray `}`, a malformed `!important`, a
 *      declaration at stylesheet top level, a keyframe selector that is
 *      not `from` / `to` / `<percentage>`, and at-rule preludes that
 *      cannot be what they claim to be (`@media min-width: 40rem`,
 *      `@font-face Foo { … }`).
 *   2. **Vocabulary** — every property, at-rule and value function must
 *      be defined by the reviewed vocabulary in
 *      `quality/css-standards.json`. An unknown name fails instead of
 *      being dropped by the browser. Vendor prefixes and
 *      specification-permitted extensions are accepted only through an
 *      **explicit allowlist entry** carrying a reason and a basis URL;
 *      a vendor-prefixed property is accepted only when its unprefixed
 *      counterpart is in the vocabulary, so `-webkit-totally-made-up`
 *      can never ride the prefix rule.
 *   3. **Context** — descriptors that only exist inside `@font-face`
 *      (`src`, `size-adjust`, `ascent-override`, …) fail anywhere else,
 *      and `@font-face` rejects properties that are not descriptors.
 *   4. **Enumerated values** — for the properties whose CSS grammar is
 *      a closed keyword list, the value must be one of the declared
 *      keywords (CSS-wide keywords and `var()` excluded, exactly as a
 *      validator must, because their final value is not knowable
 *      statically).
 *
 * What it refuses to do
 * ---------------------
 * It never ships a dependency, never reaches the network, and never
 * reads a secret, a `.dev.vars` file or a Cloudflare binding. The
 * generated artifact is produced by `panda cssgen` into `.tmp/`
 * (gitignored, AGENTS.md §9) — the gate writes no tracked file.
 *
 * No silent pass
 * --------------
 * A gate that stops looking at the CSS is worse than no gate, so the
 * following are errors, never a quiet success:
 *
 *   - a declared surface that yields no declarations (the Panda
 *     artifact vanished, or a placeholder CSS file was added)
 *   - a `.css` file under the coverage root owned by no surface (a new
 *     stylesheet would otherwise be unvalidated)
 *   - the Panda artifact that cannot be generated at all
 *   - a total declaration count below the policy floor (a parser
 *     regression must not read as "nothing to complain about")
 *   - an allowlist entry that suppresses nothing (stale waiver)
 *   - a vendor prefix whose unprefixed counterpart is not in the
 *     vocabulary (a prefix may not smuggle an unknown property in)
 *   - a vocabulary entry that no surface can reach is reported, and a
 *     zero-length vocabulary fails at manifest load
 *
 * Usage:
 *   node scripts/check-css-syntax.mjs
 *   node scripts/check-css-syntax.mjs --json
 *   node scripts/check-css-syntax.mjs --artifact path/to/bundle.css
 *   node scripts/check-css-syntax.mjs --no-generate   # use the last artifact
 *
 * Exit codes: 0 = gate passed, 1 = gate failed, 2 = the manifest or the
 * artifact could not be used.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MANIFEST = 'quality/css-standards.json';

/** Where `panda cssgen` writes when the gate generates it itself. */
export const DEFAULT_ARTIFACT = '.tmp/css-syntax/panda-generated.css';

/** Guard rails so a suppression cannot quietly become a blanket. */
const MIN_REASON_CHARS = 40;
const MAX_LISTED = 10;

/** The only at-rule blocks that hold declarations rather than rules. */
const DECLARATION_AT_RULES = new Set([
	'font-face',
	'page',
	'property',
	'counter-style',
	'font-palette-values',
	'font-feature-values',
	'viewport',
	'-ms-viewport',
]);

/** The only at-rules whose block holds keyframe blocks. */
const KEYFRAME_AT_RULES = new Set([
	'keyframes',
	'-webkit-keyframes',
	'-moz-keyframes',
	'-o-keyframes',
]);

export class ManifestError extends Error {}

/* ------------------------------------------------------------------ *
 * tokenizer
 * ------------------------------------------------------------------ */

const isWhitespace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
const isHexDigit = (c) => isDigit(c) || (c !== undefined && /[a-fA-F]/.test(c));
const isNameStart = (c) => isLetter(c) || c === '_' || (c !== undefined && c.charCodeAt(0) >= 0x80);
const isNameChar = (c) => isNameStart(c) || isDigit(c) || c === '-';

/**
 * Length of the escape sequence starting at `\` (CSS Syntax Level 3
 * "consume an escaped code point"), and the character it decodes to.
 *
 * Panda escapes class-name punctuation in selectors
 * (`.grid-tc_minmax\(0\,_2fr\)`), so a tokenizer that treats `\` as an
 * ordinary character mis-reads the selector, swallows the following
 * `(` as a function call and then reports the whole rest of the sheet
 * as unclosed. Decoding the escape is also what makes a token's value
 * comparable with the vocabulary (`anim-tmf_cubic-bezier`, not
 * `anim-tmf\_cubic-bezier`).
 */
function consumeEscape(css, index) {
	let k = index + 1;
	if (isHexDigit(css[k])) {
		let hex = 0;
		let digits = 0;
		while (digits < 6 && isHexDigit(css[k])) {
			hex = hex * 16 + Number.parseInt(css[k], 16);
			k += 1;
			digits += 1;
		}
		if (isWhitespace(css[k])) k += 1;
		const code = hex === 0 || hex > 0x10ffff || (hex >= 0xd800 && hex <= 0xdfff) ? 0xfffd : hex;
		return { length: k - index, value: String.fromCodePoint(code) };
	}
	if (css[k] === undefined) return { length: 1, value: '�' };
	return { length: 2, value: css[k] };
}

/** Consume a name, returning `{ end, value }` with escapes decoded. */
function consumeName(css, start) {
	let i = start;
	let value = '';
	while (i < css.length) {
		const c = css[i];
		if (c === '\\') {
			const stringEscape = consumeEscape(css, i);
			value += stringEscape.value;
			i += stringEscape.length;
			continue;
		}
		if (!isNameChar(c)) break;
		value += c;
		i += 1;
	}
	return { end: i, value };
}

/**
 * Tokenize one stylesheet.
 *
 * Token shapes are deliberately close to CSS Syntax Level 3 so the
 * rules below can name what they found: `{ type, value, start, end,
 * line, column }`. A tokenizer that is too permissive is worse than
 * none here, because the gate's whole claim is "the CSS parses".
 */
export function tokenize(css) {
	const tokens = [];
	const diagnostics = [];
	let line = 1;
	let lineStart = 0;
	let i = 0;

	const push = (type, start, end, value) => {
		tokens.push({
			type,
			value: value ?? css.slice(start, end),
			start,
			end,
			line,
			column: start - lineStart + 1,
		});
	};
	const fail = (rule, start, message) => {
		diagnostics.push({ rule, message, line, column: start - lineStart + 1 });
	};

	const newline = (from, to) => {
		for (let k = from; k < to; k += 1) {
			if (css[k] === '\n') {
				line += 1;
				lineStart = k + 1;
			}
		}
	};

	while (i < css.length) {
		const start = i;
		const c = css[i];

		if (isWhitespace(c)) {
			i += 1;
			while (i < css.length && isWhitespace(css[i])) i += 1;
			newline(start, i);
			push('ws', start, i);
			continue;
		}

		if (c === '/' && css[i + 1] === '*') {
			const close = css.indexOf('*/', i + 2);
			if (close === -1) {
				fail('unterminated_comment', start, 'comment is never closed with `*/`');
				newline(start, css.length);
				i = css.length;
				push('comment', start, i);
				continue;
			}
			newline(start, close + 2);
			i = close + 2;
			push('comment', start, i);
			continue;
		}

		if (c === '"' || c === "'") {
			const quote = c;
			i += 1;
			let closed = false;
			let value = '';
			while (i < css.length) {
				if (css[i] === '\\') {
					if (css[i + 1] === '\n') {
						fail('unterminated_string', start, 'a string may not continue on the next line');
						newline(start, i + 2);
						i += 2;
						break;
					}
					// `nameEscape.length` covers the backslash and the escaped
					// code point (plus one trailing whitespace for a hex
					// escape). Advancing any further steps over the character
					// after the escape, which is how `content: "\2014"` used
					// to read as an unterminated string.
					const nameEscape = consumeEscape(css, i);
					value += nameEscape.value;
					i += nameEscape.length;
					continue;
				}
				if (css[i] === quote) {
					i += 1;
					closed = true;
					break;
				}
				if (css[i] === '\n') {
					fail(
						'unterminated_string',
						start,
						`string opened with ${quote} is not closed on the same line`,
					);
					newline(start, i + 1);
					i += 1;
					break;
				}
				value += css[i];
				i += 1;
			}
			if (!closed && i >= css.length) {
				fail('unterminated_string', start, `string opened with ${quote} is never closed`);
			}
			push('bad-string', start, i, value);
			newline(start, i);
			continue;
		}

		if (c === '@') {
			i += 1;
			const name = consumeName(css, i);
			if (name.end > i) {
				i = name.end;
				push('at-keyword', start, i, `@${name.value}`);
				continue;
			}
			push('delim', start, i, '@');
			continue;
		}

		if (c === '#') {
			i += 1;
			if (isNameChar(css[i]) || css[i] === '\\') {
				const name = consumeName(css, i);
				i = name.end;
				push('hash', start, i, `#${name.value}`);
				continue;
			}
			push('delim', start, i, '#');
			continue;
		}

		if (
			isDigit(c) ||
			((c === '+' || c === '-' || c === '.') &&
				(isDigit(css[i + 1]) || (c === '.' && isDigit(css[i + 2]))))
		) {
			if (c === '+' || c === '-' || c === '.') i += 1;
			while (i < css.length && isDigit(css[i])) i += 1;
			if (css[i] === '.' && isDigit(css[i + 1])) {
				i += 2;
				while (i < css.length && isDigit(css[i])) i += 1;
			}
			if (css[i] === 'e' || css[i] === 'E') {
				const mark = i;
				i += 1;
				if (css[i] === '+' || css[i] === '-') i += 1;
				if (isDigit(css[i])) {
					while (i < css.length && isDigit(css[i])) i += 1;
				} else {
					i = mark;
				}
			}
			if (css[i] === '%') {
				i += 1;
				push('percentage', start, i);
				continue;
			}
			if (isNameChar(css[i]) || css[i] === '\\') {
				const unit = consumeName(css, i);
				i = unit.end;
				push('dimension', start, i, `${css.slice(start, i).trim()}${unit.value}`);
				continue;
			}
			push('number', start, i);
			continue;
		}

		if (
			isNameStart(c) ||
			c === '\\' ||
			(c === '-' && (isNameStart(css[i + 1]) || css[i + 1] === '-' || css[i + 1] === '\\'))
		) {
			const consumed = consumeName(css, start);
			i = consumed.end;
			const name = consumed.value;
			if (css[i] === '(') {
				if (name.toLowerCase() === 'url') {
					// `url(` with an unquoted body is a url-token per CSS
					// Syntax; `url("…")` is an ordinary function.
					let k = i + 1;
					while (k < css.length && isWhitespace(css[k])) k += 1;
					if (css[k] !== '"' && css[k] !== "'") {
						const urlStart = i;
						i = k;
						while (i < css.length && css[i] !== ')') {
							if (css[i] === '\\') i += 1;
							i += 1;
						}
						if (i >= css.length) {
							fail('bad_url', urlStart, '`url(` is never closed with `)`');
							push('bad-url', urlStart, i);
							newline(start, i);
							continue;
						}
						i += 1;
						push('url', urlStart, i);
						continue;
					}
				}
				i += 1;
				push('function', start, i, name);
				continue;
			}
			push('ident', start, i, name);
			continue;
		}

		i += 1;
		push('delim', start, i, c);
	}

	newline(i, css.length);
	push('eof', i, i, '');
	return { tokens, diagnostics };
}

/* ------------------------------------------------------------------ *
 * parser
 * ------------------------------------------------------------------ */

/**
 * Brace balance, reported independently of the tree parse.
 *
 * The recursive parser recovers from a missing `}` by unwinding, so by
 * the time it notices, the position of the offending `{` is gone. This
 * pass keeps the exact line, which is what makes the finding actionable
 * on a 2000-line generated sheet.
 */
function checkBalance(tokens) {
	const diagnostics = [];
	const open = [];
	for (const token of tokens) {
		if (token.type === 'eof') break;
		if (token.type !== 'delim') continue;
		if (token.value === '{') {
			open.push(token);
			continue;
		}
		if (token.value !== '}') continue;
		if (open.length === 0) {
			diagnostics.push({
				rule: 'stray_close_brace',
				message: 'a `}` with no matching `{` — everything after it is discarded by the parser',
				line: token.line,
				column: token.column,
			});
			continue;
		}
		open.pop();
	}
	for (const token of open) {
		diagnostics.push({
			rule: 'unclosed_block',
			message: 'the `{` on this line is never closed with `}`',
			line: token.line,
			column: token.column,
		});
	}
	return diagnostics;
}

const SKIPPABLE = new Set(['ws', 'comment']);

/** Is this token significant (i.e. not whitespace or a comment)? */
const significant = (token) => !SKIPPABLE.has(token.type);

/** Drop whitespace and comments from a token run. */
const meaningful = (tokens) => tokens.filter(significant);

/**
 * Parse a token stream into a rule / at-rule / declaration tree,
 * reporting every construct a browser would reject or silently drop.
 *
 * `mode` is `rules` (a qualified-rule list: stylesheet, `@media`,
 * `@supports`, `@layer`, …), `declarations` (a declaration list:
 * `@font-face`, a style rule), or `keyframes` (keyframe blocks only).
 */
export function parseStylesheet(css) {
	const { tokens, diagnostics: tokenDiagnostics } = tokenize(css);
	const diagnostics = [...tokenDiagnostics, ...checkBalance(tokens)];
	const stats = { declarations: 0, rules: 0, atRules: 0, comments: 0 };
	let index = 0;

	const peek = (skip = 0) => {
		let seen = 0;
		for (let k = index; k < tokens.length; k += 1) {
			if (!significant(tokens[k])) continue;
			if (seen === skip) return tokens[k];
			seen += 1;
		}
		return tokens[tokens.length - 1];
	};
	const next = () => {
		while (index < tokens.length && !significant(tokens[index])) index += 1;
		return tokens[index++];
	};
	const atEnd = () => peek()?.type === 'eof';

	const fail = (rule, token, message) => {
		if (token) diagnostics.push({ rule, message, line: token.line, column: token.column });
	};

	/**
	 * Collect the tokens of one prelude / declaration body up to a
	 * top-level stop token. Returns `{ tokens, stop }`.
	 */
	function collect(stopValues) {
		const collected = [];
		let depth = 0;
		while (index < tokens.length) {
			const token = tokens[index];
			if (token.type === 'eof') return { tokens: collected, stop: token };
			if (depth === 0 && token.type === 'delim' && stopValues.includes(token.value)) {
				index += 1;
				return { tokens: collected, stop: token };
			}
			// A `function` token carries its own opening paren and is closed
			// by a later `)`, so it raises the nesting depth too; without
			// this a selector such as `:where(:not([hidden]))` leaves the
			// depth negative and the following `{` is read as part of the
			// prelude. A `url` / `bad-url` token is self-contained — it
			// already includes its own closing paren — so raising the depth
			// for it would leave the depth permanently positive and the
			// next `;` / `{` / `}` would be swallowed as prelude.
			if (token.type === 'function') depth += 1;
			else if (token.type === 'delim' && (token.value === '(' || token.value === '[')) depth += 1;
			else if (token.type === 'delim' && (token.value === ')' || token.value === ']')) depth -= 1;
			token.depth = depth;
			collected.push(token);
			index += 1;
		}
		return { tokens: collected, stop: null };
	}

	/** Split a token run into `{ property, value, important }` or null. */
	function toDeclaration(run, sourceCss) {
		const colonAt = run.findIndex(
			(token) => token.type === 'delim' && token.value === ':' && token.depth === 0,
		);
		if (colonAt === -1) return null;
		const head = run.slice(0, colonAt);
		const tail = run.slice(colonAt + 1);
		if (head.length === 0) return null;
		// A property name is exactly one ident (or a custom property,
		// which is an ident starting with `--`). Anything else — `color red`,
		// `#id`, a stray string — is not a declaration the parser can read.
		if (head.length > 1 || (head[0].type !== 'ident' && head[0].type !== 'bad-string')) return null;

		const importantIndex = tail.findIndex((token) => token.type === 'delim' && token.value === '!');
		let valueTokens = tail;
		let important = false;
		if (importantIndex !== -1) {
			const bang = tail[importantIndex];
			const after = tail.slice(importantIndex + 1).filter(significant);
			if (after.length === 0) {
				fail('invalid_important', bang, '`!` must be followed by the `important` keyword');
			} else if (after[0].type !== 'ident' || after[0].value.toLowerCase() !== 'important') {
				fail(
					'invalid_important',
					bang,
					`\`! ${after[0].value}\` is not a valid priority — the only priority keyword is \`important\``,
				);
			} else if (after.length > 1) {
				fail('invalid_important', after[1], '`important` must be the last token in the value');
			} else if (after[0].line !== bang.line) {
				fail('invalid_important', bang, '`!important` may not be split across lines');
			} else {
				important = true;
				valueTokens = tail.slice(0, importantIndex);
			}
		}
		const significantValue = meaningful(valueTokens);
		// `--blur: ;` is legal: a custom property may hold an empty value.
		// An ordinary property with no value is dropped by the parser, which
		// is exactly the silent failure this gate exists to catch.
		if (significantValue.length === 0 && !head[0].value.startsWith('--')) {
			fail('empty_value', head[0], `\`${head[0].value}\` has no value; the declaration is dropped`);
		}
		const first = significantValue[0];
		const last = significantValue[significantValue.length - 1];
		// A second top-level `:` inside the value means a declaration lost
		// its `;` (`color: red background: blue`), which is a syntax error
		// a browser recovers from by dropping the whole run.
		if (
			valueTokens.some(
				(token) => token.type === 'delim' && token.value === ':' && token.depth === 0,
			)
		) {
			fail(
				'missing_semicolon',
				first,
				`\`${head[0].value}: ${sourceCss.slice(first.start, last?.end ?? first.end).trim()}\` declares a second property inside one value — a \`;\` is missing`,
			);
		}
		return {
			type: 'declaration',
			property: head[0].value,
			value: first && last ? sourceCss.slice(first.start, last.end).trim() : '',
			valueStart: first && last ? { start: first.start, end: last.end } : null,
			important,
			line: head[0].line,
			column: head[0].column,
		};
	}

	/**
	 * A `<percentage>` | `from` | `to` keyframe selector list.
	 *
	 * A comma-separated list is one keyframe rule: Panda emits
	 * `75%,100% { … }`, which is valid and must not be reported.
	 */
	function keyframeSelector(run) {
		const words = run.filter(significant);
		if (words.length === 0) return false;
		for (let k = 0; k < words.length; k += 1) {
			const token = words[k];
			const ok =
				token.type === 'percentage' ||
				(token.type === 'ident' &&
					(token.value.toLowerCase() === 'from' || token.value.toLowerCase() === 'to'));
			if (!ok) return false;
			const isLast = k === words.length - 1;
			if (!isLast) {
				if (words[k + 1].type !== 'delim' || words[k + 1].value !== ',') return false;
				k += 1;
			}
		}
		return true;
	}

	function parseAtRule(atToken, mode) {
		const preludeRun = collect(['{', '}', ';']);
		const stop = preludeRun.stop;
		const prelude = preludeRun.tokens.filter(significant);
		stats.atRules += 1;
		const node = {
			type: 'at-rule',
			name: atToken.value.slice(1).toLowerCase(),
			prelude: prelude.length ? sourceText(preludeRun.tokens) : '',
			preludeTokens: prelude,
			line: atToken.line,
			column: atToken.column,
			nested: mode === 'declarations' || mode === 'keyframes',
			body: null,
		};

		if (!stop) {
			fail('unclosed_at_rule', atToken, `\`@${node.name}\` block is never closed with \`}\``);
			return node;
		}
		if (stop.type === 'delim' && stop.value === ';') return node;
		if (stop.type === 'delim' && stop.value === '}') {
			// The terminator belongs to the enclosing block, not to this
			// at-rule; give it back before reporting.
			index -= 1;
			fail('unclosed_at_rule', atToken, `\`@${node.name}\` has a prelude but no \`{\` block`);
			return node;
		}
		if (stop.type === 'eof') {
			fail('unclosed_at_rule', atToken, `\`@${node.name}\` is never closed`);
			return node;
		}

		const isKeyframes = KEYFRAME_AT_RULES.has(node.name);
		const isDeclarations = DECLARATION_AT_RULES.has(node.name);
		node.body = isKeyframes
			? parseBlock('keyframes')
			: isDeclarations
				? parseBlock('declarations')
				: parseBlock('rules');
		return node;
	}

	function sourceText(run) {
		const significantTokens = run.filter(significant);
		if (significantTokens.length === 0) return '';
		const first = significantTokens[0];
		const last = significantTokens[significantTokens.length - 1];
		return css.slice(first.start, last.end).trim();
	}

	/** Parse one block's contents. */
	function parseBlock(mode) {
		const nodes = [];
		while (index < tokens.length) {
			const token = peek();
			if (token.type === 'eof') {
				// Brace balance is answered by `checkBalance()` with the exact
				// position of the unclosed `{`; the tree parse just unwinds.
				return nodes;
			}
			if (token.type === 'delim' && token.value === '}') {
				// `next()` (not `index += 1`): `peek()` leaves `index` on the
				// last skipped whitespace, so advancing by one here would
				// hand the same `}` to the enclosing block.
				next();
				return nodes;
			}
			if (token.type === 'delim' && token.value === ';') {
				next();
				continue;
			}
			if (token.type === 'at-keyword') {
				nodes.push(parseAtRule(next(), mode));
				continue;
			}
			if (mode === 'keyframes') {
				const selectorRun = collect(['{', '}']);
				const stop = selectorRun.stop;
				if (!stop || (stop.type === 'delim' && stop.value !== '{')) {
					fail(
						'invalid_keyframe_selector',
						selectorRun.tokens.find(significant) ?? peek(),
						`@keyframes blocks accept only \`from\`, \`to\` or a <percentage>; got \`${sourceText(selectorRun.tokens) || '(nothing)'}\``,
					);
					if (!stop) return nodes;
					index -= 1;
					return nodes;
				}
				if (!keyframeSelector(selectorRun.tokens)) {
					fail(
						'invalid_keyframe_selector',
						selectorRun.tokens.find(significant) ?? stop,
						`@keyframes blocks accept only \`from\`, \`to\` or a <percentage>; got \`${sourceText(selectorRun.tokens)}\``,
					);
				}
				stats.rules += 1;
				nodes.push({
					type: 'keyframe',
					selector: sourceText(selectorRun.tokens),
					body: parseBlock('declarations'),
					line: selectorRun.tokens.find(significant)?.line ?? stop.line,
					column: selectorRun.tokens.find(significant)?.column ?? stop.column,
				});
				continue;
			}
			if (mode === 'rules') {
				if (token.type === 'delim' && token.value === '{') {
					fail('empty_selector', token, 'a rule needs a selector before `{`');
					next();
					continue;
				}
				const preludeRun = collect(['{', '}', ';']);
				const stop = preludeRun.stop;
				const preludeTokens = preludeRun.tokens.filter(significant);
				if (stop && stop.type === 'delim' && stop.value === ';') {
					// `;` is an empty statement and is ignored, but a run that
					// contains a `:` is a declaration in a place a declaration
					// cannot exist (the stylesheet top level, a `@media`, a
					// `@supports`): the parser discards the whole sheet.
					const colon = preludeRun.tokens.find(
						(item) => item.type === 'delim' && item.value === ':' && item.depth === 0,
					);
					if (colon) {
						fail(
							'declaration_at_top_level',
							colon,
							`\`${sourceText(preludeRun.tokens)}\` is a declaration, but this block accepts rules and at-rules only — a browser discards the entire sheet`,
						);
					}
					continue;
				}
				if (!stop || stop.type === 'eof' || preludeTokens.length === 0) {
					fail(
						'unclosed_rule',
						preludeTokens[0] ?? token,
						`rule \`${sourceText(preludeRun.tokens) || '(nothing)'}\` is never followed by a \`{\` block`,
					);
					if (!stop || stop.type === 'eof') return nodes;
					index -= 1;
					return nodes;
				}
				stats.rules += 1;
				nodes.push({
					type: 'rule',
					selector: sourceText(preludeRun.tokens),
					body: parseBlock('declarations'),
					line: token.line,
					column: token.column,
				});
				continue;
			}

			// `mode === 'declarations'`
			const run = collect([';', '{', '}']);
			const stop = run.stop;
			const significantRun = run.tokens.filter(significant);
			// A nested at-rule or qualified rule inside a declaration list
			// is CSS nesting; parse it rather than calling it invalid.
			if (stop && stop.type === 'delim' && stop.value === '{') {
				stats.rules += 1;
				nodes.push({
					type: 'rule',
					selector: sourceText(run.tokens),
					body: parseBlock('declarations'),
					nested: true,
					line: run.tokens.find(significant)?.line ?? stop.line,
					column: run.tokens.find(significant)?.column ?? stop.column,
				});
				continue;
			}
			if (!stop) return nodes;
			if (significantRun.length === 0) continue;
			if (stop.type === 'delim' && stop.value === '}') {
				// The last declaration in a block may omit its `;`; anything
				// else at this point is a run the parser cannot read.
				//
				// `collect()` has already consumed this `}`, and it is THIS
				// block's own terminator: a `declarations` block is only ever
				// entered after its `{` was consumed (a qualified rule, a
				// declaration at-rule, a keyframe block or a nested rule).
				// Handing it back made the enclosing `rules` / `declarations`
				// block read the rule's closing brace as its own terminator,
				// so one rule's missing `;` silently ended the parse of the
				// whole stylesheet — everything after it was never validated.
				const declaration = toDeclaration(significantRun, css);
				if (declaration) {
					stats.declarations += 1;
					nodes.push(declaration);
				} else {
					fail(
						'missing_colon',
						significantRun[0],
						`\`${sourceText(run.tokens)}\` is neither a declaration (\`property: value\`) nor a nested rule`,
					);
				}
				return nodes;
			}
			// `;`
			const declaration = toDeclaration(significantRun, css);
			if (declaration) {
				stats.declarations += 1;
				nodes.push(declaration);
				continue;
			}
			fail(
				'missing_colon',
				significantRun[0],
				`\`${sourceText(run.tokens)}\` is not a \`property: value\` declaration — a browser drops it silently`,
			);
		}
		return nodes;
	}

	if (atEnd()) return { nodes: [], diagnostics, stats };

	// Stylesheet top level: qualified rules and at-rules only. A
	// declaration here is reported by the `rules`-mode branch above, which
	// can name the offending text.
	const nodes = parseBlock('rules');
	if (!atEnd()) {
		// Fail closed: a top-level parse that returns before the end of the
		// token stream means the rest of the sheet was never validated, and
		// a report that counted only the prefix of the sheet would read as a
		// green run over CSS nobody checked.
		fail(
			'parse_truncated',
			peek(),
			'the top-level parse stopped before the end of the stylesheet; the remaining rules were never validated',
		);
	}
	return { nodes, diagnostics, stats };
}

/* ------------------------------------------------------------------ *
 * manifest loading
 * ------------------------------------------------------------------ */

function requireString(value, label, { min = 1 } = {}) {
	if (typeof value !== 'string' || value.trim().length < min) {
		throw new ManifestError(`${label} must be a string of at least ${min} character(s)`);
	}
	return value;
}

function requireArray(value, label, { min = 1 } = {}) {
	if (!Array.isArray(value) || value.length < min) {
		throw new ManifestError(
			`${label} must be an array with at least ${min} entr${min === 1 ? 'y' : 'ies'}`,
		);
	}
	return value;
}

const ALLOW_KINDS = new Set(['engine-specific', 'spec-extension', 'vendor-prefix']);

export function loadManifest(manifestPath) {
	let raw;
	try {
		raw = readFileSync(manifestPath, 'utf8');
	} catch (error) {
		throw new ManifestError(`cannot read the manifest at ${manifestPath}: ${error.message}`);
	}
	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch (error) {
		throw new ManifestError(`${manifestPath} is not valid JSON: ${error.message}`);
	}
	if (manifest.schema_version !== 1) {
		throw new ManifestError(
			`${manifestPath}: unsupported schema_version ${manifest.schema_version}`,
		);
	}
	requireString(manifest.policy?.name, 'policy.name');
	if (
		!Number.isInteger(manifest.policy?.min_declarations) ||
		manifest.policy.min_declarations < 0
	) {
		throw new ManifestError('policy.min_declarations must be an integer >= 0');
	}

	const surfaces = requireArray(manifest.surfaces, 'surfaces');
	const surfaceIds = new Set();
	for (const surface of surfaces) {
		const label = `surfaces[${surface?.id ?? '?'}]`;
		requireString(surface.id, `${label}: id`);
		if (surfaceIds.has(surface.id)) throw new ManifestError(`duplicate surface id: ${surface.id}`);
		surfaceIds.add(surface.id);
		if (!['panda-cssgen', 'files', 'inline'].includes(surface.kind)) {
			throw new ManifestError(`${label}: kind must be one of panda-cssgen, files, inline`);
		}
		requireString(surface.role, `${label}: role`);
		if (!Number.isInteger(surface.min_declarations) || surface.min_declarations < 0) {
			throw new ManifestError(`${label}: min_declarations must be an integer >= 0`);
		}
		if (surface.kind === 'files') {
			requireString(surface.root, `${label}: root`);
			requireArray(surface.extensions, `${label}: extensions`);
		}
	}

	// Vocabulary. A vocabulary that cannot describe the shipped CSS is a
	// manifest bug, not a reason to pass silently.
	const vocabulary = manifest.vocabulary ?? {};
	const properties = new Map();
	for (const [moduleUrl, names] of Object.entries(
		requireObject(vocabulary.properties, 'vocabulary.properties'),
	)) {
		requireString(moduleUrl, 'vocabulary.properties key');
		requireArray(names, `vocabulary.properties["${moduleUrl}"]`, { min: 1 });
		for (const name of names) {
			const property = requireString(
				name,
				`vocabulary.properties["${moduleUrl}"] entry`,
			).toLowerCase();
			if (property.startsWith('--')) {
				throw new ManifestError(
					`vocabulary.properties["${moduleUrl}"]: "${property}" is a custom property, which the CSS specification allows without registration`,
				);
			}
			if (properties.has(property)) {
				throw new ManifestError(`property "${property}" is listed by two spec modules`);
			}
			properties.set(property, moduleUrl);
		}
	}
	if (properties.size === 0) throw new ManifestError('vocabulary.properties must not be empty');

	const atRules = new Map();
	for (const [preludeKind, names] of Object.entries(
		requireObject(vocabulary.at_rules, 'vocabulary.at_rules'),
	)) {
		if (
			!['none', 'name', 'custom-property', 'string', 'optional-list', 'condition'].includes(
				preludeKind,
			)
		) {
			throw new ManifestError(`vocabulary.at_rules: unknown prelude kind "${preludeKind}"`);
		}
		for (const name of requireArray(names, `vocabulary.at_rules["${preludeKind}"]`)) {
			const atRule = requireString(
				name,
				`vocabulary.at_rules["${preludeKind}"] entry`,
			).toLowerCase();
			if (atRule.startsWith('@')) {
				throw new ManifestError(
					`vocabulary.at_rules: write "${atRule.slice(1)}" without the \`@\``,
				);
			}
			if (atRules.has(atRule)) throw new ManifestError(`at-rule \`@${atRule}\` is listed twice`);
			atRules.set(atRule, preludeKind);
		}
	}
	if (atRules.size === 0) throw new ManifestError('vocabulary.at_rules must not be empty');

	const functions = new Set(
		requireArray(vocabulary.functions, 'vocabulary.functions').map((name) =>
			requireString(name, 'vocabulary.functions entry').toLowerCase(),
		),
	);
	if (functions.size === 0) throw new ManifestError('vocabulary.functions must not be empty');

	const enums = new Map();
	for (const [property, values] of Object.entries(
		requireObject(vocabulary.enum_values, 'vocabulary.enum_values'),
	)) {
		const name = requireString(property, 'vocabulary.enum_values key').toLowerCase();
		const entry = requireArray(values, `vocabulary.enum_values["${name}"]`);
		const keywords = [];
		let multiKeyword = false;
		for (const item of entry) {
			if (item === '*') {
				multiKeyword = true;
				continue;
			}
			const keyword = requireString(item, `vocabulary.enum_values["${name}"] entry`).toLowerCase();
			if (!/^[a-z][a-z0-9-]*$/.test(keyword)) {
				throw new ManifestError(
					`vocabulary.enum_values["${name}"]: "${keyword}" is not a plain keyword; declare the grammar you mean instead`,
				);
			}
			keywords.push(keyword);
		}
		if (keywords.length === 0) {
			throw new ManifestError(`vocabulary.enum_values["${name}"] must list at least one keyword`);
		}
		if (!properties.has(name) && !allowPropertyNames(manifest).has(name)) {
			throw new ManifestError(
				`vocabulary.enum_values["${name}"] validates a property that is in neither the vocabulary nor the allowlist`,
			);
		}
		enums.set(name, { keywords, multiKeyword });
	}

	const allowlist = manifest.allowlist ?? {};
	const allowProperties = new Map();
	for (const entry of requireArray(allowlist.properties, 'allowlist.properties', { min: 0 })) {
		const label = `allowlist.properties[${entry?.id ?? '?'}]`;
		requireString(entry.id, `${label}: id`);
		if (allowProperties.has(entry.id))
			throw new ManifestError(`duplicate allowlist id: ${entry.id}`);
		const name = requireString(entry.name, `${label}: name`).toLowerCase();
		if (!ALLOW_KINDS.has(entry.kind)) {
			throw new ManifestError(`${label}: kind must be one of ${[...ALLOW_KINDS].join(', ')}`);
		}
		if (entry.kind !== 'vendor-prefix' && allowProperties.has(name)) {
			throw new ManifestError(`${label}: "${name}" is allowlisted twice`);
		}
		if (properties.has(name)) {
			throw new ManifestError(
				`${label}: "${name}" is already in the vocabulary; an allowlist entry may only waive a name the vocabulary does not define`,
			);
		}
		const reason = requireString(entry.reason, `${label}: reason`, { min: MIN_REASON_CHARS });
		requireString(entry.basis, `${label}: basis`);
		for (const surface of requireArray(entry.surfaces, `${label}: surfaces`)) {
			if (!surfaceIds.has(surface))
				throw new ManifestError(`${label}: unknown surface "${surface}"`);
		}
		if (entry.kind === 'vendor-prefix') {
			throw new ManifestError(
				`${label}: a vendor-prefixed property is waived by an allowlist.vendor_prefixes rule, not by name`,
			);
		}
		allowProperties.set(entry.id, { ...entry, name, reason, nameKey: name });
	}

	const vendorPrefixes = [];
	for (const entry of requireArray(allowlist.vendor_prefixes, 'allowlist.vendor_prefixes', {
		min: 0,
	})) {
		const label = `allowlist.vendor_prefixes[${entry?.id ?? '?'}]`;
		requireString(entry.id, `${label}: id`);
		if (vendorPrefixes.some((prefix) => prefix.id === entry.id)) {
			throw new ManifestError(`duplicate allowlist id: ${entry.id}`);
		}
		if (entry.require_known_unprefixed !== true) {
			throw new ManifestError(
				`${label}: require_known_unprefixed must be true — a prefix may not waive a property the vocabulary does not define`,
			);
		}
		const prefixes = requireArray(entry.prefixes, `${label}: prefixes`).map((prefix, position) => {
			if (!/^-[a-z]+-$/.test(prefix)) {
				throw new ManifestError(
					`${label}.prefixes[${position}]: "${prefix}" is not a vendor prefix such as "-webkit-"`,
				);
			}
			return prefix;
		});
		for (const surface of requireArray(entry.surfaces, `${label}: surfaces`)) {
			if (!surfaceIds.has(surface))
				throw new ManifestError(`${label}: unknown surface "${surface}"`);
		}
		requireString(entry.reason, `${label}: reason`, { min: MIN_REASON_CHARS });
		requireString(entry.basis, `${label}: basis`);
		vendorPrefixes.push({ ...entry, prefixes });
	}

	const allowFunctions = new Map();
	for (const entry of requireArray(allowlist.functions, 'allowlist.functions', { min: 0 })) {
		const label = `allowlist.functions[${entry?.id ?? '?'}]`;
		requireString(entry.id, `${label}: id`);
		if (allowFunctions.has(entry.id))
			throw new ManifestError(`duplicate allowlist id: ${entry.id}`);
		const name = requireString(entry.name, `${label}: name`).toLowerCase();
		if (functions.has(name)) {
			throw new ManifestError(`${label}: "${name}" is already in vocabulary.functions`);
		}
		for (const surface of requireArray(entry.surfaces, `${label}: surfaces`)) {
			if (!surfaceIds.has(surface))
				throw new ManifestError(`${label}: unknown surface "${surface}"`);
		}
		requireString(entry.reason, `${label}: reason`, { min: MIN_REASON_CHARS });
		requireString(entry.basis, `${label}: basis`);
		allowFunctions.set(entry.id, { ...entry, name });
	}

	const allowAtRules = new Map();
	for (const entry of requireArray(allowlist.at_rules, 'allowlist.at_rules', { min: 0 })) {
		const label = `allowlist.at_rules[${entry?.id ?? '?'}]`;
		requireString(entry.id, `${label}: id`);
		if (allowAtRules.has(entry.id)) throw new ManifestError(`duplicate allowlist id: ${entry.id}`);
		const name = requireString(entry.name, `${label}: name`).toLowerCase().replace(/^@/, '');
		if (atRules.has(name)) {
			throw new ManifestError(`${label}: \`@${name}\` is already in vocabulary.at_rules`);
		}
		for (const surface of requireArray(entry.surfaces, `${label}: surfaces`)) {
			if (!surfaceIds.has(surface))
				throw new ManifestError(`${label}: unknown surface "${surface}"`);
		}
		requireString(entry.reason, `${label}: reason`, { min: MIN_REASON_CHARS });
		requireString(entry.basis, `${label}: basis`);
		allowAtRules.set(entry.id, { ...entry, name });
	}

	return {
		...manifest,
		__index: {
			properties,
			atRules,
			functions,
			enums,
			allowProperties,
			vendorPrefixes,
			allowFunctions,
			allowAtRules,
			surfaceIds,
		},
	};
}

function requireObject(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ManifestError(`${label} must be an object`);
	}
	return value;
}

/** Names the allowlist waives, used while the manifest is being validated. */
function allowPropertyNames(manifest) {
	const names = new Set();
	for (const entry of manifest?.allowlist?.properties ?? []) {
		if (typeof entry?.name === 'string') names.add(entry.name.toLowerCase());
	}
	return names;
}

/* ------------------------------------------------------------------ *
 * surface collection
 * ------------------------------------------------------------------ */

function walk(dir, out = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.tmp') continue;
			walk(path, out);
			continue;
		}
		if (entry.isFile()) out.push(path);
	}
	return out;
}

const toPosix = (path) => path.split(sep).join('/');

/**
 * Generate the CSS Panda ships with `panda cssgen` and return it.
 *
 * The artifact goes to `.tmp/` (gitignored) so the gate writes no
 * tracked file; AGENTS.md §9 owns `.tmp/` as the ephemeral artefact
 * directory. A generator failure is an error, never an empty artifact
 * that later reads as "nothing to validate".
 */
export function generatePandaCss(root, artifactPath = DEFAULT_ARTIFACT) {
	// `panda cssgen --outfile <target>` OVERWRITES the target. The gate may
	// only ever write inside `.tmp/` (AGENTS.md §9, ephemeral artefacts), so
	// a typo in `--artifact` can never clobber a build output.
	if (!artifactPath.startsWith('.tmp/')) {
		throw new ManifestError(
			`refusing to generate into ${artifactPath}: the generated artifact may only be written inside .tmp/ (the default is ${DEFAULT_ARTIFACT}); pass \`--no-generate\` to validate an existing stylesheet instead`,
		);
	}
	const bin = ['node_modules/.bin/panda', 'node_modules/.bin/panda.cmd'].map((path) =>
		join(root, path),
	);
	const executable = bin.find((path) => statSync(path, { throwIfNoEntry: false }));
	const target = join(root, artifactPath);
	try {
		execFileSync(executable ?? 'panda', ['cssgen', '--outfile', target, '--silent'], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 180_000,
			env: { ...process.env, CI: process.env.CI ?? '1' },
		});
	} catch (error) {
		const detail = String(error?.stderr ?? error?.message ?? error)
			.trim()
			.split('\n')
			.slice(-4)
			.join(' | ');
		throw new ManifestError(
			`panda cssgen could not produce the generated artifact (${artifactPath}): ${detail}. Run \`pnpm run prepare\` (panda codegen) first — the gate validates what the build serves, and a gate that cannot see the artifact must fail.`,
		);
	}
	if (!statSync(target, { throwIfNoEntry: false })) {
		throw new ManifestError(`panda cssgen reported success but ${artifactPath} does not exist`);
	}
	return readFileSync(target, 'utf8');
}

export function collectSources({
	root,
	manifest,
	inlineSources = null,
	artifactPath = null,
	generate = true,
}) {
	if (inlineSources) return inlineSources.map((source) => ({ ...source }));

	const sources = [];
	const owned = new Set();
	const surfaceStats = new Map();
	for (const surface of manifest.surfaces) {
		const entry = { id: surface.id, declarations: 0, files: 0 };
		surfaceStats.set(surface.id, entry);
		if (surface.kind === 'panda-cssgen') {
			// `--artifact <path>` means "validate this stylesheet", so it is
			// always read. Generation happens only into the default `.tmp/`
			// artifact, and only when the caller asked for it — a gate that
			// regenerates the file it was asked to inspect both destroys the
			// build output and reports a verdict on something it just wrote.
			const explicitArtifact = artifactPath !== null && artifactPath !== undefined;
			const target = explicitArtifact ? artifactPath : DEFAULT_ARTIFACT;
			// `resolve`, not `join`: an operator who follows the documented
			// `--artifact dist/client/assets/*.css` from another directory
			// passes an absolute path, and `join` would treat it as relative
			// to the repository root.
			const absoluteTarget = resolve(root, target);
			const css =
				generate && !explicitArtifact
					? generatePandaCss(root, DEFAULT_ARTIFACT)
					: readFileSync(absoluteTarget, 'utf8');
			sources.push({
				surface: surface.id,
				path: target,
				label: explicitArtifact
					? `stylesheet read from ${target}`
					: `Panda generated CSS (\`panda cssgen\` → ${target})`,
				css,
				generated: !explicitArtifact,
			});
			entry.files = 1;
			continue;
		}
		if (surface.kind === 'inline') {
			sources.push({
				surface: surface.id,
				path: `${surface.id}.css`,
				label: surface.role,
				css: readFileSync(join(root, surface.path), 'utf8'),
			});
			entry.files = 1;
			continue;
		}
		for (const absPath of walk(join(root, surface.root))) {
			const rel = toPosix(relative(root, absPath));
			if (!surface.extensions.some((extension) => rel.endsWith(extension))) continue;
			if (owned.has(rel)) {
				entry.duplicate = [...(entry.duplicate ?? []), rel];
				continue;
			}
			owned.add(rel);
			sources.push({
				surface: surface.id,
				path: rel,
				label: rel,
				css: readFileSync(absPath, 'utf8'),
			});
			entry.files += 1;
		}
	}

	// Coverage: a stylesheet under the coverage root that no surface owns
	// would never be parsed, which is exactly how an unimplemented or
	// newly added sheet becomes a silent pass.
	const coverageRoot = manifest.coverage?.root;
	const uncovered = [];
	if (coverageRoot) {
		const extensions = manifest.coverage?.extensions ?? ['.css'];
		for (const absPath of walk(join(root, coverageRoot))) {
			const rel = toPosix(relative(root, absPath));
			if (!extensions.some((extension) => rel.endsWith(extension))) continue;
			if (!owned.has(rel)) uncovered.push(rel);
		}
	}
	return { sources, uncovered, surfaceStats };
}

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

/** CSS-wide keywords: accepted for every property without inspection. */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/** Properties that only exist inside `@font-face`. */
const FONT_FACE_DESCRIPTORS = new Set([
	'ascent-override',
	'descent-override',
	'line-gap-override',
	'size-adjust',
	'src',
	'unicode-range',
]);

const formatList = (items, render = (item) => item) => {
	const shown = items.slice(0, MAX_LISTED).map(render);
	if (items.length > MAX_LISTED) shown.push(`… +${items.length - MAX_LISTED} more`);
	return shown.join('\n    ');
};

/** Walk the parse tree, tracking the enclosing at-rule stack. */
function walkNodes(nodes, visit, stack = []) {
	for (const node of nodes) {
		visit(node, stack);
		if (node.type === 'at-rule' && node.body) walkNodes(node.body, visit, [...stack, node.name]);
		if ((node.type === 'rule' || node.type === 'keyframe') && node.body)
			walkNodes(node.body, visit, stack);
	}
}

function checkPrelude(manifest, node, error) {
	const kind = manifest.__index.atRules.get(node.name);
	const tokens = node.preludeTokens ?? [];
	const words = tokens
		.filter((token) => token.type === 'ident')
		.map((token) => token.value.toLowerCase());
	switch (kind) {
		case 'none':
			if (tokens.length > 0) {
				error(
					'nonempty_at_rule_prelude',
					node,
					`\`@${node.name}\` takes no prelude; \`${node.prelude}\` makes the whole block invalid and the browser drops it`,
				);
			}
			return;
		case 'name':
			if (tokens.length !== 1 || (tokens[0].type !== 'ident' && tokens[0].type !== 'bad-string')) {
				error(
					'invalid_at_rule_prelude',
					node,
					`\`@${node.name}\` takes one name; got \`${node.prelude}\``,
				);
			}
			return;
		case 'custom-property':
			if (tokens.length !== 1 || tokens[0].type !== 'ident' || !tokens[0].value.startsWith('--')) {
				error(
					'invalid_at_rule_prelude',
					node,
					`\`@${node.name}\` must be followed by one custom property name; got \`${node.prelude}\``,
				);
			}
			return;
		case 'string':
			// `@import "a.css"` tokenizes as a string, but `@import url(a.css)`
			// and `@import url("a.css")` are equally valid and tokenize as a
			// url-token and a `url(` function respectively.
			if (tokens.length === 0 || !['bad-string', 'url', 'function'].includes(tokens[0].type)) {
				error(
					'invalid_at_rule_prelude',
					node,
					`\`@${node.name}\` must start with a string or a \`url()\`; got \`${node.prelude}\``,
				);
			}
			return;
		case 'condition': {
			// `@supports selector(:has(a))` states its condition as a
			// function, so the `(` never appears as a bare delim.
			const hasParens = tokens.some(
				(token) =>
					(token.type === 'delim' && token.value === '(') ||
					token.type === 'function' ||
					token.type === 'url',
			);
			if (!hasParens) {
				error(
					'invalid_at_rule_prelude',
					node,
					`\`@${node.name}\` must state a condition in parentheses; got \`${node.prelude}\``,
				);
			}
			return;
		}
		default: {
			// 'optional-list', and any prelude kind the manifest declares.
			if (tokens.length === 0) return;
			// A media / container query list may not contain a top-level
			// `:` — that is a declaration, not a query, and is the most
			// common way a media query is written wrong.
			let depth = 0;
			for (const token of tokens) {
				if (token.type === 'function') depth += 1;
				else if (token.type === 'delim' && token.value === '(') depth += 1;
				else if (token.type === 'delim' && token.value === ')') depth -= 1;
				else if (depth === 0 && token.type === 'delim' && token.value === ':') {
					error(
						'invalid_at_rule_prelude',
						node,
						`\`@${node.name} ${node.prelude}\` looks like a declaration; a query must be written \`(${words[0] ?? 'feature'}: value)\``,
					);
					return;
				}
			}
		}
	}
}

function checkDeclaration(manifest, node, stack, state, error) {
	const raw = node.property;
	const property = raw.toLowerCase();
	const custom = raw.startsWith('--');
	const inFontFace = stack[stack.length - 1] === 'font-face';

	// --- property vocabulary -------------------------------------------
	if (!custom) {
		if (FONT_FACE_DESCRIPTORS.has(property) && !inFontFace) {
			error(
				'descriptor_outside_font_face',
				node,
				`\`${raw}\` only exists inside \`@font-face\`; declared here the browser drops the declaration silently`,
			);
		}
		if (
			inFontFace &&
			!FONT_FACE_DESCRIPTORS.has(property) &&
			manifest.__index.properties.has(property)
		) {
			if (!isFontFaceName(property)) {
				error(
					'property_not_allowed_in_font_face',
					node,
					`\`${raw}\` is not a \`@font-face\` descriptor; a face description ignores it`,
				);
			}
		}

		if (!manifest.__index.properties.has(property)) {
			// An explicit by-name waiver outranks the prefix rule: an
			// engine-only property (`-webkit-font-smoothing`) has no
			// unprefixed counterpart to point at.
			const waiver = [...manifest.__index.allowProperties.values()].find(
				(entry) => entry.name === property && entry.surfaces.includes(node.surface),
			);
			const prefixRule = manifest.__index.vendorPrefixes.find(
				(rule) =>
					rule.surfaces.includes(node.surface) &&
					rule.prefixes.some((prefix) => property.startsWith(prefix)),
			);
			const stripped = prefixRule
				? property.slice(prefixRule.prefixes.find((p) => property.startsWith(p)).length)
				: null;
			if (waiver) {
				state.allowUses.push({ waiver, node });
			} else if (prefixRule && stripped && manifest.__index.properties.has(stripped)) {
				state.prefixUses.push({ property: raw, base: stripped, rule: prefixRule.id, node });
			} else if (prefixRule) {
				error(
					'vendor_prefix_unresolved',
					node,
					`\`${raw}\` is waived by the \`${prefixRule.id}\` prefix rule, but \`${stripped}\` is not in the vocabulary — a prefix may not introduce a property no specification defines`,
				);
			} else {
				error(
					'unknown_property',
					node,
					`\`${raw}\` is not a property any specification in the vocabulary defines — the browser drops it, so this rule silently does less than it reads`,
				);
			}
		}
	} else {
		state.customProperties.add(raw);
	}

	// --- value functions ----------------------------------------------
	for (const token of node.valueTokens ?? []) {
		if (token.type !== 'function') continue;
		const name = token.value.toLowerCase();
		if (manifest.__index.functions.has(name)) {
			state.functionUses.set(name, (state.functionUses.get(name) ?? 0) + 1);
			continue;
		}
		const waiver = [...manifest.__index.allowFunctions.values()].find(
			(entry) => entry.name === name && entry.surfaces.includes(node.surface),
		);
		if (waiver) {
			state.allowUses.push({ waiver, node });
			continue;
		}
		error(
			'unknown_function',
			node,
			`\`${name}()\` is not a function the vocabulary defines; an unknown function makes the whole declaration invalid at parse time`,
		);
	}

	// --- enumerated values --------------------------------------------
	const enumSpec = manifest.__index.enums.get(property);
	if (!enumSpec || custom) return;
	const value = node.value;
	const lower = value.toLowerCase();
	if (!value || /\bvar\(/i.test(value)) return; // not statically knowable
	const words = lower.split(/[\s,]+/).filter(Boolean);
	if (words.every((word) => CSS_WIDE_KEYWORDS.has(word))) return;
	const unknown = words.filter((word) => !enumSpec.keywords.includes(word));
	if (unknown.length === 0) {
		if (enumSpec.multiKeyword && new Set(words).size !== words.length) {
			error('invalid_enum_value', node, `\`${property}: ${value}\` repeats a keyword`);
		}
		return;
	}
	error(
		'invalid_enum_value',
		node,
		`\`${property}: ${value}\` is not one of the values the specification defines for this property (${enumSpec.keywords.join(' | ')}); an unknown keyword is dropped at parse time`,
	);
}

function isFontFaceName(property) {
	return (
		property === 'font-family' ||
		property === 'font-weight' ||
		property === 'font-style' ||
		property === 'font-stretch' ||
		property === 'font-display' ||
		property === 'font-variation-settings' ||
		property === 'font-feature-settings'
	);
}

/**
 * Validate one surface's CSS.
 *
 * Value functions are recovered by re-tokenizing and matching on the
 * declaration's line: the parser records positions, and a value can
 * only contain one function of a given name per line in practice — but
 * to stay exact the value slice boundaries are used instead of lines
 * when available.
 */
export function validateCss({ manifest, surfaceId, path, label, css, generated = false }) {
	const errors = [];
	const warnings = [];
	const error = (rule, node, message) =>
		errors.push({ rule, message, line: node.line, column: node.column, path });

	const parsed = parseStylesheet(css);
	for (const diagnostic of parsed.diagnostics) {
		errors.push({
			rule: diagnostic.rule,
			message: diagnostic.message,
			line: diagnostic.line,
			column: diagnostic.column,
			path,
		});
	}

	// Re-tokenize to recover the function tokens inside each declaration
	// value. The parser keeps positions, so this is a pure lookup rather
	// than a second, looser scan.
	const { tokens } = tokenize(css);
	const functionByRange = tokens.filter((token) => token.type === 'function');

	const state = {
		prefixUses: [],
		allowUses: [],
		customProperties: new Set(),
		functionUses: new Map(),
	};

	walkNodes(parsed.nodes, (node, stack) => {
		if (node.type === 'at-rule') {
			const known = manifest.__index.atRules.get(node.name);
			if (!known) {
				const waiver = [...manifest.__index.allowAtRules.values()].find(
					(entry) => entry.name === node.name && entry.surfaces.includes(surfaceId),
				);
				// The vendor-prefix rule covers at-rules exactly as it covers
				// properties: a prefixed spelling is accepted only when the
				// unprefixed at-rule is declared, so `-webkit-keyframes` is
				// read as `@keyframes` rather than as an at-rule no
				// specification defines.
				const prefixRule = manifest.__index.vendorPrefixes.find(
					(rule) =>
						rule.surfaces.includes(surfaceId) &&
						rule.prefixes.some((prefix) => node.name.startsWith(prefix)),
				);
				const stripped = prefixRule
					? node.name.slice(
							prefixRule.prefixes.find((prefix) => node.name.startsWith(prefix)).length,
						)
					: null;
				if (waiver) {
					state.allowUses.push({ waiver, node });
				} else if (prefixRule && stripped && manifest.__index.atRules.has(stripped)) {
					state.prefixUses.push({
						property: `@${node.name}`,
						base: `@${stripped}`,
						rule: prefixRule.id,
						node,
					});
				} else if (prefixRule) {
					error(
						'vendor_prefix_unresolved',
						node,
						`\`@${node.name}\` is waived by the \`${prefixRule.id}\` prefix rule, but \`@${stripped}\` is not in the vocabulary — a prefix may not introduce an at-rule no specification defines`,
					);
				} else {
					error(
						'unknown_at_rule',
						node,
						`\`@${node.name}\` is not an at-rule this project declares; an unknown at-rule is discarded with its block`,
					);
				}
			} else {
				checkPrelude(manifest, node, error);
			}
			return;
		}
		if (node.type !== 'declaration') return;

		const valueStart = node.valueStart;
		node.valueTokens = valueStart
			? functionByRange.filter(
					(token) => token.start >= valueStart.start && token.end <= valueStart.end,
				)
			: [];
		node.surface = surfaceId;
		checkDeclaration(manifest, node, stack, state, error);
	});

	return {
		surface: surfaceId,
		path,
		label,
		generated,
		css,
		nodes: parsed.nodes,
		errors,
		warnings,
		stats: {
			...parsed.stats,
			customProperties: state.customProperties.size,
			functions: state.functionUses.size,
			bytes: Buffer.byteLength(css, 'utf8'),
		},
		customProperties: state.customProperties,
		functionUses: state.functionUses,
		prefixUses: state.prefixUses,
		allowUses: state.allowUses,
	};
}

/* ------------------------------------------------------------------ *
 * orchestration
 * ------------------------------------------------------------------ */

export function runCheck({
	root = REPO_ROOT,
	manifestPath = DEFAULT_MANIFEST,
	inlineSources = null,
	artifactPath = null,
	generate = true,
} = {}) {
	const manifest = loadManifest(join(root, manifestPath));
	const collected = collectSources({ root, manifest, inlineSources, artifactPath, generate });
	const sources = Array.isArray(collected) ? collected : collected.sources;
	const uncovered = Array.isArray(collected) ? [] : (collected.uncovered ?? []);

	const results = sources.map((source) =>
		validateCss({
			manifest,
			surfaceId: source.surface,
			path: source.path,
			label: source.label,
			css: source.css,
			generated: source.generated === true,
		}),
	);

	const errors = [];
	const warnings = [];
	for (const result of results) {
		for (const entry of result.errors) errors.push({ ...entry, surface: result.surface });
		for (const entry of result.warnings) warnings.push({ ...entry, surface: result.surface });
	}
	const error = (rule, message) => errors.push({ rule, message });
	const warn = (rule, message) => warnings.push({ rule, message });

	// `--artifact <path>` narrows the run to one stylesheet the operator
	// named. The scope guards below assert things about the declared surface
	// *set* (how many declarations the whole surface yields, whether a waiver
	// is still in use anywhere), which a single file cannot satisfy — and
	// failing them would make the documented "validate a built stylesheet"
	// command unusable while proving nothing about that stylesheet. Every
	// per-stylesheet check still runs.
	const scoped = artifactPath !== null && artifactPath !== undefined;
	const notes = scoped
		? [
				`--artifact ${artifactPath}: scope guards (surface_empty / vocabulary_underfloor / allow_unused) describe the declared surface set and are skipped for a single named stylesheet; every content check still ran`,
			]
		: [];

	// --- no silent pass -------------------------------------------------
	const surfaceRows = manifest.surfaces.map((surface) => {
		const own = results.filter((result) => result.surface === surface.id);
		const declarations = own.reduce((sum, result) => sum + result.stats.declarations, 0);
		const files = own.length;
		if (!scoped && declarations < surface.min_declarations) {
			error(
				'surface_empty',
				`surface "${surface.id}" yielded ${declarations} declaration(s) from ${files} file(s) but declares min_declarations ${surface.min_declarations}; a surface that validates nothing must never pass`,
			);
		}
		return {
			id: surface.id,
			kind: surface.kind,
			role: surface.role,
			files,
			declarations,
			bytes: own.reduce((sum, result) => sum + result.stats.bytes, 0),
			errors: own.reduce((sum, result) => sum + result.errors.length, 0),
		};
	});

	if (uncovered.length > 0) {
		error(
			'surface_uncovered',
			`${uncovered.length} stylesheet(s) under ${manifest.coverage.root} are owned by no surface and would never be parsed:\n    ${formatList(uncovered)}\n    add the file to a surface, or delete it.`,
		);
	}

	const totalDeclarations = results.reduce((sum, result) => sum + result.stats.declarations, 0);
	if (!scoped && totalDeclarations < manifest.policy.min_declarations) {
		error(
			'vocabulary_underfloor',
			`the surfaces yielded ${totalDeclarations} declaration(s) but policy.min_declarations is ${manifest.policy.min_declarations}; a parser that stops seeing declarations must fail, not pass quietly`,
		);
	}

	// --- allowlist / prefix accounting ----------------------------------
	const usesById = new Map();
	for (const result of results) {
		for (const use of result.prefixUses) {
			const list = usesById.get(use.rule) ?? [];
			list.push({
				kind: 'vendor-prefix',
				property: use.property,
				base: use.base,
				surface: result.surface,
				line: use.node.line,
			});
			usesById.set(use.rule, list);
		}
		for (const use of result.allowUses) {
			const list = usesById.get(use.waiver.id) ?? [];
			list.push({
				kind: use.waiver.kind,
				name: use.waiver.name ?? use.waiver.id,
				surface: result.surface,
				line: use.node.line,
			});
			usesById.set(use.waiver.id, list);
		}
	}

	const allowRows = [
		...manifest.__index.vendorPrefixes.map((entry) => ({ ...entry, category: 'vendor_prefixes' })),
		...[...manifest.__index.allowProperties.values()].map((entry) => ({
			...entry,
			category: 'properties',
		})),
		...[...manifest.__index.allowFunctions.values()].map((entry) => ({
			...entry,
			category: 'functions',
		})),
		...[...manifest.__index.allowAtRules.values()].map((entry) => ({
			...entry,
			category: 'at_rules',
		})),
	];
	for (const entry of allowRows) {
		const uses = usesById.get(entry.id) ?? [];
		entry.uses = uses;
		entry.name = entry.name ?? entry.prefixes.join(' ');
		if (uses.length === 0) {
			if (scoped) continue;
			error(
				'allow_unused',
				`allowlist.${entry.category} "${entry.id}" waives nothing in the current CSS; a stale waiver is a hole nobody re-reviews, not a false-positive allowance`,
			);
		}
	}

	const vocabulary = {
		properties: manifest.__index.properties.size,
		atRules: manifest.__index.atRules.size,
		functions: manifest.__index.functions.size,
		enumValues: manifest.__index.enums.size,
		modules: Object.keys(manifest.vocabulary.properties).length,
	};
	if (vocabulary.properties === 0)
		error('vocabulary_empty', 'the vocabulary defines no properties');

	return {
		ok: errors.length === 0,
		errors,
		warnings,
		notes,
		results,
		surfaceRows,
		allowRows,
		vocabulary,
		stats: {
			surfaces: manifest.surfaces.length,
			files: results.length,
			declarations: totalDeclarations,
			rules: results.reduce((sum, result) => sum + result.stats.rules, 0),
			atRules: results.reduce((sum, result) => sum + result.stats.atRules, 0),
			customProperties: new Set(results.flatMap((result) => [...(result.customProperties ?? [])]))
				.size,
			uncovered: uncovered.length,
			allowlisted: allowRows.reduce((sum, row) => sum + row.uses.length, 0),
		},
		manifest,
		root,
	};
}

/* ------------------------------------------------------------------ *
 * output
 * ------------------------------------------------------------------ */

export function formatReport(result) {
	const lines = [];
	const { manifest, stats, vocabulary } = result;
	lines.push('my-web-2026 — CSS syntax / vocabulary gate (Issue #413)');
	lines.push(
		`  profile     ${manifest.policy.name} (min_declarations ${manifest.policy.min_declarations})`,
	);
	lines.push(
		`  surfaces    ${stats.surfaces} declared · ${stats.files} stylesheet(s) · ${stats.declarations} declarations · ${stats.rules} rules · ${stats.atRules} at-rules`,
	);
	lines.push(
		`  vocabulary  ${vocabulary.properties} properties from ${vocabulary.modules} spec module(s) · ${vocabulary.atRules} at-rules · ${vocabulary.functions} functions · ${vocabulary.enumValues} enumerated value sets`,
	);
	lines.push(
		`  allowlist   ${result.allowRows.length} declared entries covering ${stats.allowlisted} occurrence(s)`,
	);
	lines.push('');

	lines.push('surfaces');
	for (const row of result.surfaceRows) {
		lines.push(
			`  ${row.errors === 0 ? 'ok  ' : 'FAIL'} ${row.id.padEnd(18)} ${String(row.files).padStart(2)} file(s) · ${String(row.declarations).padStart(4)} declarations · ${(row.bytes / 1024).toFixed(1)} KiB`,
		);
		lines.push(`         ${row.role}`);
	}
	lines.push('');

	lines.push('allowlist (vendor prefixes and specification-permitted extensions)');
	for (const row of result.allowRows) {
		lines.push(
			`  ${row.uses.length === 0 ? 'FAIL' : ' ok '} ${row.id.padEnd(30)} ${String(row.uses.length).padStart(3)} use(s) · ${row.kind ?? row.category}`,
		);
		for (const use of row.uses.slice(0, 4)) {
			lines.push(
				`         ${use.property ?? use.name}${use.base ? ` → ${use.base} (spec-defined)` : ''} · ${use.surface}${use.line ? `:${use.line}` : ''}`,
			);
		}
		if (row.uses.length > 4) lines.push(`         … +${row.uses.length - 4} more`);
	}
	lines.push('');

	if (result.warnings.length > 0) {
		lines.push(`warnings (${result.warnings.length})`);
		for (const warning of result.warnings)
			lines.push(`  WARN  ${warning.rule}: ${warning.message}`);
		lines.push('');
	}

	if ((result.notes ?? []).length > 0) {
		for (const note of result.notes) lines.push(`note: ${note}`);
		lines.push('');
	}

	if (result.errors.length > 0) {
		lines.push(`errors (${result.errors.length})`);
		for (const entry of result.errors) {
			const where = entry.path
				? `${entry.path}${entry.line ? `:${entry.line}:${entry.column ?? 1}` : ''}`
				: 'gate';
			lines.push(`  FAIL  ${where} — ${entry.rule}: ${entry.message}`);
		}
	}
	return lines.join('\n');
}

function main(argv) {
	const asJson = argv.includes('--json');
	const noGenerate = argv.includes('--no-generate');
	const artifactIndex = argv.indexOf('--artifact');
	const artifactPath = artifactIndex === -1 ? null : argv[artifactIndex + 1];
	if (artifactIndex !== -1 && !artifactPath) {
		process.stderr.write('--artifact requires a path to a CSS artifact\n');
		return 2;
	}
	if (artifactIndex !== -1 && noGenerate) {
		// `--no-generate` is already the behaviour of `--artifact`; saying
		// both usually means the reader expected `--artifact` to write.
		process.stderr.write(
			'note: --artifact never writes; --no-generate is implied by --artifact and is ignored\n',
		);
	}

	let result;
	try {
		result = runCheck({ artifactPath, generate: !noGenerate });
	} catch (error) {
		if (error instanceof ManifestError) {
			process.stderr.write(`css-standards manifest or artifact is unusable: ${error.message}\n`);
			return 2;
		}
		throw error;
	}

	if (asJson) {
		process.stdout.write(
			`${JSON.stringify(
				{
					ok: result.ok,
					stats: result.stats,
					vocabulary: result.vocabulary,
					surfaces: result.surfaceRows,
					allowlist: result.allowRows.map((row) => ({
						id: row.id,
						kind: row.kind,
						uses: row.uses.length,
					})),
					errors: result.errors,
					warnings: result.warnings,
					notes: result.notes ?? [],
				},
				null,
				2,
			)}\n`,
		);
	} else {
		const report = formatReport(result);
		if (result.errors.length > 0) process.stderr.write(`${report}\n`);
		else process.stdout.write(`${report}\n`);
	}

	return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main(process.argv.slice(2)));
}
