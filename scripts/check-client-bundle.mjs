import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const clientOutput = resolve('dist/client');
const forbiddenSpecifier = 'cloudflare:workers';
const inspectedExtensions = new Set(['.html', '.js', '.mjs']);

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		}),
	);
	return nested.flat();
}

const files = (await listFiles(clientOutput)).filter((file) =>
	inspectedExtensions.has(extname(file)),
);
const offenders = [];

for (const file of files) {
	const content = await readFile(file, 'utf8');
	if (content.includes(forbiddenSpecifier)) {
		offenders.push(relative(clientOutput, file));
	}
}

if (offenders.length > 0) {
	throw new Error(
		`Client output contains the Workers-only ${forbiddenSpecifier} specifier:\n${offenders.join('\n')}`,
	);
}

console.log(`Client output contains no ${forbiddenSpecifier} specifier.`);
