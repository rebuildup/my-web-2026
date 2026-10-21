/**
 * Kanata configuration parser — bounded and structure-preserving.
 *
 * Scope: exactly the subset the public page renders. It is NOT a
 * general Kanata implementation and it never executes a form. A form
 * it does not recognize becomes `unknown` with its raw text, so a
 * future construct is visible in the UI rather than silently
 * disappearing from a layer.
 *
 * The parser is deliberately tiny and has no I/O. The sync script
 * uses it before writing a committed source (so a corrupt fetch is
 * never committed) and the page uses it after import (so the
 * committed bytes, not a build artefact, are the thing being shown).
 *
 * Bounds:
 *   - source length is capped before tokenizing,
 *   - alias resolution is depth / cycle limited,
 *   - `defsrc` and `deflayer` arity must agree.
 */

import type { KeyboardAction, KeyboardStep } from './types';

/** Maximum source size the parser will accept (the real files are ~9 KB). */
export const MAX_KANATA_SOURCE_BYTES = 64 * 1024;

/** Maximum alias resolution depth. */
const MAX_ALIAS_DEPTH = 12;

/** Maximum token count; a pathological file becomes a parse failure. */
const MAX_TOKENS = 20_000;

export type KanataExpr = string | KanataExpr[];

export type KanataParseCode =
	| 'too-large'
	| 'unbalanced'
	| 'unexpected-close'
	| 'missing-defsrc'
	| 'missing-layers'
	| 'empty-defsrc'
	| 'layer-arity'
	| 'layer-name'
	| 'alias-form';

export class KanataParseError extends Error {
	readonly code: KanataParseCode;

	constructor(code: KanataParseCode, message: string) {
		super(message);
		this.name = 'KanataParseError';
		this.code = code;
	}
}

export interface ParsedKanataLayer {
	readonly id: string;
	readonly keys: readonly KeyboardAction[];
}

export interface ParsedKanata {
	readonly defsrc: readonly string[];
	readonly layers: readonly ParsedKanataLayer[];
}

/** Serialize an expression back to Kanata surface syntax. */
export function serializeExpr(expr: KanataExpr): string {
	return typeof expr === 'string' ? expr : `(${expr.map(serializeExpr).join(' ')})`;
}

/**
 * Tokenize and nest s-expressions.
 *
 * Comments (`;;` to end of line, `#| … |#` blocks, nestable) are
 * removed. Strings keep their content without quotes; Kanata key
 * names do not need escapes, but `\"` and `\\` are accepted.
 */
export function parseExpressions(source: string): KanataExpr[] {
	if (source.length > MAX_KANATA_SOURCE_BYTES) {
		throw new KanataParseError('too-large', 'Kanata source exceeds the size cap');
	}
	const root: KanataExpr[] = [];
	const stack: KanataExpr[][] = [root];
	let tokens = 0;
	let index = 0;

	const pushAtom = (atom: string) => {
		if (atom.length === 0) return;
		tokens += 1;
		if (tokens > MAX_TOKENS) {
			throw new KanataParseError('too-large', 'Kanata source exceeds the token cap');
		}
		stack[stack.length - 1]?.push(atom);
	};

	while (index < source.length) {
		const char = source[index];

		if (char === ';' && source[index + 1] === ';') {
			const newline = source.indexOf('\n', index + 2);
			index = newline === -1 ? source.length : newline + 1;
			continue;
		}

		if (char === '#' && source[index + 1] === '|') {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < source.length && depth > 0) {
				if (source[cursor] === '#' && source[cursor + 1] === '|') {
					depth += 1;
					cursor += 2;
				} else if (source[cursor] === '|' && source[cursor + 1] === '#') {
					depth -= 1;
					cursor += 2;
				} else {
					cursor += 1;
				}
			}
			if (depth !== 0) {
				throw new KanataParseError('unbalanced', 'Unterminated block comment');
			}
			index = cursor;
			continue;
		}

		if (char === '(') {
			const list: KanataExpr[] = [];
			stack[stack.length - 1]?.push(list);
			stack.push(list);
			index += 1;
			continue;
		}

		if (char === ')') {
			if (stack.length === 1) {
				throw new KanataParseError('unexpected-close', 'Unexpected closing parenthesis');
			}
			stack.pop();
			index += 1;
			continue;
		}

		if (char === '"') {
			let value = '';
			let cursor = index + 1;
			while (cursor < source.length && source[cursor] !== '"') {
				if (source[cursor] === '\\' && cursor + 1 < source.length) {
					value += source[cursor + 1];
					cursor += 2;
				} else {
					value += source[cursor];
					cursor += 1;
				}
			}
			if (cursor >= source.length) {
				throw new KanataParseError('unbalanced', 'Unterminated string');
			}
			pushAtom(value);
			index = cursor + 1;
			continue;
		}

		if (char !== undefined && /\s/.test(char)) {
			index += 1;
			continue;
		}

		let cursor = index;
		while (cursor < source.length) {
			const current = source[cursor];
			if (current === undefined || /\s/.test(current) || current === '(' || current === ')') {
				break;
			}
			cursor += 1;
		}
		pushAtom(source.slice(index, cursor));
		index = cursor;
	}

	if (stack.length !== 1) {
		throw new KanataParseError('unbalanced', 'Unclosed parenthesis');
	}
	return root;
}

