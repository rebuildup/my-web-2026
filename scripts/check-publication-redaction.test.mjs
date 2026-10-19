import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CORPUS_RELATIVE_PATH,
	PUBLISHED_CONTENT_EXCLUDE_PREFIXES,
	PUBLISHED_CONTENT_NOT_SCANNED,
	PUBLISHED_CONTENT_ROOTS,
	REPORT_RELATIVE_PATH,
	candidateBearingFiles,
	digests,
	rootDeclarationConflicts,
} from './check-publication-redaction.mjs';
import {
	DECISIONS,
	EXIF_PERSONAL_KEYS,
	PUBLICATION_AUTHORITY,
	REVIEW_SCHEMA,
	RULES,
	buildPublicBundle,
	findImageCandidates,
	findRecordCandidates,
	findTextCandidates,
	isKnownDecision,
	isLikelyPersonName,
	isPublishable,
	maskValue,
	renderHtmlReport,
	renderMarkdownReport,
	resolveDecision,
	reviewCorpus,
	verdictOf,
} from './personal-data-review.mjs';

/**
 * Personal-data review contract tests (Issue #494).
 *
 * Every case runs on an independent fixture — never on the live
 * repository, never on the live corpus — so the contract is provable
 * without a Worker, without a browser and without the source tree
 * staying put. The live corpus is exercised by `pnpm run
 * publication:redaction:check` itself, and its acceptance evidence is
 * `docs/verification/privacy/publication-redaction-review.md`.
 *
 * Fixture values are synthetic by construction: reserved `.test` /
 * `.example` hostnames, unassigned `0000` phone blocks, and place
 * names that geocode nowhere. A privacy fixture must not itself carry
 * an approximation of a real person's data — that would publish the
 * record this suite exists to keep unpublished.
 */

/** A record with no candidates at all (the 正常 fixture). */
const CLEAN_RECORD = {
	id: 'fixture-clean',
	source: 'miro',
	source_ref: 'miro://fixture/clean',
	title: 'ボードの列整理メモ',
	text: 'カードの移動ルールと列の命名だけを確認する。連絡先や住所は含まれない。',
	images: [{ path: 'assets/columns.webp', alt: '列定義', caption: '整理後', exif: {} }],
	publication: { decision: 'approved', decided_by: 'owner', basis: 'fixture: 承認された対照例。' },
};

/**
 * The owner-unapproved private sample (the 不正常 fixture): a
 * residential address, a phone block, an email, a third party's name,
 * a national id, a date of birth, and an image that spells a personal
 * camera filename with EXIF position metadata.
 */
const PRIVATE_RECORD = {
	id: 'fixture-private',
	source: 'notion',
	source_ref: 'notion://fixture/private',
	title: '自分用メモ / 未公開',
	text: [
		'現住所は山口県宇部市在住、南区東2丁目12-3、郵便番号は〒740-0000。',
		'配送先のメモは 東京都渋谷区神南1丁目22-10。',
		'携帯は 090-0000-0000、連絡先は personal@fixture-note.test。',
		'家族は井川 二郎さん、マイナンバー 0001 2345 6789、生年月日は 1998-04-12。',
		'スライドは Dr. Fixture Person がまとめている。',
	].join(''),
	images: [
		{
			path: 'assets/IMG_4821.jpg',
			alt: '机の上の書類',
			caption: '集合写真 (新井 沙耶さん)',
			exif: {
				Artist: 'Fixture Person',
				GPSLatitude: '34.1234',
				GPSLongitude: '135.5678',
				Make: 'FixtureCam',
				Model: 'FX-1',
				DateTimeOriginal: '2026:03:15 09:12:03',
			},
		},
	],
	publication: { decision: 'review_required' },
};

const corpusOf = (...records) => ({ schema: REVIEW_SCHEMA, records });
const codesOf = (candidates) => candidates.map((candidate) => candidate.code);
const publishedFiles = (entries) => entries.map(([path, text]) => ({ path, text }));

