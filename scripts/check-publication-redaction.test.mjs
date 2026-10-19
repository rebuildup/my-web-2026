import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CORPUS_RELATIVE_PATH,
	PUBLISHED_CONTENT_EXCLUDE_PREFIXES,
	PUBLISHED_CONTENT_ROOTS,
	REPORT_RELATIVE_PATH,
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
			assert.ok(!candidate.matched, 'a reported candidate must not carry the raw match');
			assert.equal(typeof candidate.masked, 'string');
			assert.equal(candidate.masked.includes('090-0000-0000'), false);
			assert.equal(candidate.masked.includes('personal@fixture-note.test'), false);
			assert.equal(candidate.masked.includes('井川'), false);
			assert.equal(candidate.masked.includes('新井'), false);
		}
		const email = candidates.find((candidate) => candidate.code === 'D001');
		assert.equal(email.masked, '########@#################');
	});

	it('masks every script class', () => {
		assert.equal(maskValue('090-0000-0000'), '###-####-####');
		assert.equal(maskValue('井川 二郎'), '・・ ・・');
		assert.equal(maskValue('Dr. Fixture Person'), 'xx. xxxxxxx xxxxxx');
	});
});

describe('detection — precision over recall', () => {
	it('does not read a version, a date or a ratio as a phone number', () => {
		assert.deepEqual(codesOf(findTextCandidates('2026-09-19 公開、v0.7.0、ratio 0.75')), []);
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

	it('E004 — an unrecognised decision value fails closed', () => {
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

	it('verdictOf keeps pass / review / fail distinct', () => {
		assert.equal(verdictOf([]), 'pass');
		assert.equal(verdictOf([{ severity: 'warn' }]), 'review');
		assert.equal(verdictOf([{ severity: 'warn' }, { severity: 'error' }]), 'fail');
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

	it('renders a self-contained HTML page with no external reference', () => {
		const html = renderHtmlReport({ review });
		assert.ok(html.startsWith('<!doctype html>'));
		assert.equal(/<link\b/i.test(html), false);
		assert.equal(/<img\b/i.test(html), false);
		assert.equal(/https?:\/\//.test(html), false);
	});
});

describe('repository wiring', () => {
	it('declares the published-content roots and the deliberate exclusion', () => {
		for (const root of ['copy', 'public', 'src/about', 'src/portfolio']) {
			assert.ok(PUBLISHED_CONTENT_ROOTS.includes(root), `${root} must be a scanned root`);
		}
		assert.deepEqual(PUBLISHED_CONTENT_EXCLUDE_PREFIXES, ['public/share/']);
	});

	it('points at the tracked corpus and report', () => {
		assert.equal(CORPUS_RELATIVE_PATH, 'docs/migration/personal-data-review/corpus.json');
		assert.equal(REPORT_RELATIVE_PATH, 'docs/verification/privacy/publication-redaction-review.md');
	});
});
