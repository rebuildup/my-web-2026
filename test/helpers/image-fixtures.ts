/**
 * Byte fixtures for the reaction-image upload policy (Issue #458).
 *
 * Lives outside `src/` so tests can build hostile payloads without the
 * production obligation importing test material. Every fixture is a
 * hand-written byte array: header-only, never a decoded image, because
 * the policy under test is a signature comparison and not a decode.
 */

function ascii(text: string): Uint8Array {
	return new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** A detached `ArrayBuffer` copy, so a fixture can be reused per test. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 1×1 PNG: 8-byte signature + IHDR + IDAT + IEND. */
export const PNG_BYTES = concat([
	new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82,
	]),
]);

/** Minimal JPEG: SOI + APP0/JFIF + EOI. */
export const JPEG_BYTES = concat([
	new Uint8Array([
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
		0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
	]),
]);

/** Minimal WebP: RIFF container + `WEBP` fourcc + VP8 chunk. */
export const WEBP_BYTES = concat([
	new Uint8Array([
		0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
		0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
		0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfb, 0x94, 0x00, 0x00,
	]),
]);

/** Minimal GIF87a: 1×1 pixel. */
export const GIF_BYTES = concat([
	new Uint8Array([
		0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
		0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
	]),
]);

/** GIF89a variant — same media type, different version tag. */
export const GIF89A_BYTES = concat([ascii('GIF89a'), GIF_BYTES.subarray(6)]);

/** Standalone SVG document — active content, rejected on declaration AND on bytes. */
export const SVG_BYTES = ascii(
	'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle r="5"/></svg>',
);

/** SVG fragment without the XML prolog, plus a UTF-8 BOM before it. */
export const SVG_BOM_BYTES = concat([
	new Uint8Array([0xef, 0xbb, 0xbf]),
	ascii('\n  <svg width="8" height="8"><script>alert(1)</script></svg>'),
]);

/** Plain text — a "fake image": a body with no image signature at all. */
export const TEXT_BYTES = ascii('<?php echo "not an image"; ?>\n');

/** HTML — a "fake image" with an active-content flavour. */
export const HTML_BYTES = ascii(
	'<!doctype html><html><body><script>fetch("/admin")</script></body></html>',
);

/** ZIP magic (`PK\x03\x04`) — a non-image archive renamed to `.png`. */
export const ZIP_BYTES = concat([
	new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
	ascii('pretend-this-is-a-photo.png'),
]);

/**
 * Repeat `content` until `totalLen` bytes. Used to cross the 256 KiB
 * cap without fabricating magic bytes: the repeated body still starts
 * with the real signature, so the size guard is what rejects it.
 */
export function repeatTo(content: Uint8Array, totalLen: number): ArrayBuffer {
	const buf = new Uint8Array(totalLen);
	for (let i = 0; i < totalLen; i += content.length) {
		buf.set(content.subarray(0, Math.min(content.length, totalLen - i)), i);
	}
	return toArrayBuffer(buf);
}

/** A valid GIF padded with trailing bytes — signature intact, size over cap. */
export function oversizeGif(): ArrayBuffer {
	return repeatTo(GIF_BYTES, 256 * 1024 + 1);
}

export { toArrayBuffer };