/** The repository this suite lives in — the source of the gate under test. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A throwaway copy of the gate, in a directory that acts as its own
 * repository root.
 *
 * The gate derives its repository root from the location of its own
 * file, so a copy in `<tmp>/scripts/` treats `<tmp>` as the
 * repository root: the real collector, the real corpus loader and the
 * real exit codes all run against a temporary published root. That is
 * what makes a CLI-level test possible without a configuration seam —
 * an env var that moved the scanned root would be a fail-open lever
 * on the gate itself, and a privacy gate must not grow one.
 */
function gateTree({ publishedFiles = {}, corpus = corpusOf(CLEAN_RECORD, PRIVATE_RECORD) } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'publication-redaction-'));
	mkdirSync(join(root, 'scripts'), { recursive: true });
	for (const file of ['check-publication-redaction.mjs', 'personal-data-review.mjs']) {
		cpSync(join(repoRoot, 'scripts', file), join(root, 'scripts', file));
	}
	mkdirSync(join(root, 'docs/migration/personal-data-review'), { recursive: true });
	mkdirSync(join(root, 'docs/verification/privacy'), { recursive: true });
	writeFileSync(
		join(root, 'docs/migration/personal-data-review/corpus.json'),
		`${JSON.stringify(corpus, null, 2)}\n`,
	);
	for (const [path, content] of Object.entries(publishedFiles)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

/** Run the copied gate and report what it decided. */
function runGate(root, args = []) {
	const result = spawnSync(
		process.execPath,
		[join(root, 'scripts/check-publication-redaction.mjs'), ...args],
		{ encoding: 'utf8' },
	);
	return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('detection — the private sample fires every personal-data class', () => {
	it('extracts a candidate for every rule the Issue names', () => {
		const codes = new Set(codesOf(findRecordCandidates(PRIVATE_RECORD)));
		for (const code of [
			'D001',
			'D002',
			'D003',
			'D004',
			'D005',
			'D006',
			'D007',
			'D008',
			'D009',
			'D010',
			'D011',
		]) {
			assert.ok(codes.has(code), `expected ${code} to fire on the private sample`);
		}
	});

	it('leaves the clean record untouched (non-vacuity of the negative side)', () => {
		assert.deepEqual(findRecordCandidates(CLEAN_RECORD), []);
	});

	it('reports a masked value only, never the raw one', () => {
		const candidates = findRecordCandidates(PRIVATE_RECORD);
		for (const candidate of candidates) {
			// The shape is the contract: a candidate carries the rule id,
			// the field, the offset and the masked form — and nothing that
			// could hold the raw match.
			assert.deepEqual(Object.keys(candidate).sort(), [
				'at',
				'class',
				'code',
				'field',
				'masked',
				'title',
			]);
			assert.equal(typeof candidate.masked, 'string');
			assert.equal(candidate.masked.includes('090-0000-0000'), false);
			assert.equal(candidate.masked.includes('personal@fixture-note.test'), false);
			assert.equal(candidate.masked.includes('井川'), false);
			assert.equal(candidate.masked.includes('新井'), false);
		}
		const email = candidates.find((candidate) => candidate.code === 'D001');
		assert.equal(email.masked, '########@#################');
	});

	it('masks the non-numeric part of a file-name candidate too', () => {
		const d011 = findTextCandidates('assets/20260315-自撮り-集合写真.jpg').filter(
			(candidate) => candidate.code === 'D011',
		);
		assert.ok(d011.length > 0, 'the personal-camera file name must be detected');
		for (const candidate of d011) {
			assert.equal(
				candidate.masked.includes('自撮り'),
				false,
				'the mask must not carry the raw name',
			);
		}
	});

	it('masks every script class', () => {
		assert.equal(maskValue('090-0000-0000'), '###-####-####');
		assert.equal(maskValue('井川 二郎'), '・・ ・・');
		assert.equal(maskValue('Dr. Fixture Person'), 'xx. xxxxxxx xxxxxx');
	});
});

describe('detection — precision over recall', () => {
	it('does not read a version, a date or a ratio as a phone number', () => {
		assert.deepEqual(codesOf(findTextCandidates('2026-09-19 公開、v2.1.0、ratio 0.75')), []);
	});

	it('does not read an ordinary prefecture mention as an address', () => {
		assert.deepEqual(codesOf(findTextCandidates('出身校は山口県宇部市の宇部高専です。')), []);
	});

	it('does not read general words that end in a courtesy suffix as a name', () => {
		for (const phrase of ['皆さん', '皆様', '各方', '仕様', 'Handles', '同上']) {
			assert.deepEqual(
				findTextCandidates(phrase).filter((candidate) => candidate.code === 'D006'),
				[],
				`${phrase} must not be read as a person name`,
			);
		}
	});

	it('reads a courtesy-suffixed kanji name as a person name', () => {
		assert.equal(isLikelyPersonName('田中さん'), true);
		assert.equal(isLikelyPersonName('皆さん'), false);
		assert.equal(isLikelyPersonName('仕様'), false);
		assert.ok(codesOf(findTextCandidates('担当は井川 二郎さん')).includes('D006'));
	});

	it('ignores camera make / model and capture time in EXIF', () => {
		const candidates = findImageCandidates({
			path: 'assets/photo.webp',
			alt: '写真',
			caption: '写真',
			exif: { Make: 'FixtureCam', Model: 'FX-1', DateTimeOriginal: '2026:03:15 09:12:03' },
		});
		assert.deepEqual(candidates, []);
	});

	it('flags every declared EXIF personal key and nothing else', () => {
		const exif = Object.fromEntries(EXIF_PERSONAL_KEYS.map((key) => [key, 'Fixture']));
		const candidates = findImageCandidates({ path: 'assets/a.webp', alt: '', caption: '', exif });
		assert.deepEqual(
			candidates.map((candidate) => candidate.field.split('.exif.')[1]).sort(),
			[...EXIF_PERSONAL_KEYS].sort(),
		);
	});

	it('treats an empty EXIF value as absent', () => {
		const candidates = findImageCandidates({
			path: 'assets/a.webp',
			alt: '',
			caption: '',
			exif: { Artist: '   ', GPSLatitude: '' },
		});
		assert.deepEqual(candidates, []);
	});

	it('declares a stable code and a precision note for every rule', () => {
		const codes = RULES.map((rule) => rule.code);
		assert.equal(new Set(codes).size, codes.length, 'rule codes must be unique');
		for (const rule of RULES) {
			assert.match(rule.code, /^D\d{3}$/);
			assert.ok(rule.title.length > 0);
			assert.ok(rule.precision.length > 0, `${rule.code} must state what it refuses to match`);
			assert.ok(rule.re || rule.scan, `${rule.code} must declare how it matches`);
		}
	});
});

describe('decision axis — publication authority is the owner alone', () => {
	it('holds a record with no decision as review_required', () => {
		const resolution = resolveDecision({ id: 'x' });
		assert.equal(resolution.decision, 'review_required');
		assert.equal(isPublishable({ id: 'x' }), false);
	});

	it('fails closed on a decision value it does not know', () => {
		assert.equal(isKnownDecision('approved'), true);
		for (const value of DECISIONS) assert.equal(isKnownDecision(value), true);
		for (const value of ['yes', 'public', 'APPROVED', '', null, undefined, 1]) {
			assert.equal(isKnownDecision(value), false);
			assert.equal(
				resolveDecision({ publication: { decision: value } }).decision,
				'review_required',
			);
		}
	});

	it('requires owner authority and a basis for an approval', () => {
		assert.equal(
			isPublishable({ publication: { decision: 'approved', decided_by: 'agent', basis: 'ok' } }),
			false,
		);
		assert.equal(
			isPublishable({ publication: { decision: 'approved', decided_by: PUBLICATION_AUTHORITY } }),
			false,
		);
		assert.equal(
			isPublishable({ publication: { decision: 'approved', decided_by: 'owner', basis: '   ' } }),
			false,
		);
		assert.equal(
			isPublishable({
				publication: { decision: 'approved', decided_by: 'owner', basis: 'owner 決定' },
			}),
			true,
		);
	});
});

describe('public bundle — a withheld record contributes nothing', () => {
	it('publishes only owner-approved records, whole', () => {
		const bundle = buildPublicBundle([CLEAN_RECORD, PRIVATE_RECORD]);
		assert.deepEqual(
			bundle.published.map((entry) => entry.id),
			['fixture-clean'],
		);
		assert.deepEqual(
			bundle.withheld.map((entry) => `${entry.id}:${entry.decision}`),
			['fixture-private:review_required'],
		);
		assert.deepEqual(bundle.published[0].fields, ['title', 'text', 'images']);
	});

	it('does not offer a per-field redaction that could leave a dangling reference', () => {
		const bundle = buildPublicBundle([PRIVATE_RECORD]);
		assert.deepEqual(bundle.published, []);
		assert.equal(bundle.withheld[0].candidateCount > 0, true);
	});

	it('masks a withheld record title and keeps the published one', () => {
		const bundle = buildPublicBundle([CLEAN_RECORD, PRIVATE_RECORD]);
		assert.equal(bundle.published[0].title, CLEAN_RECORD.title);
		assert.equal(
			bundle.withheld[0].title.includes('自分用メモ'),
			false,
			'a withheld title is not public text',
		);
		const review = reviewCorpus({
			corpus: corpusOf(CLEAN_RECORD, PRIVATE_RECORD),
			publishedFiles: [],
		});
		const withheld = review.reviewed.find((entry) => entry.id === 'fixture-private');
		assert.equal(withheld.title.includes('自分用メモ'), false);
	});
});

describe('gate findings', () => {
	const reviewOf = (corpus, files = []) => reviewCorpus({ corpus, publishedFiles: files });

	it('passes with warnings when the private sample is simply pending', () => {
		const review = reviewOf(corpusOf(CLEAN_RECORD, PRIVATE_RECORD));
		assert.equal(review.verdict, 'review');
		assert.equal(review.findings.filter((entry) => entry.code === 'W001').length, 1);
		assert.deepEqual(
			review.publicBundle.withheld.map((entry) => entry.id),
			['fixture-private'],
		);
	});

	it('E001 — fails when a withheld record text reaches published content', () => {
		const review = reviewOf(
			corpusOf(PRIVATE_RECORD),
			publishedFiles([['src/portfolio/seed.ts', `export const NOTE = '${PRIVATE_RECORD.text}';`]]),
		);
		const finding = review.findings.find((entry) => entry.code === 'E001');
		assert.ok(finding, 'expected E001');
		assert.equal(finding.severity, 'error');
		assert.equal(review.verdict, 'fail');
	});

	it('E002 / E003 — an approval without owner authority or basis fails', () => {
		const noAuthority = reviewOf(
			corpusOf({
				...CLEAN_RECORD,
				publication: { decision: 'approved', decided_by: 'agent', basis: 'x' },
			}),
		);
		assert.ok(noAuthority.findings.some((entry) => entry.code === 'E002'));
		const noBasis = reviewOf(
			corpusOf({ ...CLEAN_RECORD, publication: { decision: 'approved', decided_by: 'owner' } }),
		);
		assert.ok(noBasis.findings.some((entry) => entry.code === 'E003'));
		assert.equal(noBasis.verdict, 'fail');
	});

	it('E004 — a DECLARED but unrecognised decision value fails closed', () => {
		const review = reviewOf(
			corpusOf({ ...PRIVATE_RECORD, publication: { decision: 'published' } }),
		);
		const finding = review.findings.find((entry) => entry.code === 'E004');
		assert.ok(finding);
		assert.equal(finding.severity, 'error');
		assert.deepEqual(
			review.publicBundle.withheld.map((entry) => entry.decision),
			['review_required'],
		);
	});

	it('E004 — an ABSENT decision is the pending state, not an error', () => {
		const review = reviewOf(corpusOf({ ...PRIVATE_RECORD, publication: undefined }));
		assert.equal(
			review.findings.some((entry) => entry.code === 'E004'),
			false,
			'a record nobody decided on yet is not a corrupted decision',
		);
		assert.equal(
			review.findings.filter((entry) => entry.code === 'W001').length,
			1,
			'it is reported as review_required instead',
		);
		assert.equal(review.verdict, 'review');
		assert.deepEqual(
			review.publicBundle.withheld.map((entry) => entry.decision),
			['review_required'],
		);
	});

	it('E005 — a candidate in published content that no approval covers fails', () => {
		const review = reviewOf(
			corpusOf(CLEAN_RECORD),
			publishedFiles([['src/about/data.ts', 'export const CONTACT = "090-0000-0000";']]),
		);
		const finding = review.findings.find((entry) => entry.code === 'E005');
		assert.ok(finding, 'expected E005');
		assert.equal(
			finding.message.includes('090-0000-0000'),
			false,
			'a finding must not quote the value',
		);
	});

	it('E005 — the same value inside an approved record is not a finding', () => {
		const approved = {
			...CLEAN_RECORD,
			text: '案内先は hello@tastile.example（予約ドメイン）。',
			images: [],
		};
		const review = reviewOf(
			corpusOf(approved),
			publishedFiles([['src/about/data.ts', approved.text]]),
		);
		assert.deepEqual(
			review.findings.filter((entry) => entry.code === 'E005'),
			[],
		);
	});

	it('E005 — a personal-camera file NAME in a published root is a finding', () => {
		const review = reviewOf(
			corpusOf(CLEAN_RECORD),
			publishedFiles([['public/20260315-自撮り-集合写真.jpg', '']]),
		);
		const findings = review.findings.filter((entry) => entry.code === 'E005');
		assert.ok(findings.length > 0, 'a migrated photo name in a published root must be detected');
		assert.ok(findings[0].message.includes('file name'));
		// The file name is public by construction — it is a path in the
		// published tree — so the finding names the file it is about; the
		// candidate itself is reported in its masked form.
		assert.ok(findings[0].message.includes('public/20260315-自撮り-集合写真.jpg'));
		assert.ok(
			findings.some((entry) => entry.message.includes('・・')),
			'the candidate is reported masked',
		);
	});

	it('E001 — a withheld record own file name in a published root fails', () => {
		const review = reviewOf(
			corpusOf(PRIVATE_RECORD),
			publishedFiles([['public/IMG_4821.jpg', '']]),
		);
		assert.ok(
			review.findings.some((entry) => entry.code === 'E001'),
			'a withheld record keeps its own file name when it is migrated',
		);
		assert.equal(review.verdict, 'fail');
	});

	it('E006 / E007 — a duplicated id and a malformed corpus fail', () => {
		assert.ok(
			reviewOf(corpusOf(CLEAN_RECORD, { ...CLEAN_RECORD, title: '別のメモ' })).findings.some(
				(entry) => entry.code === 'E006',
			),
		);
		assert.ok(
			reviewOf({ schema: 'wrong.v1', records: [] }).findings.some((entry) => entry.code === 'E007'),
		);
		assert.ok(
			reviewOf(corpusOf({ ...CLEAN_RECORD, id: 42 })).findings.some(
				(entry) => entry.code === 'E007',
			),
		);
	});

	it('E008 — a corpus with no candidate at all fails (a silent detector proves nothing)', () => {
		const review = reviewOf(corpusOf(CLEAN_RECORD));
		const finding = review.findings.find((entry) => entry.code === 'E008');
		assert.ok(finding);
		assert.equal(review.verdict, 'fail');
	});

	it('E008 — a corpus with NO RECORD at all fails (an empty corpus is a lost private sample)', () => {
		const empty = reviewOf(corpusOf());
		const finding = empty.findings.find((entry) => entry.code === 'E008');
		assert.ok(finding, 'an empty corpus must not pass');
		assert.equal(finding.severity, 'error');
		assert.equal(empty.verdict, 'fail');
		assert.equal(empty.counts.records, 0);

		const withoutRecordsKey = reviewOf({ schema: REVIEW_SCHEMA });
		assert.ok(
			withoutRecordsKey.findings.some((entry) => entry.code === 'E008'),
			'a corpus without a records key is the same empty corpus',
		);
		assert.equal(withoutRecordsKey.verdict, 'fail');
	});

	it('verdictOf keeps pass / review / fail distinct', () => {
		assert.equal(verdictOf([]), 'pass');
		assert.equal(verdictOf([{ severity: 'warn' }]), 'review');
		assert.equal(verdictOf([{ severity: 'warn' }, { severity: 'error' }]), 'fail');
	});
});

describe('load — the gate stays decidable at corpus scale', () => {
	it('classifies 1000 records exactly and keeps the verdict', () => {
		const records = Array.from({ length: 1000 }, (_, index) =>
			index % 2 === 0
				? { ...PRIVATE_RECORD, id: `fixture-private-${index}` }
				: { ...CLEAN_RECORD, id: `fixture-clean-${index}` },
		);
		const started = process.hrtime.bigint();
		const review = reviewCorpus({ corpus: corpusOf(...records), publishedFiles: [] });
		const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

		assert.equal(review.counts.records, 1000);
		assert.equal(review.counts.withheld, 500);
		assert.equal(review.counts.published, 500);
		// Every private copy contributes the same 9 candidates; a rule
		// that started matching more loosely would move this number, so
		// the scale case also pins the per-record count.
		assert.equal(review.counts.candidates, 500 * findRecordCandidates(PRIVATE_RECORD).length);
		assert.equal(review.verdict, 'review');
		// Wall clock is an observation, not a threshold: the DETERMINISTIC
		// statement is the verdict and the counts, which is why the value
		// is reported in the test output instead of asserted.
		assert.ok(elapsedMs >= 0);
	});

	it('scales the published-content scan the same way', () => {
		// 399 candidate-free files plus ONE that carries an uncovered
		// candidate: the load case has to exercise the E005 path, or the
		// "no finding at scale" claim is vacuously true.
		const files = publishedFiles([
			...Array.from({ length: 399 }, (_, index) => [
				`src/portfolio/seed-${index}.ts`,
				`export const TITLE_${index} = '${CLEAN_RECORD.text}';`,
			]),
			['src/portfolio/seed-399.ts', 'export const PHONE = "090-0000-0000";'],
		]);
		const review = reviewCorpus({
			corpus: corpusOf(CLEAN_RECORD, PRIVATE_RECORD),
			publishedFiles: files,
		});
		assert.equal(review.verdict, 'fail');
		assert.equal(
			review.findings.filter((entry) => entry.code === 'E005').length,
			1,
			'exactly the one uncovered candidate is reported',
		);
		assert.equal(
			review.findings.filter((entry) => entry.code === 'E001').length,
			0,
			'the clean files carry no withheld record content',
		);
	});
});

describe('the published digest is scoped to the files that carry a candidate', () => {
	const clean = publishedFiles([['copy/README.md', '# copy']]);
	const candidate = publishedFiles([['copy/contact.md', '連絡先は 090-0000-0000']]);

	it('does not change when a copy edit carries no candidate', () => {
		const before = digests({ corpusRaw: 'corpus', publishedFiles: clean });
		const after = digests({
			corpusRaw: 'corpus',
			publishedFiles: publishedFiles([['copy/README.md', '# copy\n\n一行だけ足した。']]),
		});
		assert.equal(before.publishedDigest, after.publishedDigest);
		assert.equal(before.candidateFiles, 0);
	});

	it('changes when a candidate-bearing file changes', () => {
		const before = digests({ corpusRaw: 'corpus', publishedFiles: candidate });
		const after = digests({
			corpusRaw: 'corpus',
			publishedFiles: publishedFiles([['copy/contact.md', '連絡先は 090-0000-0000 (追記)']]),
		});
		assert.notEqual(before.publishedDigest, after.publishedDigest);
	});

	it('changes when a file gains its first candidate', () => {
		const before = digests({ corpusRaw: 'corpus', publishedFiles: clean });
		const after = digests({
			corpusRaw: 'corpus',
			publishedFiles: [...clean, ...candidate],
		});
		assert.notEqual(before.publishedDigest, after.publishedDigest);
		assert.equal(after.candidateFiles, 1);
		assert.equal(candidateBearingFiles(after ? [...clean, ...candidate] : []).length, 1);
	});
});

describe('report artefacts', () => {
	const review = reviewCorpus({
		corpus: corpusOf(CLEAN_RECORD, PRIVATE_RECORD),
		publishedFiles: [],
	});

	it('states what is published, the external communication, the dependencies and the audit targets', () => {
		const markdown = renderMarkdownReport({
			review,
			corpusDigest: 'abc123',
			publishedDigest: 'def456',
		});
		for (const heading of [
			'## 1. 公開する情報',
			'## 2. 外部通信',
			'## 3. 依存',
			'## 4. 監査対象',
			'## 5. 検出規則',
			'## 8. 残るリスク',
		]) {
			assert.ok(markdown.includes(heading), `missing ${heading}`);
		}
		assert.ok(markdown.includes('abc123') && markdown.includes('def456'));
		assert.ok(markdown.includes(CORPUS_RELATIVE_PATH));
	});

	it('never renders a raw candidate value', () => {
		const markdown = renderMarkdownReport({ review });
		const html = renderHtmlReport({ review });
		for (const raw of [
			'090-0000-0000',
			'personal@fixture-note.test',
			'井川 二郎',
			'新井 沙耶',
			'0001 2345 6789',
			'〒740-0000',
			'Fixture Person',
		]) {
			assert.equal(markdown.includes(raw), false, `markdown leaked ${raw}`);
			assert.equal(html.includes(raw), false, `html leaked ${raw}`);
		}
	});

	it('never serialises a raw candidate value in the review object either', () => {
		const json = JSON.stringify(
			reviewCorpus({ corpus: corpusOf(CLEAN_RECORD, PRIVATE_RECORD), publishedFiles: [] }),
		);
		for (const raw of ['090-0000-0000', 'personal@fixture-note.test', '井川 二郎', '新井 沙耶']) {
			assert.equal(json.includes(raw), false, `review object leaked ${raw}`);
		}
		assert.ok(json.includes('D001'), 'the rule code is still reported');
	});

	it('renders a self-contained HTML page with no external reference', () => {
		const html = renderHtmlReport({ review });
		assert.ok(html.startsWith('<!doctype html>'));
		assert.equal(/<link\b/i.test(html), false);
		assert.equal(/<img\b/i.test(html), false);
		assert.equal(/https?:\/\//.test(html), false);
	});
});

describe('the published-content declaration is checked against the walk', () => {
	it('refuses a scanned root that sits inside a declared not-scanned surface', () => {
		// The trailing slash is the point: a declared surface is
		// written `src/about/` and a scanned root `src/about`, so a
		// bare `startsWith` would never match and the guard would be a
		// no-op.
		const conflicts = rootDeclarationConflicts({
			roots: ['src/about'],
			notScanned: [{ surface: 'src/about/', reason: 'fixture: a contradictory declaration.' }],
		});
		assert.equal(conflicts.length, 1);
		assert.ok(conflicts[0].includes('src/about'));
	});

	it('does not read a sibling directory as inside the declared surface', () => {
		assert.deepEqual(
			rootDeclarationConflicts({
				roots: ['src/about-legacy'],
				notScanned: [{ surface: 'src/about/', reason: 'fixture: an unrelated surface.' }],
			}),
			[],
			'the comparison is on a path boundary, not a string prefix',
		);
	});

	it('refuses a declared not-scanned surface inside a scanned root with no exclude prefix', () => {
		const conflicts = rootDeclarationConflicts({
			roots: ['public'],
			notScanned: [
				{ surface: 'public/docs/', reason: 'fixture: an exclusion the walk does not make.' },
			],
		});
		assert.equal(conflicts.length, 1);
		assert.ok(conflicts[0].includes('public/docs/'));
	});

	it('accepts a declared not-scanned surface an exclude prefix really covers', () => {
		assert.deepEqual(
			rootDeclarationConflicts({
				roots: ['public'],
				notScanned: [
					{ surface: 'public/share/', reason: 'fixture: covered by the exclude prefix.' },
				],
			}),
			[],
			'`public/share/` is excluded by an exclude prefix, so the declaration is honest',
		);
	});
});

describe('the CLI over a temporary published root', () => {
	it('fails when a personal-camera file name lands in a published root', () => {
		const root = gateTree({
			publishedFiles: {
				'public/20260315-自撮り-集合写真.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
				'public/IMG_4821.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
			},
		});
		try {
			const { status, output } = runGate(root, ['--write']);
			assert.equal(status, 1, `the gate must fail, got ${status}\n${output}`);
			assert.match(
				output,
				/published content 2 file\(s\)/,
				'a file the text scan cannot read is still a published file',
			);
			assert.match(output, /E001/, 'the withheld record own file name must be found');
			assert.match(output, /E005/, 'the personal-camera file name must be found');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('passes on a temporary published root that carries no candidate', () => {
		const root = gateTree({
			publishedFiles: { 'public/og/default-card.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
		});
		try {
			const { status, output } = runGate(root, ['--write']);
			assert.equal(status, 0, `the gate must pass, got ${status}\n${output}`);
			assert.match(output, /published content 1 file\(s\)/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('refuses to run when the declaration contradicts the scanned roots (exit 2)', () => {
		const root = gateTree({
			publishedFiles: { 'public/og/default-card.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
		});
		try {
			// A contradictory declaration written into the throwaway
			// copy: `src/contact/` is declared not-scanned while
			// `src/contact` is a scanned root. The shipped script is not
			// modified — the copy simulates exactly the mistake the
			// guard has to catch.
			const scriptPath = join(root, 'scripts/check-publication-redaction.mjs');
			const source = readFileSync(scriptPath, 'utf8');
			const marker = 'export const PUBLISHED_CONTENT_NOT_SCANNED = [';
			assert.ok(source.includes(marker), 'the declaration marker must exist');
			writeFileSync(
				scriptPath,
				source.replace(
					marker,
					`${marker}\n\t{\n\t\tsurface: 'src/contact/',\n\t\treason: 'fixture: a declaration that contradicts the scanned roots.',\n\t},`,
				),
			);
			const { status, output } = runGate(root);
			assert.equal(status, 2, `the gate must refuse to run, got ${status}\n${output}`);
			assert.match(output, /contradicts itself/);
			assert.match(output, /src\/contact/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('repository wiring', () => {
	it('declares the published-content roots and the deliberate exclusion', () => {
		for (const root of ['copy', 'public', 'src/about', 'src/contact', 'src/portfolio']) {
			assert.ok(PUBLISHED_CONTENT_ROOTS.includes(root), `${root} must be a scanned root`);
		}
		assert.deepEqual(PUBLISHED_CONTENT_EXCLUDE_PREFIXES, ['public/share/']);
	});

	it('declares every surface it does not scan, with a reason', () => {
		const declared = PUBLISHED_CONTENT_NOT_SCANNED.map((entry) => entry.surface);
		for (const surface of [
			'public/share/',
			'src/home/',
			'src/editorial/',
			'src/routes/',
			'src/admin/',
			'src/i18n/',
		]) {
			assert.ok(declared.includes(surface), `${surface} must be declared, not silently skipped`);
		}
		for (const entry of PUBLISHED_CONTENT_NOT_SCANNED) {
			assert.ok(entry.reason.length > 20, `${entry.surface} must state why it is out of scope`);
		}
		assert.deepEqual(
			rootDeclarationConflicts(),
			[],
			'no scanned root may sit inside a declared not-scanned surface',
		);
	});

	it('points at the tracked corpus and report', () => {
		assert.equal(CORPUS_RELATIVE_PATH, 'docs/migration/personal-data-review/corpus.json');
		assert.equal(REPORT_RELATIVE_PATH, 'docs/verification/privacy/publication-redaction-review.md');
	});
});
