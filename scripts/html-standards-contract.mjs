/**
 * html-standards-contract — an offline HTML conformance engine for the
 * SSR documents this repository publishes (Issue #412).
 *
 * What it is
 * ----------
 * A dependency-free HTML5 tokenizer + a tree builder + a rule engine
 * whose findings are shaped like the Nu Html Checker (`validator.nu`)
 * output: a message type, a class (`error` / `warning`), and a
 * line/column in the document that was checked. It is deliberately NOT
 * a general HTML5 implementation — it covers the subset that decides the
 * three defect classes the Issue names:
 *
 *   - invalid markup      → `invalid-nesting`, `stray-end-tag`,
 *                           `misnested-tag`, `unclosed-element`,
 *                           `missing-doctype`, `missing-element`
 *   - duplicate IDs       → `duplicate-id`, `bad-id`
 *   - attribute errors    → `unknown-attribute`, `bad-value`,
 *                           `duplicate-attribute`, `missing-attribute`,
 *                           `bad-idref`
 *
 * One engine, three front-ends
 * ---------------------------
 *   - `test/integration/html-standards.test.ts` drives the REAL Worker
 *     through `SELF.fetch` and feeds the SSR documents here. That is
 *     the CI gate, and it runs inside `pnpm run test`.
 *   - `scripts/check-html-standards.mjs` is the offline front-end: it
 *     re-runs the committed fixtures, the route inventory and the
 *     waiver ledger with no server and no network, which is what
 *     `pnpm run html:standards:check` executes in `validate:fast`.
 *     With `--live <baseUrl>` it fetches the same routes from a real
 *     server and calls the same engine.
 *   - `scripts/make-html-nu-validator-report.mjs` renders the human
 *     report that `docs/verification/standards/html-nu-validator.webp`
 *     is a screenshot of.
 *
 * No secrets leave the process
 * ----------------------------
 * Nothing here opens a socket. The public `validator.nu` endpoint would
 * upload every rendered page (including `/admin/*` documents and any
 * personal copy they carry) to a third party, so this contract is
 * offline by construction and the only inputs are documents the caller
 * already holds.
 *
 * Deliberate limits (documented, not accidental)
 * ----------------------------------------------
 *   - Foreign content (`<svg>` / `<math>` subtrees) is NOT checked for
 *     attributes or nesting: SVG attribute names are case-sensitive
 *     (`viewBox`) and its content model is not HTML's, so a naive check
 *     there would produce exactly the false positives this gate exists
 *     to avoid. `id` uniqueness still applies, because `aria-*`
 *     references cross that boundary.
 *   - An element name the table does not know is not an error. React can
 *     render a custom element, and "we have never heard of it" is not a
 *     conformance defect.
 *   - Optional end tags are honoured (so `<li>a<li>b` is not reported as
 *     a misnest), because a validator that fires on valid shorthand is
 *     one nobody runs.
 */

/* ------------------------------------------------------------------ *
 * Rule catalogue
 * ------------------------------------------------------------------ */

/**
 * Every rule this engine can emit, with the Nu Html Checker message
 * type it maps to.
 *
 * `quality/html-standards.json` owns the SEVERITY of each rule and the
 * reason for it; this table owns the fact that the rule exists at all.
 * A manifest that names a rule the engine does not implement, or that
 * omits one the engine can emit, is a failure — the two lists are
 * checked against each other in both directions.
 */
export const RULE_CATALOGUE = Object.freeze({
	'missing-doctype': { nuType: 'missing-doctype' },
	'bad-doctype': { nuType: 'bad-doctype' },
	'obsolete-doctype': { nuType: 'obsolete-doctype' },
	'missing-element': { nuType: 'missing-element' },
	'duplicate-element': { nuType: 'duplicate-element' },
	'missing-attribute': { nuType: 'missing-attribute' },
	'unknown-attribute': { nuType: 'attribute-error' },
	'duplicate-attribute': { nuType: 'duplicate-attribute' },
	'bad-value': { nuType: 'attribute-error' },
	'duplicate-id': { nuType: 'duplicate-id' },
	'bad-id': { nuType: 'attribute-error' },
	'bad-idref': { nuType: 'attribute-error' },
	'invalid-nesting': { nuType: 'invalid-nesting' },
	'misnested-tag': { nuType: 'misnested-tag' },
	'stray-end-tag': { nuType: 'stray-end-tag' },
	'unclosed-element': { nuType: 'unclosed-element' },
	'empty-title': { nuType: 'empty-title' },
	'heading-level-skip': { nuType: 'heading-order' },
});

/** Rules whose findings are errors unless the manifest says otherwise. */
export const DEFAULT_SEVERITIES = Object.freeze(
	Object.fromEntries(Object.keys(RULE_CATALOGUE).map((rule) => [rule, 'error'])),
);

/** Every rule id, sorted — the manifest's completeness check. */
export const RULE_IDS = Object.freeze(Object.keys(RULE_CATALOGUE).sort());

/**
 * Severity map in the shape `validateHtml` consumes.
 *
 * The manifest owns the policy; this is only the projection of it, so
 * every front-end (offline CLI, live CLI, workerd SSR suite) resolves
 * severity the same way and cannot drift from the declaration.
 *
 * @param {{ rules: Record<string, { severity: string }> }} manifest
 */
export function severitiesFrom(manifest) {
	return Object.fromEntries(
		Object.entries(manifest.rules ?? {}).map(([rule, entry]) => [rule, entry.severity]),
	);
}

/* ------------------------------------------------------------------ *
 * Element tables
 * ------------------------------------------------------------------ */

const GLOBAL_ATTRIBUTES = new Set([
	'id',
	'class',
	'style',
	'title',
	'lang',
	'dir',
	'hidden',
	'inert',
	'tabindex',
	'role',
	'translate',
	'contenteditable',
	'spellcheck',
	'draggable',
	'dropzone',
	'inputmode',
	'enterkeyhint',
	'nonce',
	'popover',
	'popovertarget',
	'popovertargetaction',
	'autofocus',
	'itemprop',
	'itemscope',
	'itemtype',
	'itemid',
	'itemref',
	'slot',
	'part',
	'exportparts',
	'is',
	'color-scheme',
	'view-transition-name',
	'autocapitalize',
	'autocorrect',
	/** Presentational hints React forwards; not conformance-relevant. */
	'fetchpriority',
	'loading',
	'decoding',
	'translate',
]);

/** Attributes allowed on any element that carries them. */
const IDREF_LIST_ATTRIBUTES = new Set([
	'aria-labelledby',
	'aria-describedby',
	'aria-controls',
	'aria-owns',
	'aria-details',
	'aria-flowto',
	'aria-activedescendant',
	'aria-errormessage',
]);

/** Elements a `label[for]` or `td[headers]` reference may point at. */
const FORM_ASSOCIABLE = new Set([
	'button',
	'input',
	'meter',
	'output',
	'progress',
	'select',
	'textarea',
]);

const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/** Elements whose content is tokenized verbatim. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const RCDATA_ELEMENTS = new Set(['title', 'textarea']);

const PHRASING_CONTENT = new Set([
	'a',
	'abbr',
	'audio',
	'b',
	'bdi',
	'bdo',
	'br',
	'button',
	'canvas',
	'cite',
	'code',
	'data',
	'datalist',
	'del',
	'dfn',
	'em',
	'embed',
	'iframe',
	'img',
	'input',
	'ins',
	'kbd',
	'label',
	'link',
	'map',
	'mark',
	'meter',
	'noscript',
	'object',
	'output',
	'picture',
	'progress',
	'q',
	'rp',
	'rt',
	'ruby',
	's',
	'samp',
	'script',
	'select',
	'slot',
	'small',
	'span',
	'strong',
	'sub',
	'sup',
	'template',
	'textarea',
	'time',
	'u',
	'var',
	'video',
	'wbr',
]);

const FLOW_CONTENT = new Set([
	'address',
	'article',
	'aside',
	'blockquote',
	'caption',
	'col',
	'colgroup',
	'dd',
	'details',
	'dialog',
	'div',
	'dl',
	'dt',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hgroup',
	'hr',
	'legend',
	'li',
	'main',
	'menu',
	'nav',
	'ol',
	'optgroup',
	'option',
	'p',
	'pre',
	'search',
	'section',
	'summary',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'ul',
	...PHRASING_CONTENT,
]);

/** Elements whose only content is text (element children are an error). */
const TEXT_ONLY_CONTENT = new Set(['title', 'option', 'textarea', 'style', 'script']);

