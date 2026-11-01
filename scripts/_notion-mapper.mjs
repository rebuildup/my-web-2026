/**
 * Notion page → snapshot record (Issue #765).
 *
 * Lives on the operator side (`scripts/`) rather than in `src/` because the
 * conversion runs at build time, never at request time: the Worker only
 * validates and projects what this module produced. Keeping it here is what
 * lets the sync run as a plain Node script — the repository has no TypeScript
 * runtime for `src/` modules, and duplicating the mapping in both places
 * would be the worse trade.
 *
 * The gate is still `src/portfolio/notion/contract.ts`: this module's output
 * is validated by the same schema in a test, and the reader refuses anything
 * that does not validate. A mapping bug therefore fails closed — the CMS
 * publishes nothing — instead of publishing a malformed record.
 *
 * Two conversion decisions are load-bearing (ADR-0018 §2.3):
 *
 *   * **Markdown is the exchange format.** Notion's block model is the
 *     authoring surface; the record carries Markdown because that is what
 *     `src/portfolio/markdown.lexer.ts` renders and what a reviewer can read
 *     in a diff. The conversion is deliberately not total: an unsupported
 *     block is an error, never a dropped node. A silently dropped paragraph
 *     reads exactly like a paragraph the author never wrote.
 *   * **Section headings are a fixed vocabulary.** The public page renders
 *     six sections, so a level-2 heading must name one of them. Guessing
 *     which section an author meant is how narrative lands under the wrong
 *     label.
 */

/** Heading text → section. Both spellings are accepted; nothing is inferred. */
const SECTION_HEADINGS = new Map([
	['motivation', 'motivation'],
	['動機', 'motivation'],
	['architecture', 'architecture'],
	['設計', 'architecture'],
	['constraints', 'constraints'],
	['制約', 'constraints'],
	['implementation', 'implementation'],
	['実装', 'implementation'],
	['evidence', 'evidence'],
	['根拠', 'evidence'],
	['retrospective', 'retrospective'],
	['振り返り', 'retrospective'],
]);

/** Mirrors `PORTFOLIO_FACETS`; the contract rejects anything else. */
export const PORTFOLIO_FACETS = ['develop', 'video', 'design', 'other'];

/** Mirrors `PORTFOLIO_LINK_KINDS`; the contract rejects anything else. */
export const PORTFOLIO_LINK_KINDS = [
	'repo',
	'demo',
	'release',
	'article',
	'shop',
	'video',
	'other',
];

/** Mirrors `SLUG_REGEX` in `src/portfolio/schema.ts`. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

function asObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function plainText(richText) {
	const parts = [];
	for (const node of asArray(richText)) {
		const object = asObject(node);
		if (!object) continue;
		if (object.type === 'text') {
			const content = asObject(object.text)?.content;
			if (typeof content === 'string') parts.push(content);
			continue;
		}
		// A mention or an equation is not plain text: refusing it keeps a
		// user id from arriving in a published title by accident.
		throw new Error(`unsupported rich text: ${String(object.type)}`);
	}
	return parts.join('');
}

function renderNode(node) {
	const object = asObject(node) ?? {};
	const annotations = asObject(object.annotations) ?? {};
	const text = plainText([node]);
	const link = asObject(asObject(object.text)?.link)?.url;
	let rendered = text.replace(/([\\`*_[\]<>])/gu, '\\$1');
	if (annotations.code === true) rendered = `\`${text}\``;
	if (annotations.bold === true) rendered = `**${rendered}**`;
	if (annotations.italic === true) rendered = `_${rendered}_`;
	if (annotations.strikethrough === true) rendered = `~~${rendered}~~`;
	return typeof link === 'string' ? `[${rendered}](${link})` : rendered;
}

function richTextToMarkdown(richText) {
	return asArray(richText).map(renderNode).join('');
}

/**
 * `plainText` throws on a node it cannot read. A heading is not worth
 * aborting the whole sync over, so this turns that into a refusal the
 * caller can record with a location.
 */
function safePlainText(richText) {
	try {
		return { ok: true, text: plainText(richText) };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : 'unsupported rich text' };
	}
}

class SectionWriter {
	constructor() {
		this.buffers = new Map();
		this.current = null;
		this.list = null;
	}

	open(section) {
		this.flushList();
		this.current = section;
		if (!this.buffers.has(section)) this.buffers.set(section, []);
	}

	currentSection() {
		return this.current;
	}

