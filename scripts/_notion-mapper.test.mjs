import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapDocuments, mapNotionPage, toContractMedia } from './_notion-mapper.mjs';

/**
 * Image and bookmark mapping (Issue #889).
 *
 * The mapper used to refuse both blocks (`image_block_unsupported`,
 * `unsupported_block`), which failed closed on every page the legacy
 * articles gave a body to. These tests pin the readable behaviour AND the
 * refusals that stay: an image source the API does not use on read, a
 * target that is not http/https, and any block type outside the
 * vocabulary. A silently dropped image is the defect the refusal exists
 * to prevent, so "readable" and "still refuses" are asserted together.
 */

const SIGNED_URL = 'https://secure.notion-static.com/abc?X-Amz-Signature=deadbeef&expiry=1h';

function basePage() {
	return {
		id: 'page-1',
		last_edited_time: '2026-11-04T00:00:00.000Z',
		properties: {
			Slug: {
				type: 'rich_text',
				rich_text: [{ type: 'text', text: { content: 'sample-project' } }],
			},
			Title: { type: 'title', title: [{ type: 'text', text: { content: 'Sample' } }] },
			Summary: {
				type: 'rich_text',
				rich_text: [{ type: 'text', text: { content: 'One sentence.' } }],
			},
			Role: {
				type: 'rich_text',
				rich_text: [{ type: 'text', text: { content: 'Implementation' } }],
			},
			PeriodStart: { type: 'number', number: 2024 },
			Facets: { type: 'multi_select', multi_select: [{ name: 'Develop' }] },
			Status: { type: 'select', select: { name: 'Published' } },
			Visibility: { type: 'select', select: { name: 'Public' } },
		},
	};
}

function text(content) {
	return [{ type: 'text', text: { content } }];
}

function heading(content) {
	return { object: 'block', id: 'h-1', type: 'heading_2', heading_2: { rich_text: text(content) } };
}

function paragraph(content, id = 'p-1') {
	return { object: 'block', id, type: 'paragraph', paragraph: { rich_text: text(content) } };
}

function fileImage(url = SIGNED_URL, caption = [], id = 'img-1') {
	return {
		object: 'block',
		id,
		type: 'image',
		image: { type: 'file', file: { url, expiry_time: '2026-11-04T14:00:00.000Z' }, caption },
	};
}

function externalImage(url, caption = [], id = 'img-2') {
	return {
		object: 'block',
		id,
		type: 'image',
		image: { type: 'external', external: { url }, caption },
	};
}

function bookmark(url, caption = [], id = 'bm-1') {
	return { object: 'block', id, type: 'bookmark', bookmark: { url, caption } };
}

function caption(content) {
	return text(content);
}

describe('image blocks', () => {
	it('reads a "file" image into an ordered descriptor and keeps it out of the record', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			fileImage(SIGNED_URL, caption('A cat')),
		]);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		assert.equal(result.media.length, 1);
		const [descriptor] = result.media;
		assert.equal(descriptor.blockId, 'img-1');
		assert.equal(descriptor.source, 'file');
		assert.equal(descriptor.url, SIGNED_URL);
		assert.equal(descriptor.contentType, null);
		assert.equal(descriptor.caption, 'A cat');
		assert.equal(descriptor.alt, 'A cat');
		assert.equal(descriptor.isCover, true);
		assert.equal(descriptor.displayOrder, 0);
		// The record is what a caller serialises. It carries no descriptor
		// and therefore cannot carry the expiring URL by accident.
		assert.deepEqual(result.record.media, []);
		assert.equal(JSON.stringify(result.record).includes('notion-static'), false);
	});

	it('reads an "external" image the same way, without a caption of its own', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			externalImage('https://example.com/picture.png'),
		]);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		const [descriptor] = result.media;
		assert.equal(descriptor.source, 'external');
		assert.equal(descriptor.url, 'https://example.com/picture.png');
		assert.equal(descriptor.caption, null);
		assert.equal(descriptor.alt, '');
	});

	it('numbers images in document order and marks only the first as cover', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			externalImage('https://example.com/one.png', [], 'img-a'),
			fileImage(SIGNED_URL, [], 'img-b'),
			externalImage('https://example.com/two.png', [], 'img-c'),
		]);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		assert.deepEqual(
			result.media.map((descriptor) => [
				descriptor.blockId,
				descriptor.displayOrder,
				descriptor.isCover,
			]),
			[
				['img-a', 0, true],
				['img-b', 1, false],
				['img-c', 2, false],
			],
		);
	});

	it('refuses an image source the API does not use on read', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			{
				object: 'block',
				id: 'img-9',
				type: 'image',
				image: { type: 'file_upload', file_upload: { id: 'file-1' }, caption: [] },
			},
		]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'image_source_unsupported');
	});

	it('refuses an image target that is not an absolute http or https URL', () => {
		for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not-a-url']) {
			const result = mapNotionPage(basePage(), [
				heading('Motivation'),
				paragraph('Why.'),
				fileImage(url),
			]);
			assert.equal(result.ok, false, url);
			assert.equal(result.errors[0]?.code, 'image_url_invalid', url);
		}
	});

	it('refuses a caption longer than the contract allows', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			fileImage(SIGNED_URL, caption('x'.repeat(501))),
		]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'caption_too_long');
	});

	it('refuses more images than the contract carries', () => {
		const blocks = [heading('Motivation'), paragraph('Why.')];
		for (let index = 0; index < 33; index += 1) {
			blocks.push(externalImage(`https://example.com/${index}.png`, [], `img-${index}`));
		}
		const result = mapNotionPage(basePage(), blocks);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'too_many_media');
	});
});

