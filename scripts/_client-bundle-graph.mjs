/**
 * Build the client bundle graph consumed by `scripts/check-bundle-budget.mjs`
 * (Issue #482).
 *
 * Why the sizes come off disk, not out of `generateBundle`
 * -------------------------------------------------------
 * A Rollup/Vite `generateBundle` hook does not see final chunk bytes. Vite's
 * own `vite:build-import-analysis` plugin runs AFTER ordinary user plugins in
 * the same phase and rewrites `chunk.code` in place — it is what injects the
 * `__vitePreload` marker and the dependency map that makes lazy route chunks
 * fetch their static imports. Any other late hook (the Cloudflare plugin, a
 * post-plugin) can change the output too.
 *
 * Measuring there therefore records the size of the code as it stood *before*
 * finalization: a systematically UNDER-counted number. A budget gate whose
 * numbers are a little small is the worst kind of gate — it looks like it
 * works. The caps carry only a few KB of headroom, so a real over-cap file
 * would still pass.
 *
 * So the graph is written from `writeBundle`, after Rollup has flushed every
 * file to disk, and the sizes are read back from the emitted files. The
 * fallback (in-memory bytes, used only when a file is unreadable) keeps the
 * graph complete and is reported in the graph itself so a reader can tell
 * which of the two produced a number.
 *
 * This module is deliberately free of Vite types so the budget gate's own
 * test file can exercise it directly; `vite.config.ts` is the only importer.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** gzip level recorded in the graph and used for every `gzip_bytes` value. */
export const GZIP_LEVEL = 9;

/**
 * On-disk size of a Rollup output, in bytes.
 *
 * `output.code.length` / `output.source.length` count UTF-16 code units, so a
 * chunk carrying a non-ASCII literal (this app ships Japanese editorial copy)
 * would be recorded as smaller than the file Vite actually writes. A budget
 * gate that undercounts its own artefacts can pass a real over-cap file, so the
 * byte count has to be the byte count.
 */
export function rawByteLength(source) {
	return typeof source === 'string' ? Buffer.byteLength(source, 'utf8') : source.byteLength;
}

/** gzip size of already-real bytes. */
export function gzipByteLength(bytes) {
	return gzipSync(bytes, { level: GZIP_LEVEL }).length;
}

/**
 * Bytes of one emitted file, read back from disk.
 *
 * @param {string} outDir directory Rollup wrote the output into
 * @param {string} fileName output-relative file name
 * @param {string | Uint8Array} fallback in-memory content, used only when the
 *   file cannot be read (a caller can then tell the two apart via `source`)
 * @returns {Promise<{bytes: number, gzip_bytes: number, source: 'emitted-file'|'memory'}>}
 */
export async function measureEmittedFile(outDir, fileName, fallback) {
	try {
		const emitted = await readFile(resolve(outDir, fileName));
		return {
			bytes: emitted.byteLength,
			gzip_bytes: gzipByteLength(emitted),
			source: 'emitted-file',
		};
	} catch {
		const bytes = Buffer.isBuffer(fallback)
			? fallback
			: Buffer.from(typeof fallback === 'string' ? fallback : new Uint8Array(fallback));
		return { bytes: bytes.byteLength, gzip_bytes: gzipByteLength(bytes), source: 'memory' };
	}
}

/**
 * Turn a Rollup output bundle into the graph the budget gate reads.
 *
 * @param {object} params
 * @param {Record<string, object>} params.bundle Rollup `OutputBundle`
 * @param {string} params.outDir directory the bundle was written into
 * @param {string} params.rootDir repository root, used to make facade ids relative
 * @returns {Promise<{graph: object, measured_files: number, fallback_files: string[]}>}
 */
export async function buildClientBundleGraph({ bundle, outDir, rootDir }) {
	const assets = {};
	const chunks = {};
	const fallbackFiles = [];

	const measure = async (fileName, fallback) => {
		const measured = await measureEmittedFile(outDir, fileName, fallback);
		if (measured.source === 'memory') fallbackFiles.push(fileName);
		return measured;
	};

	for (const [fileName, output] of Object.entries(bundle)) {
		if (output.type === 'asset') {
			assets[fileName] = await measure(fileName, output.source);
			continue;
		}
		const importedCss = [...(output.viteMetadata?.importedCss ?? [])];
		// `?tsr-split=component` / `?tsr-split=notFoundComponent`
		// are TanStack Start's virtual split markers. Two chunks can
		// therefore share one facade id (a route component and its
		// not-found component); only the component chunk is part of
		// first paint, so the query has to survive into the graph for
		// the budget gate to pick the right one.
		const facadeId = output.facadeModuleId ?? null;
		const facade = facadeId
			? relative(rootDir, facadeId.split('?')[0]).split('\\').join('/')
			: null;
		const measured = await measure(fileName, output.code);
		chunks[fileName] = {
			name: output.name,
			// The file basename alone cannot identify a route: four
			// distinct chunks are called `index` and two are called
			// `tools._slug`. `facade_module_id` is the stable key
			// that maps a chunk back to `src/routes/<file>.tsx`.
			facade_module_id: facade,
			facade_query: facadeId?.includes('?') ? facadeId.slice(facadeId.indexOf('?') + 1) : null,
			is_entry: output.isEntry === true,
			is_dynamic_entry: output.isDynamicEntry === true,
			bytes: measured.bytes,
			gzip_bytes: measured.gzip_bytes,
			css_bytes: importedCss.reduce((sum, css) => sum + (assets[css]?.bytes ?? 0), 0),
			imports: [...output.imports].filter((dep) => bundle[dep]?.type === 'chunk'),
			css: importedCss,
		};
	}

	const graph = {
		schema_version: 1,
		generator: 'my-web-2026:client-bundle-graph',
		out_dir: outDir,
		bytes_unit: 'raw',
		// Recorded so a reader knows whether `bytes` came from the file the
		// browser downloads or from Rollup's pre-write in-memory copy.
		bytes_source: fallbackFiles.length === 0 ? 'emitted-file' : 'emitted-file-with-memory-fallback',
		gzip_level: GZIP_LEVEL,
		...(fallbackFiles.length > 0 ? { bytes_fallback_files: fallbackFiles } : {}),
		assets,
		chunks,
	};

	return { graph, measured_files: Object.keys(bundle).length, fallback_files: fallbackFiles };
}