/**
 * Per-element content model.
 *
 * `phrasing` / `flow` are the two HTML5 content categories; a list is an
 * exhaustive allow-list. `null` means "not checked" (unknown element or
 * a category this table does not model).
 */
const CONTENT_MODEL = {
	html: ['head', 'body'],
	head: ['base', 'link', 'meta', 'noscript', 'script', 'style', 'title', 'template'],
	body: 'flow',
	p: 'phrasing',
	h1: 'phrasing',
	h2: 'phrasing',
	h3: 'phrasing',
	h4: 'phrasing',
	h5: 'phrasing',
	h6: 'phrasing',
	a: 'flow',
	button: 'phrasing',
	label: 'phrasing',
	legend: 'phrasing',
	summary: 'phrasing',
	figcaption: 'flow',
	blockquote: 'flow',
	div: 'flow',
	figure: 'flow',
	section: 'flow',
	article: 'flow',
	aside: 'flow',
	nav: 'flow',
	main: 'flow',
	header: 'flow',
	footer: 'flow',
	address: 'flow',
	form: 'flow',
	fieldset: 'flow',
	dialog: 'flow',
	details: 'flow',
	hgroup: 'flow',
	search: 'flow',
	pre: 'phrasing',
	ul: ['li', 'script', 'template'],
	ol: ['li', 'script', 'template'],
	menu: ['li', 'script', 'template'],
	dl: ['dt', 'dd', 'div', 'script', 'template'],
	dt: 'flow',
	dd: 'flow',
	table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'script', 'template'],
	thead: ['tr', 'script', 'template'],
	tbody: ['tr', 'script', 'template'],
	tfoot: ['tr', 'script', 'template'],
	tr: ['th', 'td', 'script', 'template'],
	td: 'flow',
	th: 'flow',
	caption: 'flow',
	colgroup: ['col', 'template'],
	select: ['option', 'optgroup', 'hr', 'div', 'script', 'template'],
	optgroup: ['option', 'script', 'template'],
	datalist: ['option', 'script', 'template'],
	map: 'flow',
	object: 'flow',
	video: 'flow',
	audio: 'flow',
	picture: ['img', 'source'],
	canvas: 'flow',
	slot: 'flow',
};

/** Elements that are only valid directly inside the listed parents. */
const REQUIRED_PARENTS = {
	li: ['ul', 'ol', 'menu'],
	dt: ['dl'],
	dd: ['dl'],
	tr: ['table', 'thead', 'tbody', 'tfoot'],
	td: ['tr'],
	th: ['tr'],
	caption: ['table'],
	colgroup: ['table'],
	col: ['colgroup'],
	thead: ['table'],
	tbody: ['table'],
	tfoot: ['table'],
	option: ['select', 'optgroup', 'datalist'],
	optgroup: ['select'],
	figcaption: ['figure'],
	summary: ['details'],
	legend: ['fieldset'],
	area: ['map'],
	param: ['object'],
	source: ['picture', 'audio', 'video'],
	track: ['audio', 'video'],
	rt: ['ruby'],
	rp: ['ruby'],
};

/**
 * Parent-requirement exceptions.
 *
 * HTML5 lets a `<dl>` group a run of `<dt>`/`<dd>` inside a `<div>`, so
 * those two are valid under `dl` OR under a `div` that is itself inside a
 * `dl`. Nothing else in REQUIRED_PARENTS has such an alternative.
 */
const REQUIRED_PARENT_ALTERNATIVES = {
	dt: [['div', 'dl']],
	dd: [['div', 'dl']],
};

function satisfiesRequiredParent(element) {
	const required = REQUIRED_PARENTS[element.tag];
	if (!required) return true;
	const parent = element.parent;
	if (!parent || parent.type !== 'element') return true;
	if (required.includes(parent.tag)) return true;
	for (const [direct, ancestor] of REQUIRED_PARENT_ALTERNATIVES[element.tag] ?? []) {
		if (parent.tag !== direct) continue;
		if (ancestorsOf(element).some((node) => node.tag === ancestor)) return true;
	}
	return false;
}

/** Interactive content: never allowed inside an `<a>` or a `<button>`. */
const INTERACTIVE_CONTENT = new Set([
	'audio',
	'button',
	'details',
	'embed',
	'iframe',
	'input',
	'object',
	'select',
	'summary',
	'textarea',
	'video',
]);

const FOREIGN_ROOTS = new Set(['svg', 'math']);

/** Attributes allowed per element, beyond the global set. */
const ELEMENT_ATTRIBUTES = {
	a: [
		'href',
		'target',
		'rel',
		'hreflang',
		'type',
		'download',
		'referrerpolicy',
		'ping',
		'attributionsrc',
	],
	area: [
		'alt',
		'coords',
		'download',
		'href',
		'hreflang',
		'referrerpolicy',
		'rel',
		'shape',
		'target',
		'ping',
		'type',
	],
	img: [
		'alt',
		'src',
		'srcset',
		'sizes',
		'width',
		'height',
		'crossorigin',
		'referrerpolicy',
		'usemap',
	],
	input: [
		'type',
		'name',
		'value',
		'placeholder',
		'checked',
		'disabled',
		'readonly',
		'required',
		'multiple',
		'min',
		'max',
		'step',
		'minlength',
		'maxlength',
		'pattern',
		'size',
		'list',
		'form',
		'accept',
		'capture',
		'alt',
		'src',
		'width',
		'height',
	],
	button: ['type', 'name', 'value', 'disabled'],
	form: ['action', 'method', 'enctype', 'name', 'novalidate', 'accept-charset', 'target', 'rel'],
	label: ['for'],
	fieldset: ['disabled', 'name', 'form'],
	legend: [],
	output: ['for', 'name', 'form'],
	meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
	progress: ['value', 'max'],
	option: ['value', 'selected', 'disabled', 'label'],
	optgroup: ['label', 'disabled'],
	select: ['name', 'disabled', 'multiple', 'required', 'size', 'form', 'autocomplete'],
	textarea: [
		'name',
		'rows',
		'cols',
		'placeholder',
		'required',
		'disabled',
		'readonly',
		'maxlength',
		'minlength',
		'wrap',
		'form',
		'autocomplete',
	],
	ul: [],
	ol: ['start', 'reversed', 'type'],
	menu: [],
	li: ['value'],
	dl: [],
	dt: [],
	dd: [],
	table: ['border', 'cellpadding', 'cellspacing'],
	td: ['colspan', 'rowspan', 'headers'],
	th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'],
	col: ['span'],
	colgroup: ['span'],
	details: ['open', 'name'],
	dialog: ['open'],
	blockquote: ['cite'],
	q: ['cite'],
	del: ['cite', 'datetime'],
	ins: ['cite', 'datetime'],
	time: ['datetime'],
	pre: [],
	code: [],
	kbd: [],
	samp: [],
	var: [],
	meta: ['name', 'content', 'charset', 'http-equiv', 'property', 'media'],
	link: [
		'rel',
		'href',
		'hreflang',
		'type',
		'media',
		'sizes',
		'as',
		'crossorigin',
		'integrity',
		'fetchpriority',
		'blocking',
		'referrerpolicy',
		'imagesrcset',
		'imagesizes',
		'disabled',
	],
	script: [
		'src',
		'type',
		'async',
		'defer',
		'crossorigin',
		'integrity',
		'nomodule',
		'blocking',
		'referrerpolicy',
	],
	title: [],
	style: ['media', 'type', 'blocking'],
	html: ['xmlns'],
	body: ['onafterprint'],
	head: [],
	header: [],
	footer: [],
	main: [],
	nav: [],
	section: [],
	article: [],
	aside: [],
	figure: [],
	figcaption: [],
	hgroup: [],
	span: [],
	div: [],
	p: [],
	h1: [],
	h2: [],
	h3: [],
	h4: [],
	h5: [],
	h6: [],
	b: [],
	i: [],
	u: [],
	s: [],
	em: [],
	strong: [],
	small: [],
	sub: [],
	sup: [],
	mark: [],
	abbr: [],
	cite: [],
	dfn: [],
	address: [],
	bdi: [],
	bdo: [],
	ruby: [],
	rt: [],
	rp: [],
	br: [],
	hr: [],
	wbr: [],
	noscript: [],
	template: [],
	slot: [],
	canvas: ['width', 'height'],
	video: [
		'src',
		'controls',
		'autoplay',
		'loop',
		'muted',
		'playsinline',
		'poster',
		'width',
		'height',
		'preload',
	],
	audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload'],
	source: ['src', 'srcset', 'type', 'media', 'width', 'height', 'sizes'],
	track: ['src', 'kind', 'srclang', 'label', 'default'],
	picture: [],
	iframe: [
		'src',
		'name',
		'width',
		'height',
		'loading',
		'sandbox',
		'allow',
		'allowfullscreen',
		'referrerpolicy',
		'srcdoc',
		'credentialless',
	],
	object: ['data', 'type', 'width', 'height', 'name'],
	embed: ['src', 'type', 'width', 'height'],
	param: ['name', 'value'],
	map: ['name'],
	base: ['href', 'target'],
	thead: [],
	tbody: [],
	tfoot: [],
	tr: [],
	caption: [],
};

