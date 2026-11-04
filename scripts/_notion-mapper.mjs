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
 *
 * Media and links (Issue #889)
 * ----------------------------
 * `image` and `bookmark` blocks became part of every page body when the
 * legacy articles were written into Notion (ADR-0018 §2.11), so neither
 * can stay a refusal without refusing the whole database.
 *
 *   * **An image is a descriptor, never Markdown.** The read shape under
 *     `Notion-Version: 2025-09-03` is `image.type === "file"` carrying
 *     `file: { url, expiry_time }` — a **signed URL that expires in about
 *     an hour** — or `image.type === "external"` carrying
 *     `external.url`. (`file_upload` is the *creation* parameter; the API
 *     never returns it on read. Do not write a reader for it.) The URL
 *     lives only on the descriptor, where the ingest downloads the bytes
 *     from; it never reaches the Markdown, the link list or the snapshot.
 *   * **A bookmark is one Markdown link line**, in document order, with
 *     `http:` / `https:` targets only. Anything else is an error, not a
 *     dropped link.
 *   * Everything else — an unknown image source, an unparseable target —
 *     stays an error. The refusal vocabulary is stable so a test and an
 *     operator can both name the problem.
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

/** Mirrors `NotionMediaSchema.media` (`z.array(...).max(32)`). */
const MAX_MEDIA_PER_RECORD = 32;

/**
 * An absolute `http:` / `https:` URL, or `null`.
 *
 * Bookmarks and image targets are the two places a page body can carry a
 * scheme the renderer must never see (`javascript:`, `data:`), so both
 * ask this one question rather than each inventing a parse.
 */
function absoluteHttpUrl(value) {
	if (typeof value !== 'string') return null;
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	return parsed;
}

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
 * Convert the page body to section Markdown and its image descriptors, or
 * report why it cannot.
 *
 * The media list is in **document order** — `displayOrder` and `isCover`
 * are decided here, where the order is visible, rather than re-derived
 * later from a list that has already been sorted.
 *
 * @returns {{ ok: true, sections: Record<string, string|null>, media: object[] } | { ok: false, errors: Array<{code:string,at:string,expected:string}> }}
 */
export function blocksToSections(blocks) {
	const errors = [];
	const media = [];
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
			appendBlock(writer, type, block, at, errors, media);
		} catch (error) {
			errors.push({
				code: 'unsupported_rich_text',
				at,
				expected: error instanceof Error ? error.message : 'plain text',
			});
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, sections: writer.finish(), media };
}

/**
 * Render one bookmark block as a single Markdown link line.
 *
 * @param {object} block
 * @param {string} at
 * @param {Array<{code:string,at:string,expected:string}>} errors
 * @returns {string|null} `null` when the target was refused (already recorded)
 */
function bookmarkToMarkdown(block, at, errors) {
	const payload = asObject(block.bookmark);
	const url = absoluteHttpUrl(payload?.url);
	if (url === null) {
		errors.push({
			code: 'invalid_bookmark_url',
			at,
			expected: 'an absolute http or https URL',
		});
		return null;
	}
	const caption = plainText(payload?.caption).trim();
	const destination = url
		.toString()
		.replace(/[()]/gu, (character) => (character === '(' ? '%28' : '%29'));
	// With no caption the URL is its own label: the author stored a bare
	// link, and inventing a title for it would be copy the author never
	// wrote. Parentheses are percent-encoded so an unbalanced `)` cannot
	// close the destination early; the decoded target is identical.
	const label = (caption.length > 0 ? caption : url.toString()).replace(/([\\[\]])/gu, '\\$1');
	return `[${label}](${destination})`;
}

/**
 * Read one image block into a media descriptor, or report why it cannot.
 *
 * The descriptor carries the ephemeral URL so the ingest can download the
 * bytes; nothing else in the pipeline ever sees it. See the module note
 * for the read shape (`file` / `external`) and why `file_upload` is not
 * part of it.
 *
 * @param {object} block
 * @param {string} at
 * @param {number} displayOrder position among this page's images
 * @returns {{descriptor?: object, error?: {code:string,at:string,expected:string}}}
 */