	listItem(glyph, text) {
		if (text.length === 0) return;
		const type = glyph === '-' ? 'bullet' : 'ordered';
		if (this.list === null || this.list.type !== type) {
			this.flushList();
			this.list = { type, items: [] };
		}
		this.list.items.push(text);
	}

	block(markdown) {
		this.flushList();
		if (markdown.length === 0 || this.current === null) return;
		this.buffers.get(this.current)?.push(markdown);
	}

	flushList() {
		const list = this.list;
		if (list === null) return;
		if (this.current !== null) {
			const rendered = list.items
				.map((item, index) => `${list.type === 'bullet' ? '-' : `${index + 1}.`} ${item}`)
				.join('\n');
			this.buffers.get(this.current)?.push(rendered);
		}
		this.list = null;
	}

	finish() {
		this.flushList();
		const result = {
			motivation: '',
			architecture: null,
			constraints: null,
			implementation: null,
			evidence: null,
			retrospective: null,
		};
		for (const [section, blocks] of this.buffers) {
			const body = blocks.join('\n\n').trim();
			result[section] = body.length > 0 ? body : null;
		}
		return { ...result, motivation: result.motivation ?? '' };
	}
}

/**
 * Convert the page body to section Markdown, or report why it cannot.
 * @returns {{ ok: true, sections: Record<string, string|null> } | { ok: false, errors: Array<{code:string,at:string,expected:string}> }}
 */