/** Attributes whose value must be a non-negative integer. */
const NUMERIC_ATTRIBUTES = new Map([
	['img:width', 0],
	['img:height', 0],
	['canvas:width', 0],
	['canvas:height', 0],
	['input:size', 1],
	['input:minlength', 0],
	['input:maxlength', 0],
	['textarea:rows', 1],
	['textarea:cols', 1],
	['textarea:maxlength', 0],
	['textarea:minlength', 0],
	['td:colspan', 1],
	['td:rowspan', 0],
	['th:colspan', 1],
	['th:rowspan', 0],
	['col:span', 1],
	['colgroup:span', 1],
	['meter:value', null],
	['meter:min', null],
	['meter:max', null],
	['progress:value', null],
	['progress:max', null],
]);

/** Token list shared by every `rel` attribute. */
const REL_TOKENS = [
	'alternate',
	'stylesheet',
	'icon',
	'preload',
	'prefetch',
	'preconnect',
	'dns-prefetch',
	'manifest',
	'modulepreload',
	'canonical',
	'apple-touch-icon',
	'mask-icon',
	'noopener',
	'noreferrer',
	'nofollow',
	'author',
	'license',
	'help',
	'search',
	'next',
	'prev',
	'tag',
	'bookmark',
	'external',
	'ugc',
	'me',
	'index',
	'up',
	'bookmarklet',
];

/** Attributes whose value must come from a closed set. */
const ENUMERATED_ATTRIBUTES = new Map([
	['form:method', ['get', 'post', 'dialog']],
	['form:enctype', ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']],
	['button:type', ['submit', 'reset', 'button']],
	[
		'input:type',
		[
			'hidden',
			'text',
			'search',
			'tel',
			'url',
			'email',
			'password',
			'date',
			'month',
			'week',
			'time',
			'datetime-local',
			'number',
			'range',
			'color',
			'checkbox',
			'radio',
			'file',
			'submit',
			'image',
			'reset',
			'button',
		],
	],
	['img:loading', ['lazy', 'eager']],
	['img:decoding', ['sync', 'async', 'auto']],
	['ol:type', ['1', 'a', 'A', 'i', 'I']],
	['th:scope', ['row', 'col', 'rowgroup', 'colgroup']],
	['textarea:wrap', ['soft', 'hard']],
	['track:kind', ['subtitles', 'captions', 'descriptions', 'chapters', 'metadata']],
	['area:shape', ['rect', 'circle', 'poly', 'default']],
	['a:rel', REL_TOKENS],
	['area:rel', REL_TOKENS],
	['form:rel', REL_TOKENS],
	[
		'meta:http-equiv',
		[
			'content-type',
			'content-language',
			'default-style',
			'x-ua-compatible',
			'refresh',
			'set-cookie',
		],
	],
	['link:rel', REL_TOKENS.filter((token) => token !== 'noopener' && token !== 'noreferrer')],
	['script:type', ['module', 'importmap', 'speculationrules']],
	['iframe:loading', ['lazy', 'eager']],
	['dialog:open', ['']],
	['details:open', ['']],
]);

/** `type` on a <script> may carry a MIME type (`application/ld+json`). */
const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

/** Attributes whose value is a boolean and may only be empty or self-named. */
const BOOLEAN_ATTRIBUTES = new Set([
	'async',
	'autofocus',
	'autoplay',
	'checked',
	'controls',
	'defer',
	'disabled',
	'formnovalidate',
	'hidden',
	'inert',
	'ismap',
	'itemscope',
	'loop',
	'multiple',
	'nomodule',
	'novalidate',
	'open',
	'playsinline',
	'readonly',
	'required',
	'reversed',
	'selected',
]);

/** Attributes that must be present, per element. */
const REQUIRED_ATTRIBUTES = {
	html: ['lang'],
	img: ['alt', 'src'],
	area: ['alt', 'href'],
	'input:image': ['alt'],
};

/* ------------------------------------------------------------------ *
 * Optional end tags + implied closes
 * ------------------------------------------------------------------ */

/**
 * Elements whose end tag may be omitted. An end tag for an ancestor
 * closes them implicitly, which is why `<ul><li>a<li>b</ul>` is valid
 * and must not be reported as a misnest.
 */
const OPTIONAL_END_TAGS = new Set([
	'p',
	'li',
	'dt',
	'dd',
	'option',
	'optgroup',
	'rt',
	'rp',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'td',
	'th',
]);

const IMPLIED_END = {
	p: new Set([
		'address',
		'article',
		'aside',
		'blockquote',
		'div',
		'dl',
		'fieldset',
		'figcaption',
		'figure',
		'footer',
		'form',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'header',
		'hgroup',
		'hr',
		'main',
		'menu',
		'nav',
		'ol',
		'p',
		'pre',
		'search',
		'section',
		'table',
		'ul',
	]),
	li: new Set(['li']),
	dt: new Set(['dt', 'dd']),
	dd: new Set(['dt', 'dd']),
	option: new Set(['option', 'optgroup']),
	optgroup: new Set(['optgroup']),
	rt: new Set(['rt', 'rp']),
	rp: new Set(['rt', 'rp']),
	thead: new Set(['tbody', 'tfoot']),
	tbody: new Set(['tbody', 'tfoot']),
	tfoot: new Set(['tbody', 'tfoot']),
	tr: new Set(['tr', 'tbody', 'tfoot', 'thead']),
	td: new Set(['td', 'th', 'tr', 'tbody', 'tfoot', 'thead']),
	th: new Set(['td', 'th', 'tr', 'tbody', 'tfoot', 'thead']),
};

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

function isSpace(ch) {
	return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function isNameEnd(ch) {
	return ch === undefined || isSpace(ch) || ch === '>' || ch === '/' || ch === '=';
}

const NAMED_ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

/** Minimal entity decode — enough for id / ARIA comparisons. */
export function decodeEntities(value) {
	if (!value.includes('&')) return value;
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named ?? match;
	});
}