describe('bookmark blocks', () => {
	it('becomes one Markdown link line in document order', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('First.'),
			bookmark('https://example.com/reference'),
			paragraph('Second.'),
			bookmark('https://example.com/other', caption('The other one')),
		]);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		const lines = result.record.sections.motivation.split('\n\n');
		assert.deepEqual(lines, [
			'First.',
			'[https://example.com/reference](https://example.com/reference)',
			'Second.',
			'[The other one](https://example.com/other)',
		]);
	});

	it('percent-encodes parentheses so a link cannot break out of its destination', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			bookmark('https://example.com/a(b)c'),
		]);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		assert.match(
			result.record.sections.motivation,
			/\[https:\/\/example\.com\/a\(b\)c\]\(https:\/\/example\.com\/a%28b%29c\)/u,
		);
	});

	it('refuses a target that is not http or https', () => {
		for (const url of ['javascript:alert(1)', 'ftp://example.com/file', 'notaurl']) {
			const result = mapNotionPage(basePage(), [
				heading('Motivation'),
				paragraph('Why.'),
				bookmark(url),
			]);
			assert.equal(result.ok, false, url);
			assert.equal(result.errors[0]?.code, 'invalid_bookmark_url', url);
		}
	});
});

describe('refusals that stay', () => {
	it('still refuses a block type outside the vocabulary', () => {
		const result = mapNotionPage(basePage(), [
			heading('Motivation'),
			paragraph('Why.'),
			{
				object: 'block',
				id: 'c-1',
				type: 'callout',
				callout: { rich_text: text('notice') },
			},
		]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'unsupported_block');
		assert.match(result.errors[0]?.expected, /got "callout"/u);
	});

	it('still refuses body text before the first section heading', () => {
		const result = mapNotionPage(basePage(), [bookmark('https://example.com/early')]);
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, 'content_before_first_section');
	});
});

describe('mapDocuments', () => {
	it('returns the page descriptors beside the records, not inside them', () => {
		const { records, media, errors } = mapDocuments([
			{ page: basePage(), blocks: [heading('Motivation'), paragraph('Why.'), fileImage()] },
		]);
		assert.deepEqual(errors, []);
		assert.equal(records.length, 1);
		assert.equal(records[0].media.length, 0);
		assert.equal(media.length, 1);
		assert.equal(media[0].pageId, 'page-1');
		assert.equal(media[0].blockId, 'img-1');
	});
});

describe('toContractMedia', () => {
	it('projects a resolved descriptor into exactly the contract fields', () => {
		const { media } = mapDocuments([
			{ page: basePage(), blocks: [heading('Motivation'), paragraph('Why.'), fileImage()] },
		]);
		const projected = toContractMedia(media[0], {
			r2Key: 'portfolio/notion/aa11.png',
			contentType: 'image/png',
			rights: 'unrecorded',
		});
		assert.deepEqual(Object.keys(projected).sort(), [
			'alt',
			'caption',
			'contentType',
			'displayOrder',
			'height',
			'isCover',
			'r2Key',
			'rights',
			'width',
		]);
		assert.equal(projected.r2Key, 'portfolio/notion/aa11.png');
		assert.equal(projected.contentType, 'image/png');
		assert.equal(projected.rights, 'unrecorded');
		assert.equal(projected.width, null);
		assert.equal(projected.height, null);
		// The fixture image carries no caption, so it is decorative (empty
		// alt) rather than titled by copy the author never wrote.
		assert.equal(projected.alt, '');
		assert.equal(projected.caption, null);
		// The ephemeral URL has no field to live in.
		assert.equal(JSON.stringify(projected).includes('http'), false);
	});
});