export function blocksToSections(blocks) {
	const errors = [];
	const writer = new SectionWriter();

	for (const raw of blocks) {
		const block = asObject(raw);
		if (!block) continue;
		const at = `block ${typeof block.id === 'string' ? block.id : '?'}`;
		const type = String(block.type ?? '');

		if (type === 'heading_2') {
			const heading = safePlainText(asObject(block.heading_2)?.rich_text);
			if (!heading.ok) {
				errors.push({
					code: 'unsupported_rich_text',
					at,
					expected: 'plain text in a section heading',
				});
				continue;
			}
			const label = heading.text.trim().toLowerCase();
			const section = SECTION_HEADINGS.get(label);
			if (section === undefined) {
				errors.push({
					code: 'unknown_section_heading',
					at,
					expected: `one of ${[...SECTION_HEADINGS.keys()].join(', ')}`,
				});
				continue;
			}
			writer.open(section);
			continue;
		}

		if (writer.currentSection() === null) {
			errors.push({
				code: 'content_before_first_section',
				at,
				expected: 'a level-2 heading naming the first section',
			});
			continue;
		}

		// A mention or an equation inside a paragraph cannot be rendered as
		// Markdown text here. Refusing the block keeps the author's intent
		// visible; dropping the run would publish a sentence with a hole.
		try {
			appendBlock(writer, type, block, at, errors);
		} catch (error) {
			errors.push({
				code: 'unsupported_rich_text',
				at,
				expected: error instanceof Error ? error.message : 'plain text',
			});
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, sections: writer.finish() };
}

function appendBlock(writer, type, block, at, errors) {
	switch (type) {
		case 'paragraph':
			writer.block(richTextToMarkdown(asObject(block.paragraph)?.rich_text).trim());
			break;
		case 'heading_3': {
			const text = richTextToMarkdown(asObject(block.heading_3)?.rich_text).trim();
			if (text.length > 0) writer.block(`### ${text}`);
			break;
		}
		case 'bulleted_list_item':
			writer.listItem(
				'-',
				richTextToMarkdown(asObject(block.bulleted_list_item)?.rich_text).trim(),
			);
			break;
		case 'numbered_list_item':
			writer.listItem(
				'1.',
				richTextToMarkdown(asObject(block.numbered_list_item)?.rich_text).trim(),
			);
			break;
		case 'quote': {
			const text = richTextToMarkdown(asObject(block.quote)?.rich_text).trim();
			if (text.length > 0) writer.block(`> ${text}`);
			break;
		}
		case 'code': {
			const payload = asObject(block.code);
			const language = typeof payload?.language === 'string' ? payload.language : 'text';
			writer.block(`\`\`\`${language}\n${plainText(payload?.rich_text)}\n\`\`\``);
			break;
		}
		case 'divider':
			writer.block('---');
			break;
		case 'image':
			// Deliberate refusal: an image needs a byte migration into R2
			// and a rights record before it can be served, and neither
			// exists yet (Issue #766). Publishing the text around a missing
			// image would be a silent degradation.
			errors.push({
				code: 'image_block_unsupported',
				at,
				expected: 'text-only page (media migration is Issue #766)',
			});
			break;
		default:
			errors.push({ code: 'unsupported_block', at, expected: `a supported block, got "${type}"` });
	}
}

function property(page, name) {
	return asObject(asObject(page.properties)?.[name]);
}

function requireRichText(page, name, errors, max) {
	const value = property(page, name);
	const type = String(value?.type ?? '');
	if (value === null || (type !== 'rich_text' && type !== 'title')) {
		errors.push({
			code: 'missing_property',
			at: `property ${name}`,
			expected: 'a rich text property',
		});
		return '';
	}
	const text = plainText(value[type]).trim();
	if (text.length === 0) {
		errors.push({ code: 'empty_property', at: `property ${name}`, expected: 'a non-empty value' });
		return '';
	}
	if (text.length > max) {
		errors.push({
			code: 'property_too_long',
			at: `property ${name}`,
			expected: `at most ${max} characters`,
		});
	}
	return text;
}

function selectName(page, name) {
	const select = asObject(property(page, name)?.select);
	const selected = select?.name;
	return typeof selected === 'string' ? selected.trim() : null;
}

function multiNames(page, name) {
	return asArray(property(page, name)?.multi_select)
		.map((entry) => asObject(entry)?.name)
		.filter((entry) => typeof entry === 'string')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function numberValue(page, name) {
	const number = property(page, name)?.number;
	return typeof number === 'number' && Number.isFinite(number) ? Math.trunc(number) : null;
}

function booleanValue(page, name, fallback) {
	const checkbox = property(page, name)?.checkbox;
	return typeof checkbox === 'boolean' ? checkbox : fallback;
}

function richTextProperty(page, name) {
	const payload = property(page, name)?.rich_text;
	return Array.isArray(payload) ? richTextToMarkdown(payload).trim() : '';
}

/**
 * `Links` is one line per link: `<kind> <url> [label]`. A dedicated Notion
 * database would be the richer model, but it is a second data source and a
 * second review surface for two or three rows; this keeps authoring inside
 * the page and the parse strict.
 */
export function parseLinks(raw) {
	const links = [];
	const errors = [];
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const [kind, url, ...rest] = trimmed.split(/\s+/u);
		if (!PORTFOLIO_LINK_KINDS.includes(kind) || url === undefined) {
			errors.push({
				code: 'malformed_link',
				at: 'property Links',
				expected: '<kind> <url> [label]',
			});
			continue;
		}
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			errors.push({
				code: 'malformed_link_url',
				at: 'property Links',
				expected: 'an absolute https URL',
			});
			continue;
		}
		if (parsed.protocol !== 'https:') {
			errors.push({ code: 'insecure_link', at: 'property Links', expected: 'https' });
			continue;
		}
		const label = rest.join(' ').trim();
		links.push({
			kind,
			label: label.length > 0 ? label : null,
			url: parsed.toString(),
			displayOrder: links.length,
		});
	}
	return errors.length > 0 ? { ok: false, errors } : { ok: true, links };
}

/**
 * Map every page, collecting refusals instead of stopping at the first.
 *
 * An operator fixing an authoring problem wants the whole list; stopping at
 * one error turns a single review pass into several.
 *
 * Lives here rather than in the CLI so the parity test can exercise the
 * exact function the sync runs, without pulling `node:fs` into the Worker
 * test pool.
 *
 * @param {readonly any[]} pages
 * @returns {{ records: any[], errors: Array<{code:string,at:string,expected:string,pageId:string}> }}
 */
export function mapDocuments(pages) {
	const records = [];
	const errors = [];
	for (const entry of pages) {
		const result = mapNotionPage(entry?.page, Array.isArray(entry?.blocks) ? entry.blocks : []);
		if (result.ok) records.push(result.record);
		else {
			const pageId = typeof entry?.page?.id === 'string' ? entry.page.id : 'unknown';
			for (const error of result.errors) errors.push({ pageId, ...error });
		}
	}
	return { records, errors };
}

/**
 * Map one Notion page and its child blocks.
 * @param {unknown} page
 * @param {readonly unknown[]} blocks
 * @returns {{ ok: true, record: object } | { ok: false, errors: Array<{code:string,at:string,expected:string}> }}
 */