/**
 * @typedef {Object} HtmlAttribute
 * @property {string} name   lower-cased attribute name
 * @property {string|null} value  raw (still entity-encoded) value, null for a bare attribute
 * @property {string|null} quote the quote character used, or null
 * @property {number} line
 * @property {number} col
 *
 * @typedef {Object} HtmlElement
 * @property {'root'|'element'|'text'|'comment'} type
 * @property {string|null} tag
 * @property {HtmlAttribute[]} attributes
 * @property {string} text
 * @property {HtmlElement[]} children
 * @property {HtmlElement|null} parent
 * @property {number} line
 * @property {number} col
 */

/**
 * Tokenize + build a tree from an HTML document.
 *
 * Structural problems that a tokenizer can see (duplicate attributes,
 * an unterminated attribute value, a missing doctype) are reported as
 * messages here; the checks that need the tree run in `validateHtml`.
 *
 * @param {string} html
 * @returns {{ root: HtmlElement, messages: Array<object>, stats: object }}
 */
export function parseDocument(html) {
	const source = typeof html === 'string' ? html : '';
	const root = {
		type: 'root',
		tag: null,
		attributes: [],
		text: '',
		children: [],
		parent: null,
		line: 1,
		col: 1,
	};
	const messages = [];
	const stack = [root];
	const top = () => stack[stack.length - 1];
	const stats = { elements: 0, attributes: 0, ids: 0, doctype: null };

	let i = 0;
	let line = 1;
	let lineStart = 0;

	const pos = () => ({ line, col: i - lineStart + 1 });
	const advance = (to) => {
		for (let k = i; k < to; k += 1) {
			if (source[k] === '\n') {
				line += 1;
				lineStart = k + 1;
			}
		}
		i = to;
	};
	const emit = (rule, message, at) => {
		messages.push({ rule, message, line: at.line, col: at.col });
	};
	const pushText = (from, to, fromLine, fromLineStart) => {
		if (to <= from) return;
		const raw = source.slice(from, to);
		if (raw.trim() === '') return;
		const parent = top();
		parent.children.push({
			type: 'text',
			tag: null,
			attributes: [],
			text: raw,
			children: [],
			parent,
			line: fromLine,
			col: from - fromLineStart + 1,
		});
	};

	while (i < source.length) {
		const lt = source.indexOf('<', i);
		const textLine = line;
		const textLineStart = lineStart;
		if (lt === -1) {
			pushText(i, source.length, textLine, textLineStart);
			advance(source.length);
			break;
		}
		pushText(i, lt, textLine, textLineStart);
		const next = source[lt + 1];
		// Everything up to the `<` has been consumed, so `line` / `lineStart`
		// describe the tag itself from here on.
		advance(lt);

		// A `<` that does not open a tag is literal text.
		if (next === undefined || next === '<' || !/[a-zA-Z!/?]/.test(next)) {
			top().children.push({
				type: 'text',
				tag: null,
				attributes: [],
				text: '<',
				children: [],
				parent: top(),
				line,
				col: 1,
			});
			advance(1);
			continue;
		}

		const tagStart = pos();
		const atLine = line;
		const atCol = lt - textLineStart + 1;

		if (next === '!') {
			if (source.startsWith('<!--', lt)) {
				const end = source.indexOf('-->', lt + 4);
				advance(end === -1 ? source.length : end + 3);
				continue;
			}
			if (/^<!doctype/i.test(source.slice(lt, lt + 9))) {
				const end = source.indexOf('>', lt);
				const raw = source.slice(lt, end === -1 ? source.length : end);
				advance(end === -1 ? source.length : end + 1);
				stats.doctype = raw.trim();
				const name = raw.slice(9).trim().split(/[\s]+/)[0] ?? '';
				if (name.toLowerCase() !== 'html') {
					emit('bad-doctype', `Start tag doctype expected to be "html" but was "${name}".`, {
						line: atLine,
						col: atCol,
					});
				} else if (raw.trim().length > 15) {
					emit('obsolete-doctype', 'Obsolete doctype. Use "<!DOCTYPE html>" for HTML5.', {
						line: atLine,
						col: atCol,
					});
				}
				continue;
			}
			// Bogus comment / CDATA — skipped, as a browser skips it.
			if (source.startsWith('<![CDATA[', lt)) {
				const end = source.indexOf(']]>', lt);
				advance(end === -1 ? source.length : end + 3);
				continue;
			}
			const end = source.indexOf('>', lt);
			advance(end === -1 ? source.length : end + 1);
			continue;
		}

		if (next === '?') {
			const end = source.indexOf('>', lt);
			advance(end === -1 ? source.length : end + 1);
			continue;
		}

		if (next === '/') {
			advance(lt + 2);
			const nameStart = i;
			while (i < source.length && !isNameEnd(source[i])) i += 1;
			const name = source.slice(nameStart, i).toLowerCase();
			while (i < source.length && source[i] !== '>') i += 1;
			advance(Math.min(i + 1, source.length));

			if (name === '') {
				emit('stray-end-tag', 'Stray end tag.', tagStart);
				continue;
			}
			if (VOID_ELEMENTS.has(name)) {
				emit(
					'stray-end-tag',
					`Stray end tag: </${name}> for an element that cannot have content.`,
					tagStart,
				);
				continue;
			}

			let depth = -1;
			for (let k = stack.length - 1; k >= 1; k -= 1) {
				if (stack[k].tag === name) {
					depth = k;
					break;
				}
			}
			if (depth === -1) {
				emit('stray-end-tag', `Stray end tag: </${name}>.`, tagStart);
				continue;
			}
			// Generate implied end tags: `</ul>` closes an open `<li>`.
			while (stack.length - 1 > depth && OPTIONAL_END_TAGS.has(top().tag)) {
				stack.pop();
			}
			const misnested = [];
			for (let k = stack.length - 1; k > depth; k -= 1) misnested.push(stack[k].tag);
			if (misnested.length > 0) {
				emit(
					'misnested-tag',
					`Misnested tag: <${misnested.join('>, <')}>. </${name}> closes <${name}>.`,
					tagStart,
				);
			}
			stack.length = depth;
			continue;
		}

		// Start tag.
		advance(lt + 1);
		const nameStart = i;
		while (i < source.length && !isNameEnd(source[i])) i += 1;
		const name = source.slice(nameStart, i).toLowerCase();

		if (name === '') {
			// `< div>` and friends — treat the `<` as text.
			emit('stray-end-tag', 'Stray "<" or a tag with no name.', tagStart);
			continue;
		}

		const attributes = [];
		const seen = new Set();
		let selfClosing = false;
		while (i < source.length) {
			while (i < source.length && isSpace(source[i])) i += 1;
			if (source[i] === '>') {
				i += 1;
				break;
			}
			if (source.startsWith('/>', i)) {
				selfClosing = true;
				i += 2;
				break;
			}
			if (source[i] === '/') {
				i += 1;
				continue;
			}
			if (i >= source.length) break;
			const attrLine = line;
			const attrCol = i - lineStart + 1;
			const attrStart = i;
			while (
				i < source.length &&
				!isSpace(source[i]) &&
				source[i] !== '=' &&
				source[i] !== '>' &&
				source[i] !== '/'
			) {
				i += 1;
			}
			const rawName = source.slice(attrStart, i).toLowerCase();
			if (rawName === '') {
				i += 1;
				continue;
			}
			let value = null;
			let quote = null;
			const save = i;
			while (i < source.length && isSpace(source[i])) i += 1;
			if (source[i] === '=') {
				i += 1;
				while (i < source.length && isSpace(source[i])) i += 1;
				const q = source[i];
				if (q === '"' || q === "'") {
					quote = q;
					const close = source.indexOf(q, i + 1);
					if (close === -1) {
						value = source.slice(i + 1);
						emit('bad-value', `Unterminated attribute value for "${rawName}" on <${name}>.`, {
							line: attrLine,
							col: attrCol,
						});
						i = source.length;
					} else {
						value = source.slice(i + 1, close);
						i = close + 1;
					}
				} else {
					const vStart = i;
					while (i < source.length && !isSpace(source[i]) && source[i] !== '>') i += 1;
					value = source.slice(vStart, i);
				}
			} else {
				i = save;
			}
			if (seen.has(rawName)) {
				emit('duplicate-attribute', `Duplicate attribute "${rawName}" on <${name}>.`, {
					line: attrLine,
					col: attrCol,
				});
				continue;
			}
			seen.add(rawName);
			attributes.push({ name: rawName, value, quote, line: attrLine, col: attrCol });
		}

		stats.elements += 1;
		stats.attributes += attributes.length;

		// Implied end tags: optional end tags that the new start tag closes.
		while (stack.length > 1) {
			const current = top();
			const closes = IMPLIED_END[current.tag];
			if (closes?.has(name)) {
				stack.pop();
				continue;
			}
			// `<body>` closes an unclosed `<head>`.
			if (current.tag === 'head' && name === 'body') {
				stack.pop();
				continue;
			}
			break;
		}

		const element = {
			type: 'element',
			tag: name,
			attributes,
			text: '',
			children: [],
			parent: top(),
			line: atLine,
			col: atCol,
			selfClosing,
		};
		top().children.push(element);

		// HTML5 has no self-closing syntax: `<div/>` opens a div, and only
		// a void element ends at its own tag. Foreign content DOES use it,
		// so `<path/>` inside an `<svg>` ends there.
		const inForeign = stack.some((open) => open.type === 'element' && FOREIGN_ROOTS.has(open.tag));
		if (VOID_ELEMENTS.has(name) || (selfClosing && inForeign)) continue;
		stack.push(element);

		const rawText = RAW_TEXT_ELEMENTS.has(name) || RCDATA_ELEMENTS.has(name);
		if (rawText) {
			const close = source.toLowerCase().indexOf(`</${name}`, i);
			const end = close === -1 ? source.length : close;
			const text = source.slice(i, end);
			if (text !== '') {
				element.children.push({
					type: 'text',
					tag: null,
					attributes: [],
					text,
					children: [],
					parent: element,
					line,
					col: i - lineStart + 1,
				});
			}
			advance(end);
		}
	}

	for (let k = stack.length - 1; k >= 1; k -= 1) {
		const node = stack[k];
		emit('unclosed-element', `Unclosed element: <${node.tag}>.`, {
			line: node.line,
			col: node.col,
		});
	}

	stats.ids = countIds(root);
	return { root, messages, stats };
}

