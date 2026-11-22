/**
 * Work-cover media embedding for the profile card (Issue #1170,
 * ADR-0024 §2.3).
 *
 * GitHub serves README images through Camo and browsers render the
 * SVG through `<img>`; in that context an SVG **cannot load external
 * subresources** — `<image href="https://…">` stays blank. The only
 * portable way to show real work imagery inside the card is to embed
 * the bytes: `data:<content-type>;base64,…`.
 *
 * Cost control:
 *   - candidates arrive already ordered and public-key-filtered by
 *     `model.ts`; this module picks the FIRST candidate whose object
 *     is small enough (`MAX_COVER_BYTES`) and embeds it;
 *   - a running byte budget (`MAX_TOTAL_MEDIA_BYTES`) stops embedding
 *     once the card would exceed the transfer budget — later tiles
 *     degrade to the text-only panel instead of inflating the SVG;
 *   - `head` before `get` so an oversized object is never downloaded;
 *   - every failure (missing binding, absent object, read error)
 *     degrades that tile to the placeholder — the card still answers.
 */

import type { ProfileCardWork } from './model';

/** Per-cover raw-byte ceiling (~0.75 MB → ~1 MB base64). */
export const MAX_COVER_BYTES = 750 * 1024;

/** Total raw-byte budget across all embedded covers. */
export const MAX_TOTAL_MEDIA_BYTES = 1536 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

async function embedOne(
	bucket: R2Bucket,
	work: ProfileCardWork,
	remainingBudget: number,
): Promise<{ work: ProfileCardWork; bytesUsed: number }> {
	for (const media of work.media) {
		if (
			media.contentType !== 'image/png' &&
			media.contentType !== 'image/jpeg' &&
			media.contentType !== 'image/webp'
		) {
			continue;
		}
		try {
			const head = await bucket.head(media.r2Key);
			if (!head || head.size > MAX_COVER_BYTES || head.size > remainingBudget) continue;
			const object = await bucket.get(media.r2Key);
			if (!object) continue;
			const bytes = new Uint8Array(await object.arrayBuffer());
			if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_BYTES) continue;
			return {
				work: {
					...work,
					dataUri: `data:${media.contentType};base64,${bytesToBase64(bytes)}`,
				},
				bytesUsed: bytes.byteLength,
			};
		} catch {
			// Try the next candidate; a failed read is not a card failure.
		}
	}
	return { work, bytesUsed: 0 };
}

/**
 * Return works with `dataUri` filled for as many tiles as the media
 * budget allows. Order is preserved; un-embedded works keep their
 * title/summary and render the placeholder panel.
 */
export async function embedWorkMedia(
	works: readonly ProfileCardWork[],
	bucket: R2Bucket | undefined,
): Promise<ProfileCardWork[]> {
	if (!bucket) return [...works];
	let budget = MAX_TOTAL_MEDIA_BYTES;
	const out: ProfileCardWork[] = [];
	for (const work of works) {
		if (budget <= 0) {
			out.push(work);
			continue;
		}
		const { work: embedded, bytesUsed } = await embedOne(bucket, work, budget);
		budget -= bytesUsed;
		out.push(embedded);
	}
	return out;
}