type AliasTable = ReadonlyMap<string, KanataExpr>;

function formHead(expr: KanataExpr): string | null {
	return Array.isArray(expr) && typeof expr[0] === 'string' ? expr[0] : null;
}

function atom(value: KanataExpr | undefined): string | null {
	return typeof value === 'string' ? value : null;
}

function numberArg(value: KanataExpr | undefined): number | null {
	const raw = atom(value);
	if (raw === null || !/^-?\d+$/.test(raw)) return null;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Modifier prefixes, longest first so `RS-` is not read as `R-` + `S-`. */
const MODIFIER_PREFIXES = [
	'RSA',
	'RSC',
	'RM',
	'RC',
	'RS',
	'RA',
	'LA',
	'LM',
	'LC',
	'LS',
	'C',
	'S',
	'A',
	'M',
	'L',
	'R',
] as const;

/**
 * Split `M-S-z` / `S--` / `C-M-S-4` into modifier prefixes and a base
 * key. Returns `null` when the atom is not a chord.
 */
export function splitChord(value: string): { modifiers: readonly string[]; key: string } | null {
	let rest = value;
	const modifiers: string[] = [];

	let matched = true;
	while (matched) {
		matched = false;
		for (const prefix of MODIFIER_PREFIXES) {
			const marker = `${prefix}-`;
			if (rest.startsWith(marker) && rest.length > marker.length) {
				modifiers.push(prefix);
				rest = rest.slice(marker.length);
				matched = true;
				break;
			}
		}
	}

	if (modifiers.length === 0) return null;
	return { modifiers, key: rest };
}

function unknownAction(raw: string, note?: string): KeyboardAction {
	return note === undefined ? { raw, kind: 'unknown' } : { raw, kind: 'unknown', note };
}

function parseAtomKey(value: string): KeyboardAction {
	if (value === '_') return { raw: value, kind: 'transparent' };
	if (value === 'XX' || value === 'xx') return { raw: value, kind: 'blocked' };
	const chord = splitChord(value);
	if (chord !== null) {
		return {
			raw: value,
			kind: 'chord',
			key: chord.key,
			modifiers: chord.modifiers,
		};
	}
	return { raw: value, kind: 'key', key: value };
}

function resolveAlias(
	reference: string,
	aliases: AliasTable,
	depth: number,
	stack: ReadonlySet<string>,
): KeyboardAction {
	const name = reference.slice(1);
	const target = aliases.get(name);
	if (target === undefined) {
		return unknownAction(reference, 'alias-not-found');
	}
	if (stack.has(name) || depth >= MAX_ALIAS_DEPTH) {
		return unknownAction(reference, 'alias-cycle');
	}
	const next = new Set(stack);
	next.add(name);
	const resolved = parseExpr(target, aliases, depth + 1, next);
	return { ...resolved, reference };
}

function parseMacroSteps(exprs: readonly KanataExpr[], aliases: AliasTable): KeyboardStep[] {
	const steps: KeyboardStep[] = [];
	for (const expr of exprs) {
		const numeric = atom(expr);
		if (numeric !== null && /^\d+$/.test(numeric)) {
			steps.push({ kind: 'delay', ms: Number.parseInt(numeric, 10) });
			continue;
		}
		steps.push({
			kind: 'action',
			action: parseExpr(expr, aliases, 0, new Set()),
		});
	}
	return steps;
}

function parseExpr(
	expr: KanataExpr,
	aliases: AliasTable,
	depth: number,
	stack: ReadonlySet<string>,
): KeyboardAction {
	if (typeof expr === 'string') {
		if (expr.startsWith('@')) return resolveAlias(expr, aliases, depth, stack);
		return parseAtomKey(expr);
	}

	const raw = serializeExpr(expr);
	const head = formHead(expr);
	if (head === null) return unknownAction(raw, 'unsupported-form');

	switch (head) {
		case 'layer-switch':
		case 'layer-while-held':
		case 'layer-toggle': {
			const layer = atom(expr[1]);
			if (layer === null) return unknownAction(raw, 'missing-layer');
			return { raw, kind: head, layer };
		}
		case 'tap-hold':
		case 'tap-hold-press':
		case 'tap-hold-release': {
			const tap = expr[3];
			const hold = expr[4];
			if (tap === undefined || hold === undefined) {
				return unknownAction(raw, 'missing-branch');
			}
			return {
				raw,
				kind: 'tap-hold',
				timing: {
					tapMs: numberArg(expr[1]),
					holdMs: numberArg(expr[2]),
				},
				tap: parseExpr(tap, aliases, depth, stack),
				hold: parseExpr(hold, aliases, depth, stack),
			};
		}
		case 'one-shot': {
			const inner = expr[2];
			if (inner === undefined) return unknownAction(raw, 'missing-action');
			return {
				raw,
				kind: 'one-shot',
				timeoutMs: numberArg(expr[1]),
				action: parseExpr(inner, aliases, depth, stack),
			};
		}
		case 'macro': {
			return {
				raw,
				kind: 'macro',
				steps: parseMacroSteps(expr.slice(1), aliases),
			};
		}
		case 'macro-repeat': {
			const first = expr[1];
			if (first === undefined) return unknownAction(raw, 'missing-action');
			return {
				raw,
				kind: 'macro',
				steps: [
					{
						kind: 'action',
						action: parseExpr(first, aliases, depth, stack),
					},
				],
				repeatMs: numberArg(expr[2]),
			};
		}
		case 'dynamic-macro-record':
		case 'dynamic-macro-record-stop':
		case 'dynamic-macro-play':
			return { raw, kind: 'dynamic-macro', operation: head };
		default:
			if (head.startsWith('movemouse') || head.startsWith('mwheel')) {
				return { raw, kind: 'mouse', operation: head };
			}
			return unknownAction(raw, 'unsupported-form');
	}
}

/**
 * Parse a Kanata configuration into `defsrc` plus layers.
 *
 * Every layer must contain exactly one action per `defsrc` key. A
 * mismatch is a parse failure: rendering a shifted diagram would be
 * worse than stating that the source is unavailable.
 */
export function parseKanata(source: string): ParsedKanata {
	const expressions = parseExpressions(source);
	const forms = expressions.filter(Array.isArray);

	const defsrcForm = forms.find((form) => formHead(form) === 'defsrc');
	if (defsrcForm === undefined) {
		throw new KanataParseError('missing-defsrc', 'No defsrc form');
	}
	const defsrc = defsrcForm.slice(1).map((entry) => {
		const value = atom(entry);
		if (value === null) {
			throw new KanataParseError('missing-defsrc', 'defsrc contains a non-atom');
		}
		return value;
	});
	if (defsrc.length === 0) {
		throw new KanataParseError('empty-defsrc', 'defsrc is empty');
	}

	const aliasForm = forms.find((form) => formHead(form) === 'defalias');
	const aliases = new Map<string, KanataExpr>();
	if (aliasForm !== undefined) {
		for (let index = 1; index < aliasForm.length; index += 2) {
			const name = atom(aliasForm[index]);
			const value = aliasForm[index + 1];
			if (name === null || value === undefined) {
				throw new KanataParseError('alias-form', 'defalias is not a name/form pair list');
			}
			aliases.set(name.startsWith('@') ? name.slice(1) : name, value);
		}
	}

	const layers: ParsedKanataLayer[] = [];
	for (const form of forms) {
		if (formHead(form) !== 'deflayer') continue;
		const id = atom(form[1]);
		if (id === null || id.length === 0) {
			throw new KanataParseError('layer-name', 'deflayer has no name');
		}
		const keys = form.slice(2).map((entry) => parseExpr(entry, aliases, 0, new Set()));
		if (keys.length !== defsrc.length) {
			throw new KanataParseError(
				'layer-arity',
				`Layer ${id} has ${keys.length} keys; defsrc has ${defsrc.length}`,
			);
		}
		layers.push({ id, keys });
	}

	if (layers.length === 0) {
		throw new KanataParseError('missing-layers', 'No deflayer form');
	}
	return { defsrc, layers };
}