function countIds(root) {
	let total = 0;
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node.type === 'element' && node.attributes.some((attr) => attr.name === 'id')) total += 1;
		for (const child of node.children) if (child.type === 'element') stack.push(child);
	}
	return total;
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

function attributeValue(element, name) {
	const found = element.attributes.find((attr) => attr.name === name);
	return found ? decodeEntities(found.value ?? '') : null;
}

function hasAttribute(element, name) {
	return element.attributes.some((attr) => attr.name === name);
}

function ancestorsOf(node) {
	const out = [];
	let current = node.parent;
	while (current && current.type === 'element') {
		out.push(current);
		current = current.parent;
	}
	return out;
}

function isForeign(node) {
	if (FOREIGN_ROOTS.has(node.tag)) return true;
	return ancestorsOf(node).some((ancestor) => FOREIGN_ROOTS.has(ancestor.tag));
}

/** Every element under `root`, in DOCUMENT order. */
function elementsOf(root) {
	const out = [];
	const walk = (node) => {
		for (const child of node.children) {
			if (child.type !== 'element') continue;
			out.push(child);
			walk(child);
		}
	};
	walk(root);
	return out;
}

function textContent(node) {
	let out = '';
	const stack = [node];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current.type === 'text') out += current.text;
		for (const child of current.children) stack.push(child);
	}
	return out;
}

function isInteractive(element) {
	if (element.tag === 'a') return hasAttribute(element, 'href');
	if (element.tag === 'input') return attributeValue(element, 'type') !== 'hidden';
	if (element.tag === 'audio' || element.tag === 'video') return hasAttribute(element, 'controls');
	return INTERACTIVE_CONTENT.has(element.tag);
}

/** Model for one element's allowed children, or `null` when unchecked. */
function contentModelFor(tag) {
	if (Object.hasOwn(CONTENT_MODEL, tag)) return CONTENT_MODEL[tag];
	if (TEXT_ONLY_CONTENT.has(tag)) return 'text';
	return null;
}

/**
 * Every element name the tables above model.
 *
 * A name outside this set is a custom element: React can render one, and
 * "this engine has never heard of it" is not a conformance defect — so an
 * unknown element produces neither an unknown-attribute nor an
 * invalid-nesting finding. Only its `id` is still checked.
 */
const KNOWN_ELEMENTS = new Set([
	...Object.keys(CONTENT_MODEL),
	...Object.keys(REQUIRED_PARENTS),
	...Object.keys(ELEMENT_ATTRIBUTES),
	...VOID_ELEMENTS,
	...RAW_TEXT_ELEMENTS,
	...RCDATA_ELEMENTS,
]);

function childAllowed(model, childTag) {
	if (model === 'flow') return FLOW_CONTENT.has(childTag);
	if (model === 'phrasing') return PHRASING_CONTENT.has(childTag);
	if (model === 'text') return false;
	return model.includes(childTag);
}

function allowedAttributeNames(tag) {
	const specific = ELEMENT_ATTRIBUTES[tag];
	if (!specific) return null;
	return new Set([...GLOBAL_ATTRIBUTES, ...specific]);
}