export function mapNotionPage(page, blocks) {
	const errors = [];
	const object = asObject(page);
	if (object === null || typeof object.id !== 'string') {
		return {
			ok: false,
			errors: [{ code: 'invalid_page', at: 'page', expected: 'a Notion page object with an id' }],
		};
	}
	const pageId = object.id;

	const slug = requireRichText(object, 'Slug', errors, 128);
	if (slug.length > 0 && !SLUG_REGEX.test(slug)) {
		errors.push({
			code: 'invalid_slug',
			at: 'property Slug',
			expected: 'the portfolio slug grammar',
		});
	}
	const title = requireRichText(object, 'Title', errors, 300);
	const summary = requireRichText(object, 'Summary', errors, 2000);
	const role = requireRichText(object, 'Role', errors, 200);

	const periodStart = numberValue(object, 'PeriodStart');
	if (periodStart === null) {
		errors.push({
			code: 'missing_property',
			at: 'property PeriodStart',
			expected: 'a number (year)',
		});
	}

	const facets = [];
	for (const name of multiNames(object, 'Facets')) {
		const facet = name.toLowerCase();
		if (!PORTFOLIO_FACETS.includes(facet)) {
			errors.push({
				code: 'unknown_facet',
				at: 'property Facets',
				expected: PORTFOLIO_FACETS.join(', '),
			});
			continue;
		}
		if (!facets.includes(facet)) facets.push(facet);
	}
	if (facets.length === 0) {
		errors.push({
			code: 'missing_property',
			at: 'property Facets',
			expected: 'at least one facet',
		});
	}

	const statusName = (selectName(object, 'Status') ?? '').toLowerCase();
	const status = ['draft', 'published', 'archived'].includes(statusName) ? statusName : null;
	if (status === null) {
		errors.push({
			code: 'unknown_status',
			at: 'property Status',
			expected: 'Draft, Published or Archived',
		});
	}

	const visibilityName = (selectName(object, 'Visibility') ?? '').toLowerCase();
	const visibility = ['public', 'unlisted', 'draft'].includes(visibilityName)
		? visibilityName
		: null;
	if (visibility === null) {
		errors.push({
			code: 'unknown_visibility',
			at: 'property Visibility',
			expected: 'Public, Unlisted or Draft',
		});
	}

	let links = [];
	const linksRaw = richTextProperty(object, 'Links');
	if (linksRaw.length > 0) {
		const linkResult = parseLinks(linksRaw);
		if (linkResult.ok) links = linkResult.links;
		else errors.push(...linkResult.errors);
	}

	const sectionResult = blocksToSections(blocks);
	if (!sectionResult.ok) errors.push(...sectionResult.errors);
	else if ((sectionResult.sections.motivation ?? '').trim().length === 0) {
		// The public page's opening paragraph comes from this section. An
		// empty one is not a valid page that happens to be short — it is a
		// page whose body was written under a heading the mapper does not
		// recognise, and publishing it would render a project with no
		// explanation at all.
		errors.push({
			code: 'missing_motivation',
			at: 'page body',
			expected: 'a "Motivation" (or "動機") section with text',
		});
	}

	const editedAtRaw = object.last_edited_time;
	const editedAt = typeof editedAtRaw === 'string' ? editedAtRaw : '';
	if (editedAt.length === 0 || Number.isNaN(Date.parse(editedAt))) {
		errors.push({
			code: 'missing_edited_time',
			at: 'last_edited_time',
			expected: 'an ISO 8601 instant',
		});
	}

	if (errors.length > 0) return { ok: false, errors };

	return {
		ok: true,
		record: {
			pageId,
			slug,
			title,
			summary,
			role,
			periodStart,
			periodEnd: numberValue(object, 'PeriodEnd'),
			periodLabel: richTextProperty(object, 'Period') || null,
			facets,
			technologies: [...new Set(multiNames(object, 'Technologies'))],
			status,
			visibility,
			pinned: booleanValue(object, 'Pinned', false),
			displayOrder: numberValue(object, 'Order') ?? 0,
			sections: {
				motivation: sectionResult.sections.motivation ?? '',
				architecture: sectionResult.sections.architecture,
				constraints: sectionResult.sections.constraints,
				implementation: sectionResult.sections.implementation,
				evidence: sectionResult.sections.evidence,
				retrospective: sectionResult.sections.retrospective,
			},
			links,
			// Media arrives with the byte migration (Issue #766); the mapper
			// never invents a key it has not seen an upload for.
			media: [],
			editedAt,
		},
	};
}