function readImageBlock(block, at, displayOrder) {
	const payload = asObject(block.image);
	const source = String(payload?.type ?? '');
	let raw;
	if (source === 'file') raw = asObject(payload.file)?.url;
	else if (source === 'external') raw = asObject(payload.external)?.url;
	else {
		return {
			error: {
				code: 'image_source_unsupported',
				at,
				expected: 'an image source of type "file" or "external"',
			},
		};
	}
	const url = absoluteHttpUrl(raw);
	if (url === null) {
		return {
			error: { code: 'image_url_invalid', at, expected: 'an absolute http or https URL' },
		};
	}
	// A mention or an equation in a caption throws here and becomes
	// `unsupported_rich_text` at the caller — the same refusal a paragraph
	// carrying the same run gets.
	const captionText = plainText(payload?.caption).trim();
	if (captionText.length > 500) {
		return {
			error: {
				code: 'caption_too_long',
				at,
				expected: 'a caption of at most 500 characters',
			},
		};
	}
	const caption = captionText.length > 0 ? captionText : null;
	return {
		descriptor: {
			blockId: typeof block.id === 'string' ? block.id : at,
			source,
			// Signed and expiring (about an hour). The ingest consumes it
			// and it is discarded; it is never serialised.
			url: url.toString(),
			// Notion carries no content type on read; the byte fetch
			// supplies the authoritative one.
			contentType: null,
			caption,
			// Notion has no alt-text field on an image block. The caption is
			// the only text the author attached to the picture, so it is the
			// alt text too; with no caption the image renders as decorative
			// (empty alt) rather than with a title the author never wrote.
			alt: caption ?? '',
			isCover: displayOrder === 0,
			displayOrder,
		},
	};
}

function appendBlock(writer, type, block, at, errors, media) {
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
		case 'image': {
			// An image needs its bytes in R2 before a page can render it,
			// so the block becomes a descriptor for the ingest rather than
			// Markdown. Refusing it here would put the whole database back
			// into the fail-closed state this Issue exists to leave.
			const outcome = readImageBlock(block, at, media.length);
			if (outcome.error) errors.push(outcome.error);
			else media.push(outcome.descriptor);
			break;
		}
		case 'bookmark': {
			// One line, in document order, exactly where the author put
			// it. A refused target is recorded, never skipped.
			const markdown = bookmarkToMarkdown(block, at, errors);
			if (markdown !== null) writer.block(markdown);
			break;
		}
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
 * `media` is the flattened descriptor list, each entry carrying the
 * `pageId` it belongs to. The descriptors are NOT part of a record: a
 * record carries the ephemeral Notion URL only by accident if a caller
 * forgets the ingest step, and the snapshot must never hold one
 * (Issue #889). The ingest resolves each descriptor to bytes and an R2
 * key, then projects it back with `toContractMedia`.
 *
 * @param {readonly any[]} pages
 * @returns {{ records: any[], media: Array<object>, errors: Array<{code:string,at:string,expected:string,pageId:string}> }}
 */
export function mapDocuments(pages) {
	const records = [];
	const media = [];
	const errors = [];
	for (const entry of pages) {
		const result = mapNotionPage(entry?.page, Array.isArray(entry?.blocks) ? entry.blocks : []);
		if (result.ok) {
			records.push(result.record);
			for (const descriptor of result.media) {
				media.push({ pageId: result.record.pageId, ...descriptor });
			}
		} else {
			const pageId = typeof entry?.page?.id === 'string' ? entry.page.id : 'unknown';
			for (const error of result.errors) errors.push({ pageId, ...error });
		}
	}
	return { records, media, errors };
}

/**
 * Project a **resolved** descriptor into `NotionMediaSchema`'s shape.
 *
 * The split is the point: this module decides every field that comes from
 * the page (alt, caption, order, cover), and the ingest decides every
 * field that comes from bytes (`r2Key`, `contentType`) or from the offline
 * rights record (`rights`). Neither side can fill in the other's fields,
 * so a snapshot URL can only arrive by a caller passing a URL as an
 * `r2Key` — which `checkSnapshotShape` and the contract both refuse.
 *
 * `width` / `height` are `null` by decision, not by omission: the
 * contract makes them nullable, the D1 migration carries no dimensions
 * either, and guessing a size a browser will reserve is how layout shift
 * gets manufactured.
 *
 * @param {{alt: string, caption: string|null, isCover: boolean, displayOrder: number}} descriptor
 * @param {{r2Key: string, contentType: string, rights: 'recorded'|'unrecorded'}} resolution
 */
export function toContractMedia(descriptor, { r2Key, contentType, rights }) {
	return {
		r2Key,
		contentType,
		width: null,
		height: null,
		alt: descriptor.alt,
		caption: descriptor.caption,
		isCover: descriptor.isCover,
		displayOrder: descriptor.displayOrder,
		rights,
	};
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
	else {
		if (sectionResult.media.length > MAX_MEDIA_PER_RECORD) {
			// Caught here rather than left for the runtime contract to
			// reject the whole snapshot: a refusal an operator can act on
			// beats a file that silently publishes nothing.
			errors.push({
				code: 'too_many_media',
				at: 'page body',
				expected: `at most ${MAX_MEDIA_PER_RECORD} image blocks`,
			});
		}
		if ((sectionResult.sections.motivation ?? '').trim().length === 0) {
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
			// Filled by the ingest (`sync-portfolio-notion.mjs`) after every
			// descriptor has been downloaded, hashed and given an R2 key.
			// The mapper cannot know a key it has never seen an upload for,
			// so it never invents one and never carries a Notion URL here.
			media: [],
			editedAt,
		},
		// The page's image descriptors, in document order. Not part of the
		// record: they still hold the ephemeral Notion URL.
		media: sectionResult.media,
	};
}