function checkAttributes(element, messages) {
	const allowed = allowedAttributeNames(element.tag);
	for (const attr of element.attributes) {
		const name = attr.name;
		const at = { line: attr.line, col: attr.col };
		const value = decodeEntities(attr.value ?? '');

		if (name.startsWith('data-') || name.startsWith('aria-')) {
			// Custom data attributes are always allowed; ARIA is checked below.
		} else if (name.startsWith('on')) {
			messages.push({
				rule: 'unknown-attribute',
				message: `Inline event handler attribute "${name}" is not allowed on <${element.tag}> by this project's contract.`,
				...at,
			});
			continue;
		} else if (allowed && !allowed.has(name)) {
			messages.push({
				rule: 'unknown-attribute',
				message: `Attribute "${name}" not allowed on element "${element.tag}" at this point.`,
				...at,
			});
			continue;
		}

		if (BOOLEAN_ATTRIBUTES.has(name) && attr.value !== null) {
			const lowered = value.toLowerCase();
			if (lowered !== '' && lowered !== name) {
				messages.push({
					rule: 'bad-value',
					message: `Bad value "${value}" for attribute "${name}"; it is a boolean attribute and takes no value other than "" or "${name}".`,
					...at,
				});
				continue;
			}
		}

		const enumValues = ENUMERATED_ATTRIBUTES.get(`${element.tag}:${name}`);
		if (enumValues && attr.value !== null) {
			// `type` on a <script> is either a keyword or a MIME type: this
			// project emits `application/ld+json` for structured data, so a
			// well-formed MIME string is accepted and anything else is not.
			const isScriptType = element.tag === 'script' && name === 'type';
			const lowered = value.toLowerCase();
			const tokens = lowered.split(/\s+/).filter(Boolean);
			// Every other enumerated attribute (`rel` and friends) is a
			// token list, so an unknown token inside a valid list is still a
			// bad value.
			const accepted = isScriptType
				? enumValues.includes(lowered) || MIME_TYPE_PATTERN.test(lowered)
				: tokens.length > 0 && tokens.every((token) => enumValues.includes(token));
			if (!accepted) {
				messages.push({
					rule: 'bad-value',
					message: `Bad value "${value}" for attribute "${name}" on element "${element.tag}".`,
					...at,
				});
				continue;
			}
		}

		const minNumeric = NUMERIC_ATTRIBUTES.get(`${element.tag}:${name}`);
		if (minNumeric !== undefined && attr.value !== null) {
			if (!/^\d+$/.test(value) || (minNumeric !== null && Number(value) < minNumeric)) {
				messages.push({
					rule: 'bad-value',
					message: `Bad value "${value}" for attribute "${name}" on element "${element.tag}"; expected a non-negative integer.`,
					...at,
				});
				continue;
			}
		}

		const mayBeEmpty = name === 'alt' || name === 'class' || name.startsWith('data-');
		if (attr.value !== null && value === '' && !BOOLEAN_ATTRIBUTES.has(name) && !mayBeEmpty) {
			messages.push({
				rule: 'bad-value',
				message: `Bad value "" for attribute "${name}" on element "${element.tag}"; the attribute must not be empty.`,
				...at,
			});
		}
	}
}

function checkRequiredAttributes(element, messages) {
	const required = REQUIRED_ATTRIBUTES[element.tag] ?? [];
	for (const name of required) {
		if (!hasAttribute(element, name)) {
			messages.push({
				rule: 'missing-attribute',
				message: `Element "${element.tag}" missing required attribute "${name}".`,
				line: element.line,
				col: element.col,
			});
		}
	}
	if (
		element.tag === 'input' &&
		attributeValue(element, 'type') === 'image' &&
		!hasAttribute(element, 'alt')
	) {
		messages.push({
			rule: 'missing-attribute',
			message: 'Element "input" missing required attribute "alt" for type="image".',
			line: element.line,
			col: element.col,
		});
	}
	if (element.tag === 'meta') {
		const charset = attributeValue(element, 'charset');
		if (charset !== null && charset.toLowerCase() !== 'utf-8') {
			messages.push({
				rule: 'bad-value',
				message: `Bad value "${charset}" for attribute "charset" on element "meta"; this project's documents are UTF-8.`,
				line: element.line,
				col: element.col,
			});
		}
	}
}

function checkNesting(element, messages) {
	const parent = element.parent;
	// A hoisted <style> in the body is framework-owned markup: React 19
	// emits `<div hidden><style>…</style></div>` for streaming suspense
	// styles (every route renders through React's streaming SSR), and the
	// Nu validator flags it. The documents this project ships cannot avoid
	// it, so it is a documented divergence rather than a finding — see the
	// `html_standards.known_limits` entry in quality/profile.yaml.
	const isHoistedStyle =
		element.tag === 'style' &&
		Boolean(parent) &&
		parent.type === 'element' &&
		contentModelFor(parent.tag) === 'flow' &&
		ancestorsOf(element).some((node) => node.tag === 'body');
	if (parent && parent.type === 'element' && KNOWN_ELEMENTS.has(element.tag) && !isHoistedStyle) {
		const required = REQUIRED_PARENTS[element.tag];
		if (required && !satisfiesRequiredParent(element)) {
			messages.push({
				rule: 'invalid-nesting',
				message: `Element "${element.tag}" not allowed as child of element "${parent.tag}".`,
				line: element.line,
				col: element.col,
			});
		} else {
			const model = contentModelFor(parent.tag);
			if (model !== null && !childAllowed(model, element.tag)) {
				messages.push({
					rule: 'invalid-nesting',
					message: `Element "${element.tag}" not allowed as child of element "${parent.tag}".`,
					line: element.line,
					col: element.col,
				});
			}
		}
	}

	// No interactive content inside a link or a button.
	if (element.tag === 'a' || element.tag === 'button') {
		for (const descendant of elementsOf(element)) {
			if (descendant === element) continue;
			if (isInteractive(descendant)) {
				messages.push({
					rule: 'invalid-nesting',
					message: `Element "${descendant.tag}" not allowed as child of element "${element.tag}"; interactive content must not be nested inside a link or a button.`,
					line: descendant.line,
					col: descendant.col,
				});
				break;
			}
		}
	}

	// No nested forms.
	if (element.tag === 'form' && ancestorsOf(element).some((ancestor) => ancestor.tag === 'form')) {
		messages.push({
			rule: 'invalid-nesting',
			message: 'Element "form" not allowed as child of element "form".',
			line: element.line,
			col: element.col,
		});
	}
}

/* ------------------------------------------------------------------ *
 * validateHtml
 * ------------------------------------------------------------------ */

/**
 * Validate one HTML document.
 *
 * @param {string} html
 * @param {{ severities?: Record<string, 'error'|'warning'>, routeId?: string }} [options]
 * @returns {{ messages: Array<object>, stats: object, severities: object }}
 */
