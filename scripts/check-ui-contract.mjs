#!/usr/bin/env node
/**
 * UI composition-contract gate (Issue #1107, ADR-0022).
 *
 * Statically enforces clauses C-1 … C-8 of src/editorial/layout-system.md
 * against src/** consumers. Detection is AST-based (TypeScript compiler
 * API) and property/context-aware — never a blanket text scan. Policy
 * data lives in quality/ui-contract.json; allowlists live there too and
 * every entry must carry a reason and suppress at least one live
 * violation (a stale entry fails the gate).
 *
 * Usage:
 *   node scripts/check-ui-contract.mjs [--json]
 *   node scripts/check-ui-contract.mjs --emit-allowlist
 *   node scripts/check-ui-contract.mjs --root <dir> --contract <path>
 *
 * Allowlist model (Issue #1107 review): entries are NOT blanket
 * file×clause exemptions. Each entry records the exact violation
 * signatures it waives — { path, clause, reason, signatures:
 * { "<detail>": <count> } } — so a NEW violation added to an
 * allowlisted file still fails, and a fixed violation leaves a stale
 * signature that fails until the entry shrinks. The debt mirror is
 * exact: every recorded signature must be fully consumed by a live
 * violation, and every live violation must be covered.
 *
 * Exit: 0 clean / 1 violations or stale allowlist / 2 input error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const argValue = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? null : process.argv[i + 1];
};
const JSON_OUT = process.argv.includes('--json');
const EMIT_ALLOWLIST = process.argv.includes('--emit-allowlist');
const CONTRACT_PATH = argValue('--contract') ?? 'quality/ui-contract.json';
const SCAN_ROOT = argValue('--root') ?? null;

function fail(msg) {
	console.error(`check-ui-contract: ${msg}`);
	process.exit(2);
}

let contract;
try {
	contract = JSON.parse(readFileSync(resolve(ROOT, CONTRACT_PATH), 'utf8'));
} catch (e) {
	fail(`cannot read ${CONTRACT_PATH}: ${e.message}`);
}

const { root, extensions, exemptPrefixes } = contract.scope;
const SRC = resolve(ROOT, SCAN_ROOT ?? root);

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			if (name === 'node_modules' || name.startsWith('.')) continue;
			yield* walk(p);
		} else if (extensions.some((e) => name.endsWith(e))) {
			yield p;
		}
	}
}

const toPosix = (p) => p.split(sep).join('/');
const files = [];
for (const abs of walk(SRC)) {
	const rel = toPosix(relative(ROOT, abs));
	if (exemptPrefixes.some((pre) => rel.startsWith(pre))) continue;
	if (/\.(test|spec|stories|fixture|d)\.[tj]sx?$/.test(rel)) continue;
	files.push({ abs, rel });
}

// ---------- helpers ----------
const lineOf = (sf, node) => ts.getLineAndCharacterOfPosition(sf, node.getStart(sf)).line + 1;

function propName(name) {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return null;
}

function literalValue(init) {
	if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
	return null;
}

function jsxTagName(node) {
	const n = node.tagName;
	return ts.isIdentifier(n) ? n.text : null;
}

// ---------- violation collection ----------
// violation: { clause, file, line, detail }
const violations = [];
const add = (clause, file, sf, node, detail) =>
	violations.push({ clause, file, line: lineOf(sf, node), detail });

// allowlist lookup: entries { path, clause, reason }; path exact or 'prefix*'
function allowlistEntries(listName) {
	return contract[listName] ?? contract.allowlists?.[listName] ?? [];
}

function allowlisted(clause, file) {
	return allowlistEntries(clauseToList(clause)).some((e) => pathMatch(e.path, file));
}
function clauseToList(clause) {
	return {
		'C-1': 'sectionAllowlist',
		'C-2': 'colorAllowlist',
		'C-3': 'sectionAllowlist',
		'C-4': 'gridAllowlist',
		'C-5': 'listAllowlist',
		'C-6': 'controlAllowlist',
		'C-7': 'sectionAllowlist',
		'C-8': 'enumerationAllowlist',
	}[clause];
}
function pathMatch(pattern, file) {
	if (pattern.endsWith('*')) return file.startsWith(pattern.slice(0, -1));
	return file === pattern;
}

const C2 = contract.clauses['C-2'];
const C2_PROPS = new Set(C2.colorProperties);
const C2_FORBIDDEN = C2.forbiddenValuePatterns.map((p) => new RegExp(p));
const C2_SEMANTIC = C2.semanticValuePrefixes;

const C1 = contract.clauses['C-1'];
const C1_BLOCK_PAD = new Set(C1.detection.styleProperties);
const C1_SURFACE = new Set(['backgroundColor', 'background', 'backgroundImage']);
const C1_RULES = C1.detection.valueRules;

const C3_PROPS = new Set(contract.clauses['C-3'].detection.styleProperties);
const C3_PAD =
	/^(paddingBlock|paddingBlockStart|paddingBlockEnd|marginBlock|marginBlockStart|marginBlockEnd|minHeight|height)$/;

const C4_PROPS = new Set(contract.clauses['C-4'].styleProperties);

const C5 = contract.clauses['C-5'].detection.jsxPatterns;
const C5_FORBIDDEN_LI = new Set(C5[0].forbiddenStyleProperties);
const C5_FORBIDDEN_UL = new Set(C5[1].forbiddenStyleProperties);
const C5_LIST_TAGS = new Set(['ul', 'ol']);

const C6 = contract.clauses['C-6'].detection.jsxPatterns[0];
const C6_TAGS = new Set([C6.element, ...(C6.elementAliases ?? [])]);
const C6_PROPS = new Set(C6.controlStyleProperties);

const C7_MIN_FILES = contract.clauses['C-7'].detection.minFiles;
const C7_MIN_PROPS = 2;
const CSS_CALLS = new Set(['css', 'cva']);

const C8 = contract.clauses['C-8'].detection.jsxPatterns[0];
// C-8 scope is relative to the SCAN ROOT: 'home/' and 'routes/' trees
// directly under it (src/home, src/routes in production; a fixture
// root lays out the same shape).
const C8_SCOPE = /^(home|routes)\//;
const C8_NEARBY = C8.requiredNearby;

// C-7 accumulator: normalized literal -> Set(files)
const styleLiterals = new Map();

function normalizeObject(node) {
	// object literal -> sorted "prop:text" pairs (values via getText, whitespace stripped)
	const parts = [];
	for (const prop of node.properties) {
		if (!ts.isPropertyAssignment(prop)) return null;
		const name = propName(prop.name);
		if (!name) return null;
		parts.push(`${name}:${prop.initializer.getText().replace(/\s+/g, '')}`);
	}
	if (parts.length < C7_MIN_PROPS) return null;
	return parts.sort().join('|');
}

function checkObjectLiteral(node, file, sf, inCssCall) {
	const names = new Set();
	const values = new Map();
	let hasSurface = false;
	let hasBlockPad = false;
	for (const prop of node.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		const name = propName(prop.name);
		if (!name) continue;
		names.add(name);
		const v = literalValue(prop.initializer);
		if (v !== null) values.set(name, v);
		if (C1_SURFACE.has(name)) hasSurface = true;
		if (C1_BLOCK_PAD.has(name) || C3_PAD.test(name)) hasBlockPad = true;
	}

	// C-2: color-valued properties with forbidden values
	for (const name of names) {
		if (!C2_PROPS.has(name)) continue;
		const v = values.get(name);
		if (v === null || v === undefined) continue;
		if (C2_SEMANTIC.some((p) => v.startsWith(p))) continue;
		if (C2_FORBIDDEN.some((re) => re.test(v))) {
			add('C-2', file, sf, node, `${name}: ${JSON.stringify(v)}`);
		}
	}

	// C-1 value rules (bg.canvas paint, section separators)
	for (const rule of C1_RULES) {
		const prop = rule.property;
		if (!names.has(prop)) continue;
		if (rule.values && !(values.get(prop) && rule.values.includes(values.get(prop)))) continue;
		add('C-1', file, sf, node, `${prop}${values.has(prop) ? `: ${values.get(prop)}` : ''}`);
	}

	// C-1 block padding only counts on a surface-bearing object (section-scale heuristic)
	if (hasSurface) {
		for (const name of names) {
			if (C1_BLOCK_PAD.has(name)) {
				add('C-1', file, sf, node, `${name} on surface object`);
			}
		}
	}

	// C-3: section-scale band (surface + block padding/min-height)
	const hasC3Surface = [...names].some((n) => C3_PROPS.has(n));
	if (hasC3Surface && hasBlockPad) {
		add('C-3', file, sf, node, 'surface + block padding/min-height outside PageSection');
	}

	// C-4: bespoke grid tracks
	for (const name of names) {
		if (C4_PROPS.has(name)) {
			add('C-4', file, sf, node, name);
		}
	}

	// C-7: normalized css()/cva() literal dedup
	if (inCssCall) {
		const norm = normalizeObject(node);
		if (norm) {
			if (!styleLiterals.has(norm)) styleLiterals.set(norm, new Set());
			styleLiterals.get(norm).add(file);
		}
	}
}

function jsxClassNameObjects(attr, constCss) {
	// Object literals inside the initializer PLUS css() objects bound
	// to consts referenced by name (the `const s = css({...})` pattern
	// this codebase uses everywhere).
	const out = [];
	const init = attr.initializer;
	if (!init) return out;
	const seenObj = new Set();
	const push = (o) => {
		if (!seenObj.has(o)) {
			seenObj.add(o);
			out.push(o);
		}
	};
	const visit = (n) => {
		if (ts.isObjectLiteralExpression(n)) push(n);
		if (ts.isIdentifier(n) && constCss.has(n.text)) {
			for (const o of constCss.get(n.text)) push(o);
		}
		ts.forEachChild(n, visit);
	};
	visit(init);
	return out;
}

function buildConstCssMap(sf) {
	// const name -> [ObjectLiteralExpression] for `const x = css({...})`
	const map = new Map();
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const init = node.initializer;
			if (ts.isCallExpression(init)) {
				const callee = ts.isIdentifier(init.expression)
					? init.expression.text
					: init.expression.getText(sf).split('.').pop();
				if (CSS_CALLS.has(callee)) {
					const objs = init.arguments.filter(ts.isObjectLiteralExpression);
					if (objs.length) {
						if (!map.has(node.name.text)) map.set(node.name.text, []);
						map.get(node.name.text).push(...objs);
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return map;
}

function checkJsx(node, file, sf, constCss) {
	const tag = jsxTagName(node);
	if (!tag) return;

	// raw <section> outside editorial
	if (tag === 'section') {
		add('C-1', file, sf, node, 'raw <section> element');
	}

	// C-5: boxed <li> / styled lists
	if (tag === 'li' || C5_LIST_TAGS.has(tag)) {
		const forbidden = tag === 'li' ? C5_FORBIDDEN_LI : C5_FORBIDDEN_UL;
		for (const attr of node.attributes?.properties ?? []) {
			if (!ts.isJsxAttribute(attr) || propName(attr.name) !== 'className') continue;
			for (const obj of jsxClassNameObjects(attr, constCss)) {
				for (const prop of obj.properties) {
					if (!ts.isPropertyAssignment(prop)) continue;
					const name = propName(prop.name);
					if (name && forbidden.has(name)) {
						add('C-5', file, sf, prop, `<${tag}> ${name}`);
					}
				}
			}
		}
	}

	// C-6: hand-styled control lookalikes
	if (C6_TAGS.has(tag)) {
		for (const attr of node.attributes?.properties ?? []) {
			if (!ts.isJsxAttribute(attr) || propName(attr.name) !== 'className') continue;
			for (const obj of jsxClassNameObjects(attr, constCss)) {
				for (const prop of obj.properties) {
					if (!ts.isPropertyAssignment(prop)) continue;
					const name = propName(prop.name);
					if (name && C6_PROPS.has(name)) {
						add('C-6', file, sf, prop, `<${tag}> ${name}`);
					}
				}
			}
		}
	}
}

for (const { abs, rel } of files) {
	const text = readFileSync(abs, 'utf8');
	const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const relScan = toPosix(relative(SRC, abs));
	const constCss = buildConstCssMap(sf);

	// C-8: unbounded .map( in home/routes scope
	if (C8_SCOPE.test(relScan)) {
		let idx = text.indexOf('.map(');
		while (idx !== -1) {
			const window = text.slice(idx, idx + 800);
			if (!C8_NEARBY.some((tok) => window.includes(tok))) {
				const pos = sf.getLineAndCharacterOfPosition(idx).line + 1;
				violations.push({ clause: 'C-8', file: rel, line: pos, detail: 'unbounded .map(' });
			}
			idx = text.indexOf('.map(', idx + 5);
		}
	}

	const visit = (node) => {
		// css()/cva() object literals -> full clause scan + C-7 dedup
		if (ts.isCallExpression(node)) {
			const exprText = node.expression.getText(sf);
			const callee = ts.isIdentifier(node.expression)
				? node.expression.text
				: exprText.split('.').pop();
			if (CSS_CALLS.has(callee)) {
				for (const arg of node.arguments) {
					if (ts.isObjectLiteralExpression(arg)) {
						checkObjectLiteral(arg, rel, sf, true);
						// nested variant objects (cva) — scan their literals too
						const nested = (n) => {
							if (ts.isObjectLiteralExpression(n) && n !== arg) {
								checkObjectLiteral(n, rel, sf, true);
							}
							ts.forEachChild(n, nested);
						};
						ts.forEachChild(arg, nested);
					}
				}
			}
		}
		// non-css object literals still need C-2..C-4 (style={{...}}, sx, inline objects)
		if (ts.isObjectLiteralExpression(node)) {
			// avoid double-scanning css() args: they were handled above; scanning again only duplicates violations.
			// Mark: parent call handled — detect by walking ancestors is costly; instead dedupe violations later by (file,line,clause,detail).
			checkObjectLiteral(node, rel, sf, false);
		}
		if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) || ts.isJsxElement(node)) {
			if (ts.isJsxElement(node)) {
				// check opening element only
				checkJsx(node.openingElement, rel, sf, constCss);
			} else {
				checkJsx(node, rel, sf, constCss);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
}

// dedupe violations (object literals reachable via css() get scanned twice)
const seen = new Set();
const deduped = violations.filter((v) => {
	const k = `${v.clause}|${v.file}|${v.line}|${v.detail}`;
	if (seen.has(k)) return false;
	seen.add(k);
	return true;
});

// ---------- signature-based allowlist ----------
// An entry waives EXACTLY the violations it records:
//   { path, clause, reason, signatures: { "<detail>": <count> } }
// A violation is suppressed only when a matching entry still has
// budget for its (clause, file, detail) signature. Anything else —
// a new detail, an extra occurrence, a violation in an allowlisted
// file — is live. Entries are stale when they waive nothing or when
// a recorded signature has no live violation left to consume (the
// debt shrank; the mirror must shrink with it).

const ALLOWLIST_KEYS = {
	sectionAllowlist: ['C-1', 'C-3'],
	colorAllowlist: ['C-2'],
	gridAllowlist: ['C-4'],
	listAllowlist: ['C-5'],
	controlAllowlist: ['C-6'],
	enumerationAllowlist: ['C-8'],
};

// budget: entryKey -> { listName, path, clauses, remaining: { detail: count } }
const budget = new Map();
const stale = [];
for (const [listName, clauses] of Object.entries(ALLOWLIST_KEYS)) {
	for (const e of allowlistEntries(listName)) {
		if (!e || typeof e.path !== 'string' || !e.signatures) continue;
		const key = `${listName} ${e.path}`;
		if (!budget.has(key)) {
			budget.set(key, { listName, path: e.path, clauses, remaining: {} });
		}
		const b = budget.get(key);
		for (const [detail, count] of Object.entries(e.signatures)) {
			b.remaining[detail] = (b.remaining[detail] ?? 0) + count;
		}
		if (!e.reason) {
			stale.push(`${listName}: ${e.path} (no reason)`);
		}
	}
}

const live = [];
const suppressed = new Map(); // "clause:file" -> count
for (const v of deduped) {
	const listName = clauseToList(v.clause);
	const candidates = allowlistEntries(listName).filter((e) => pathMatch(e.path, v.file));
	let covered = false;
	for (const e of candidates) {
		const b = budget.get(`${listName} ${e.path}`);
		if (!b || !b.clauses.includes(v.clause)) continue;
		const remaining = b.remaining[v.detail] ?? 0;
		if (remaining > 0) {
			b.remaining[v.detail] = remaining - 1;
			covered = true;
			const sk = `${v.clause}:${v.file}`;
			suppressed.set(sk, (suppressed.get(sk) ?? 0) + 1);
			break;
		}
	}
	if (!covered) live.push(v);
}

// stale: recorded signatures with no live violation left to consume
// (the debt shrank — the mirror must shrink with it, so the waiver
// can never outlive the violation it documents).
for (const b of budget.values()) {
	const leftovers = Object.entries(b.remaining).filter(([, n]) => n > 0);
	if (leftovers.length > 0) {
		const totalLeft = leftovers.reduce((a, [, n]) => a + n, 0);
		stale.push(
			`${b.listName}: ${b.path} — ${totalLeft} recorded signature(s) have no live violation (debt shrank; shrink the entry)`,
		);
	}
}

// C-7 cross-file duplicates, minus duplicateAllowlist entries
// ({ files: [...], reason } — live only while that exact file set
// shares the literal).
const dupAllow = allowlistEntries('duplicateAllowlist');
const c7All = [];
for (const [norm, fileSet] of styleLiterals) {
	if (fileSet.size >= C7_MIN_FILES) {
		c7All.push({ files: [...fileSet].sort(), literal: norm.slice(0, 120) });
	}
}
const c7 = [];
const staleDup = [];
for (const d of c7All) {
	const match = dupAllow.find(
		(e) => Array.isArray(e.files) && e.files.slice().sort().join('|') === d.files.join('|'),
	);
	if (match) {
		// suppressed — but the entry must carry a reason
		if (!match.reason) staleDup.push(`duplicateAllowlist: ${d.files.join(', ')} (no reason)`);
	} else {
		c7.push(d);
	}
}
for (const e of dupAllow) {
	if (!Array.isArray(e.files)) continue;
	const liveMatch = c7All.some((d) => d.files.join('|') === e.files.slice().sort().join('|'));
	if (!liveMatch) staleDup.push(`duplicateAllowlist: ${e.files.join(', ')} (waives nothing)`);
}

if (EMIT_ALLOWLIST) {
	// Regenerate the debt mirror: group every live violation by
	// (allowlist, file) and record { detail: count } signatures.
	// `reason` is emitted as null — the caller fills it per clause
	// before committing (an entry without a reason fails the gate).
	const groups = new Map(); // listName -> Map(file -> Map(detail -> count))
	const clauseSets = new Map(); // "listName file" -> Set(clause)
	for (const v of deduped) {
		const ln = clauseToList(v.clause);
		if (!groups.has(ln)) groups.set(ln, new Map());
		const fm = groups.get(ln);
		if (!fm.has(v.file)) fm.set(v.file, new Map());
		const dm = fm.get(v.file);
		dm.set(v.detail, (dm.get(v.detail) ?? 0) + 1);
		const ck = `${ln} ${v.file}`;
		if (!clauseSets.has(ck)) clauseSets.set(ck, new Set());
		clauseSets.get(ck).add(v.clause);
	}
	const out = {};
	for (const [ln, fm] of [...groups.entries()].sort()) {
		out[ln] = [...fm.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([path, dm]) => ({
				path,
				clauses: [...clauseSets.get(`${ln} ${path}`)].sort(),
				reason: null,
				signatures: Object.fromEntries([...dm.entries()].sort()),
			}));
	}
	console.log(JSON.stringify(out, null, 2));
	process.exit(0);
}

if (JSON_OUT) {
	console.log(
		JSON.stringify(
			{ violations: live, suppressed: [...suppressed], stale: [...stale, ...staleDup], c7 },
			null,
			2,
		),
	);
} else {
	const byClause = new Map();
	for (const v of live) {
		if (!byClause.has(v.clause)) byClause.set(v.clause, []);
		byClause.get(v.clause).push(v);
	}
	for (const [clause, list] of [...byClause.entries()].sort()) {
		console.log(`\n${clause}: ${list.length} violation(s)`);
		for (const v of list.slice(0, 50)) {
			console.log(`  ${v.file}:${v.line}  ${v.detail}`);
		}
		if (list.length > 50) console.log(`  … and ${list.length - 50} more`);
	}
	for (const d of c7) {
		console.log(`\nC-7: identical style literal in ${d.files.length} files:`);
		for (const f of d.files) console.log(`  ${f}`);
		console.log(`  ${d.literal}…`);
	}
	if (stale.length || staleDup.length) {
		console.log('\nStale allowlist entries (waive nothing — remove or fix path):');
		for (const s of [...stale, ...staleDup]) console.log(`  ${s}`);
	}
	console.log(
		`\ncheck-ui-contract: ${live.length} violation(s), ${deduped.length - live.length} suppressed, ${stale.length + staleDup.length} stale, ${c7.length} duplicate group(s) across ${files.length} files`,
	);
}

process.exit(live.length > 0 || stale.length > 0 || staleDup.length > 0 || c7.length > 0 ? 1 : 0);