export function validateHtml(html, options = {}) {
	const severities = { ...DEFAULT_SEVERITIES, ...(options.severities ?? {}) };
	const routeId = options.routeId ?? null;
	const { root, messages: parseMessages, stats } = parseDocument(html);

	const messages = parseMessages.map((message) => ({
		rule: message.rule,
		message: message.message,
		line: message.line,
		col: message.col,
	}));

	if (stats.doctype === null) {
		messages.push({
			rule: 'missing-doctype',
			message: 'Document does not have a "<!DOCTYPE html>".',
			line: 1,
			col: 1,
		});
	}

	const elements = elementsOf(root);

	// Document structure.
	for (const tag of ['html', 'head', 'body', 'title']) {
		const found = elements.filter((element) => element.tag === tag);
		if (found.length === 0) {
			messages.push({
				rule: 'missing-element',
				message: `Document is missing the required <${tag}> element.`,
				line: 1,
				col: 1,
			});
		} else if (found.length > 1) {
			for (const extra of found.slice(1)) {
				messages.push({
					rule: 'duplicate-element',
					message: `Element <${tag}> must not be repeated (${found.length} occurrences).`,
					line: extra.line,
					col: extra.col,
				});
			}
		}
	}

	// `id` uniqueness and shape, plus the IDREF graph.
	const idOwners = new Map();
	for (const element of elements) {
		const id = attributeValue(element, 'id');
		if (id === null) continue;
		if (id === '') {
			messages.push({
				rule: 'bad-id',
				message: 'Bad value "" for attribute "id"; an id must not be empty.',
				line: element.line,
				col: element.col,
			});
			continue;
		}
		if (/\s/.test(id)) {
			messages.push({
				rule: 'bad-id',
				message: `Bad value "${id}" for attribute "id"; an id must not contain whitespace.`,
				line: element.line,
				col: element.col,
			});
			continue;
		}
		const first = idOwners.get(id);
		if (first) {
			messages.push({
				rule: 'duplicate-id',
				message: `Duplicate ID "${id}" (also on <${first.tag}> at line ${first.line}).`,
				line: element.line,
				col: element.col,
			});
		} else {
			idOwners.set(id, element);
		}
	}

	const byTag = new Map();
	for (const element of elements) {
		const list = byTag.get(element.tag);
		if (list) list.push(element);
		else byTag.set(element.tag, [element]);
	}

	// An empty <title> is a real defect (a SERP entry with no title).
	for (const title of byTag.get('title') ?? []) {
		if (textContent(title).trim() === '') {
			messages.push({
				rule: 'empty-title',
				message: 'Element <title> must not be empty.',
				line: title.line,
				col: title.col,
			});
		}
	}

	for (const element of elements) {
		if (isForeign(element)) continue;
		checkAttributes(element, messages);
		checkRequiredAttributes(element, messages);
		checkNesting(element, messages);

		// IDREF attributes must resolve.
		for (const attr of element.attributes) {
			const raw = decodeEntities(attr.value ?? '').trim();
			const idrefList = IDREF_LIST_ATTRIBUTES.has(attr.name);
			const idrefSingle =
				attr.name === 'for' ||
				attr.name === 'headers' ||
				attr.name === 'list' ||
				attr.name === 'form';
			if (!idrefList && !idrefSingle) continue;
			if (raw === '') {
				messages.push({
					rule: 'bad-idref',
					message: `Bad value "" for attribute "${attr.name}" on element "${element.tag}"; an ID reference must not be empty.`,
					line: attr.line,
					col: attr.col,
				});
				continue;
			}
			for (const token of raw.split(/\s+/)) {
				const target = idOwners.get(token);
				if (!target) {
					messages.push({
						rule: 'bad-idref',
						message: `Bad value "${token}" for attribute "${attr.name}" on element "${element.tag}"; no element in this document has that id.`,
						line: attr.line,
						col: attr.col,
					});
					continue;
				}
				if (attr.name === 'for' && !FORM_ASSOCIABLE.has(target.tag)) {
					messages.push({
						rule: 'bad-idref',
						message: `Bad value "${token}" for attribute "for" on element "label"; <${target.tag}> is not a labelable form control.`,
						line: attr.line,
						col: attr.col,
					});
				}
			}
		}
	}

	// Heading order: a document that starts at <h2> or skips a level is a
	// warning, not an error — a page may legitimately lead with a section.
	let previousLevel = 0;
	for (const element of elements) {
		const level = /^h([1-6])$/.exec(element.tag ?? '');
		if (!level) continue;
		const current = Number(level[1]);
		if (previousLevel !== 0 && current > previousLevel + 1) {
			messages.push({
				rule: 'heading-level-skip',
				message: `Heading level should be h${previousLevel + 1} before h${current}.`,
				line: element.line,
				col: element.col,
			});
		}
		previousLevel = current;
	}

	const classified = messages
		.map((message) => ({
			...message,
			severity: severities[message.rule] ?? 'error',
			nuType: RULE_CATALOGUE[message.rule]?.nuType ?? 'unknown',
			routeId,
		}))
		.sort((a, b) => a.line - b.line || a.col - b.col);

	return {
		messages: classified,
		stats: {
			...stats,
			errors: classified.filter((message) => message.severity === 'error').length,
			warnings: classified.filter((message) => message.severity === 'warning').length,
		},
		severities,
	};
}

/* ------------------------------------------------------------------ *
 * Route inventory evaluation
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} HtmlObservation
 * @property {string} routeId
 * @property {string} path
 * @property {number|null} status
 * @property {string} html
 * @property {string|null} contentType
 * @property {boolean} requestFailed
 * @property {string} [note]
 */

/**
 * Evaluate every declared route against its observation.
 *
 * Pure: everything it reads is passed in, so the fixture suite can drive
 * it without a Worker and the SSR suite can drive it with one.
 *
 * @param {{ manifest: object, observations: HtmlObservation[], severities?: object }} input
 * @returns {{ rows: object[], findings: object[], stats: object }}
 */
export function evaluateRoutes({ manifest, observations, severities }) {
	const rows = [];
	const findings = [];
	const byRoute = new Map(observations.map((observation) => [observation.routeId, observation]));

	for (const entry of manifest.routes) {
		const observation = byRoute.get(entry.route_id);

		if (entry.mode === 'excluded') {
			rows.push({
				route_id: entry.route_id,
				path: entry.path,
				mode: 'excluded',
				status: observation?.status ?? null,
				errors: 0,
				warnings: 0,
				reason: entry.reason ?? null,
				messages: [],
			});
			continue;
		}

		if (!observation) {
			findings.push({
				rule: 'route.unobserved',
				severity: 'error',
				route_id: entry.route_id,
				path: entry.path,
				message: `Route ${entry.path} was declared renderable but no observation was collected for it; an unchecked route is not a passing route.`,
			});
			rows.push({
				route_id: entry.route_id,
				path: entry.path,
				mode: 'render',
				status: null,
				errors: 1,
				warnings: 0,
				reason: null,
				messages: [],
			});
			continue;
		}

		if (observation.requestFailed || observation.status === null) {
			findings.push({
				rule: 'route.request-failed',
				severity: 'error',
				route_id: entry.route_id,
				path: entry.path,
				message: `Route ${entry.path} could not be fetched: ${observation.note ?? 'no response'}.`,
			});
			rows.push({
				route_id: entry.route_id,
				path: entry.path,
				mode: 'render',
				status: observation.status,
				errors: 1,
				warnings: 0,
				reason: null,
				messages: [],
			});
			continue;
		}

		if (observation.status < 200 || observation.status >= 300) {
			findings.push({
				rule: 'route.not-rendered',
				severity: 'error',
				route_id: entry.route_id,
				path: entry.path,
				message: `Route ${entry.path} answered ${observation.status}; a declared renderable route must answer with a 2xx HTML document.`,
			});
		}

		if (
			observation.contentType !== null &&
			!String(observation.contentType).toLowerCase().includes('text/html')
		) {
			findings.push({
				rule: 'route.not-html',
				severity: 'error',
				route_id: entry.route_id,
				path: entry.path,
				message: `Route ${entry.path} answered content-type "${observation.contentType}" instead of text/html.`,
			});
		}

		const result = validateHtml(observation.html, {
			severities,
			routeId: entry.route_id,
		});

		for (const message of result.messages) {
			findings.push({
				rule: `html.${message.rule}`,
				severity: message.severity,
				route_id: entry.route_id,
				path: entry.path,
				line: message.line,
				col: message.col,
				nu_type: message.nuType,
				message: message.message,
			});
		}

		rows.push({
			route_id: entry.route_id,
			path: entry.path,
			mode: 'render',
			status: observation.status,
			bytes: observation.html.length,
			elements: result.stats.elements,
			errors: result.stats.errors,
			warnings: result.stats.warnings,
			reason: null,
			messages: result.messages.map((message) => ({
				rule: message.rule,
				severity: message.severity,
				line: message.line,
				col: message.col,
				message: message.message,
			})),
		});
	}

	// A declared route with no finding, and a finding for a route nobody
	// declared, are both failures: the first is a gate nobody can read,
	// the second is a route the manifest forgot.
	const declared = new Set(manifest.routes.map((entry) => entry.route_id));
	for (const finding of [...findings]) {
		if (!declared.has(finding.route_id)) {
			findings.push({
				rule: 'route.undeclared',
				severity: 'error',
				route_id: finding.route_id,
				path: finding.path,
				message: `A finding was produced for route ${finding.path}, which the manifest does not declare.`,
			});
		}
	}

	applyWaivers({ manifest, findings });

	const errors = findings.filter((finding) => finding.severity === 'error' && !finding.waived);
	const warnings = findings.filter((finding) => finding.severity === 'warning' && !finding.waived);

	return {
		rows,
		findings,
		stats: {
			routes: manifest.routes.length,
			rendered: rows.filter((row) => row.mode === 'render').length,
			excluded: rows.filter((row) => row.mode === 'excluded').length,
			errors: errors.length,
			warnings: warnings.length,
		},
	};
}

/**
 * Apply the manifest's waiver ledger.
 *
 * A waiver may name the routes it covers (`route_id`, or `*`) and the
 * message shape it covers (`message_pattern`, a regular expression
 * source). At least one of the two is required, so a blanket waiver that
 * mutes a whole rule across the whole site cannot be written by accident.
 *
 * A waiver that suppresses nothing is an ERROR: an entry that stops
 * matching (because the defect was fixed, or because the message text
 * changed) must not sit in the manifest turning a real failure green.
 */
function applyWaivers({ manifest, findings }) {
	const waivers = manifest.waivers ?? [];
	for (const waiver of waivers) {
		const key = `${waiver.route_id ?? '*'}|${waiver.rule}${
			waiver.message_pattern ? `|/${waiver.message_pattern}/` : ''
		}`;
		let pattern = null;
		if (waiver.message_pattern) {
			try {
				pattern = new RegExp(waiver.message_pattern);
			} catch (error) {
				findings.push({
					rule: 'waiver.malformed',
					severity: 'error',
					route_id: waiver.route_id ?? null,
					path: null,
					message: `Waiver for ${key} has an invalid message_pattern: ${
						error instanceof Error ? error.message : String(error)
					}`,
				});
				continue;
			}
		}
		const matched = findings.filter(
			(finding) =>
				finding.rule === waiver.rule &&
				(waiver.route_id === undefined ||
					waiver.route_id === '*' ||
					finding.route_id === waiver.route_id) &&
				(pattern === null || pattern.test(String(finding.message))),
		);
		if (matched.length === 0) {
			findings.push({
				rule: 'waiver.unused',
				severity: 'error',
				route_id: waiver.route_id ?? null,
				path: null,
				message: `Waiver for ${key} suppresses no finding; remove it (a waiver must never outlive the defect it described).`,
			});
			continue;
		}
		for (const finding of matched) {
			finding.waived = true;
			finding.waiver_reason = waiver.reason;
		}
	}
}

/** Findings that count against the exit code (waived findings never do). */
export function effectiveFindings(findings) {
	return findings.filter((finding) => finding.severity === 'error');
}

/* ------------------------------------------------------------------ *
 * Report rendering
 * ------------------------------------------------------------------ */

export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Text report — the operator surface (`pnpm run html:standards:check`). */
export function renderTextReport(result) {
	const lines = [];
	lines.push(`HTML standards gate (${result.profile ?? 'nu-html5-subset'})`);
	lines.push(
		`routes: ${result.stats.rendered} rendered / ${result.stats.excluded} excluded / ${result.findings.length} finding(s)`,
	);
	for (const row of result.rows) {
		const verdict =
			row.mode === 'excluded'
				? 'EXCLUDED'
				: row.errors > 0
					? 'FAIL'
					: row.warnings > 0
						? 'WARN'
						: 'PASS';
		const detail =
			row.mode === 'excluded'
				? row.reason
				: `${row.elements ?? 0} element(s), ${row.bytes ?? 0} byte(s)`;
		lines.push(`  ${verdict.padEnd(8)} ${row.path.padEnd(28)} ${detail}`);
	}
	if (result.findings.length > 0) {
		lines.push('');
		lines.push(`findings (${result.findings.length})`);
		for (const finding of result.findings) {
			const at = finding.line
				? ` (${finding.path} line ${finding.line})`
				: ` (${finding.path ?? 'manifest'})`;
			lines.push(
				`  ${finding.severity === 'error' ? 'FAIL' : 'WARN'}  ${finding.rule}${at}: ${finding.message}`,
			);
		}
	}
	return lines.join('\n');
}

/** Self-contained HTML report — the screenshot source. */
export function renderHtmlReport(result, meta = {}) {
	const rows = result.rows
		.map((row) => {
			const verdict =
				row.mode === 'excluded'
					? 'excluded'
					: row.errors > 0
						? 'fail'
						: row.warnings > 0
							? 'warn'
							: 'pass';
			return `<tr class="${verdict}"><td>${escapeHtml(row.path)}</td><td class="c">${verdict}</td><td class="c">${row.status ?? '—'}</td><td class="c">${row.elements ?? 0}</td><td class="c">${row.errors}</td><td class="c">${row.warnings}</td><td>${escapeHtml(row.reason ?? (row.bytes !== undefined ? `${row.bytes} B` : ''))}</td></tr>`;
		})
		.join('\n');

	const findings = result.findings
		.map(
			(finding) =>
				`<tr><td class="c">${escapeHtml(finding.severity)}</td><td>${escapeHtml(finding.rule)}</td><td>${escapeHtml(finding.path ?? 'manifest')}</td><td class="c">${escapeHtml(finding.line ?? '')}</td><td>${escapeHtml(finding.message)}</td></tr>`,
		)
		.join('\n');

	const ruleRows = Object.entries(result.rules ?? {})
		.map(
			([rule, meta2]) =>
				`<tr><td>${escapeHtml(rule)}</td><td class="c">${escapeHtml(meta2.severity)}</td><td>${escapeHtml(meta2.nu_type ?? '')}</td><td>${escapeHtml(meta2.reason ?? '')}</td></tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HTML standards gate — Nu Validator 互換サブセット</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; font: 13px/1.5 -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; color: #16150f; background: #f6f4ec; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6a665a; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 18px; background: #fffdf7; }
  th, td { border: 1px solid #d9d4c2; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #ece8d9; font-weight: 600; }
  td.c { text-align: center; white-space: nowrap; }
  tr.fail td.c:nth-child(2) { color: #a3231d; font-weight: 700; }
  tr.warn td.c:nth-child(2) { color: #8a5a00; font-weight: 700; }
  tr.pass td.c:nth-child(2) { color: #2c6a34; font-weight: 700; }
  tr.excluded td.c:nth-child(2) { color: #6a665a; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  pre { background: #16150f; color: #f6f4ec; padding: 12px; overflow-x: auto; }
  footer { color: #6a665a; border-top: 1px solid #d9d4c2; padding-top: 12px; }
</style>
</head>
<body>
<h1>HTML standards gate — Nu Validator 互換サブセット（Issue #412）</h1>
<p class="sub">SSR 結果の HTML をオフライン検証する gate の実行結果。external validator には何も送信しない。
${meta.generatedAt ? `生成: ${escapeHtml(meta.generatedAt)}` : ''}${meta.baseUrl ? ` / origin: ${escapeHtml(meta.baseUrl)}` : ''}</p>

<h2>route 判定</h2>
<table>
<thead><tr><th>path</th><th class="c">verdict</th><th class="c">status</th><th class="c">elements</th><th class="c">error</th><th class="c">warn</th><th>note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>

<h2>finding (${result.findings.length})</h2>
${
	result.findings.length > 0
		? `<table>
<thead><tr><th class="c">severity</th><th>rule</th><th>route</th><th class="c">line</th><th>message</th></tr></thead>
<tbody>
${findings}
</tbody>
</table>`
		: '<p class="sub">finding なし。</p>'
}

${meta.extraHtml ? meta.extraHtml : ''}
${
	Object.keys(result.rules ?? {}).length > 0
		? `<h2>rule 一覧（severity と根拠は manifest が所有）</h2>
<table>
<thead><tr><th>rule</th><th class="c">severity</th><th>Nu message type</th><th>reason</th></tr></thead>
<tbody>
${ruleRows}
</tbody>
</table>`
		: ''
}

${
	meta.reproduction?.length
		? `<h2>再現コマンド</h2>
<pre>${escapeHtml(meta.reproduction.join('\n'))}</pre>`
		: ''
}

<footer>my-web-2026 · Issue #412 · offline report generated by scripts/make-html-nu-validator-report.mjs
(no network, no secret, no production D1/R2) · committed as docs/verification/standards/html-nu-validator.webp.</footer>
</body>
</html>
`;
}
