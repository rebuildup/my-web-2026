/**
 * Personal-data review contract (Issue #494).
 *
 * Why this module exists
 * ----------------------
 * `docs/personal/knowledge-model.md` separates **truth authority**
 * from **publication authority**: a fact can be true and still be
 * unpublishable, and only the owner may decide which is which. The
 * migration corpus (Miro boards, the my-web-2025 site, Notion
 * pages) carries text and images the owner never wrote for a public
 * surface — addresses, contact channels, and other people's names
 * arrive as a side effect of moving a board, not as a decision.
 *
 * So the review is two independent axes, in that order:
 *
 *   1. **detection** — mechanical, fail-closed. Every personal-data
 *      candidate is extracted from the migrated record's text and
 *      from its image descriptors (alt / caption / file name / EXIF).
 *      The rules below are deliberately precision-oriented: a rule
 *      that fires on ordinary Japanese prose would train reviewers to
 *      ignore the report, and every missed candidate republishes a
 *      real person's data.
 *   2. **decision** — owner-only. `decision: 'approved'` additionally
 *      requires `decided_by: 'owner'` and a non-empty `basis`, so an
 *      agent cannot approve its own proposal (the knowledge-model
 *      authority table: `publish / unpublish` is owner-only).
 *
 * A record that carries candidates and has no owner decision stays
 * `review_required`, and a `review_required` / `rejected` record
 * contributes **nothing** to the public bundle. There is no
 * per-field redaction on purpose: a partial rewrite of a migrated
 * record leaves dangling references to the part that was removed,
 * so the unit the owner decides is the whole record.
 *
 * Everything here is a pure function of injected inputs (a corpus
 * object, a list of published content files), so the contract is
 * provable with independent fixtures instead of the live repository.
 * Filesystem access and exit codes live in
 * `scripts/check-publication-redaction.mjs`; this module never reads
 * a file, opens a socket, or reads a binding.
 *
 * Reporting discipline: a candidate's raw value never leaves this
 * process. Reports and CI output carry the rule id, the field, the
 * offset and a masked form (`maskValue`), so a report screenshot in
 * a pull request cannot republish the data it is about — the same
 * contract `src/logging/redact.ts` holds for log records.
 */

/** Snapshot / corpus schema identifier. Bump on any breaking shape change. */
export const REVIEW_SCHEMA = 'personal-data-review.v1';

/**
 * Owner decisions a migrated record can carry. Anything else is
 * treated as `review_required` (fail closed) rather than guessed at.
 */
export const DECISIONS = ['approved', 'review_required', 'rejected'];

/** The only actor allowed to approve publication of a migrated record. */
export const PUBLICATION_AUTHORITY = 'owner';

/** Fields of a record the detector scans, in report order. */
export const SCANNED_TEXT_FIELDS = ['title', 'text'];

/** Image descriptor fields that ship as visible text on a surface. `path` is separate: its rule (`D011`) reads the file name, not free text. */
export const SCANNED_IMAGE_TEXT_FIELDS = ['alt', 'caption'];

const KANJI = '\\u4e00-\\u9fff';
const KANA = '\\u3040-\\u30ff';
/** One Japanese-script character. Used by the address / name rules. */
const JP = `[${KANJI}${KANA}]`;

/**
 * EXIF / image-metadata keys that carry an identity or a position.
 *
 * The detector reads the metadata a migrator already extracted into
 * the record — it never decodes an image and never reads pixels. That
 * boundary is stated rather than implied: OCR is out of scope here
 * (see `docs/security/personal-data-redaction.md`), so a face or a
 * document photographed into an image is a remaining risk a reviewer
 * must judge by looking at the asset.
 *
 * `Make` / `Model` are intentionally absent: a camera model is a
 * device, not a person.
 */
export const EXIF_PERSONAL_KEYS = [
	'GPSLatitude',
	'GPSLongitude',
	'GPSPosition',
	'GPSAltitude',
	'GPSImgDirection',
	'Artist',
	'OwnerName',
	'CameraOwnerName',
	'UserComment',
	'ImageDescription',
	'Copyright',
	'HostComputer',
	'BodySerialNumber',
	'CameraSerialNumber',
];

/**
 * Detection rules.
 *
 * Every row is `{ code, title, class, re?, scan?, mask, precision }`:
 *
 *   - `re`   a text rule over the record's scanned fields,
 *   - `scan` a structured rule over the image descriptors,
 *   - `mask` how a matched value is rendered in a report,
 *   - `precision` the one-line statement of what the rule refuses to
 *     match, because a reviewer has to know why a candidate did NOT
 *     fire before trusting a decision.
 *
 * Codes are stable identifiers: they are cited in the pull request and
 * in the verification report, so a rule is never renumbered.
 */
export const RULES = [
	{
		code: 'D001',
		title: 'メールアドレス',
		class: 'contact',
		re: /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![\w.@-])/g,
		mask: (value) => value.replace(/[^@]/g, '#'),
		precision:
			'shape のみ。`.example` / example.test を含むリザーブドドメインも検出する (公開可否は判定 axis が持つ)。',
	},
	{
		code: 'D002',
		title: '電話番号 (JP 携帯 / PHS / 固定電話 / +81)',
		class: 'contact',
		re: /(?<![\d\-+])(?:\+81[-\s]?)?0(?:70|80|90|50|60)[-\s]?\d{2,4}[-\s]?\d{3,4}(?![\d-])|(?<![\d\-])0\d{1,3}-\d{2,4}-\d{3,4}(?![\d-])/g,
		mask: (value) => value.replace(/\d/g, '#'),
		precision:
			'ハイフン区切りの数字列だけを電話番号とみなす。`2026-09-19` のような日付と版数 `v2.1.0` には一致しない。',
	},
	{
		code: 'D003',
		title: '郵便番号 (〒)',
		class: 'address',
		re: /〒\s*\d{3}-\d{4}/g,
		mask: (value) => value.replace(/\d/g, '#'),
		precision: '`〒NNN-NNNN` 表記のみ。数値だけの郵便番号は検出しない。',
	},
	{
		code: 'D004',
		title: '住所 (都道府県 + 市区町村 + 丁目 / 番地 / 号)',
		class: 'address',
		re: new RegExp(
			`${JP}{1,4}(?:都|道|府|県)\\s*${JP}{1,8}(?:市|区|郡|町村)\\s*${JP}{0,12}?\\d+(?:[-‐−ー]\\d+)*\\s*(?:丁目|番地|号|条|軒)`,
			'g',
		),
		mask: (value) => value.replace(new RegExp(JP, 'g'), '・'),
		precision:
			'番地レベルまで書かれた住所のみ。県名・市名だけの言及 (例: 出身校の市名) は検出しない。',
	},
	{
		code: 'D005',
		title: '居住の主張 (〇〇県△△市在住 / 出身 / お住まい)',
		class: 'address',
		re: new RegExp(
			`${JP}{1,4}(?:都|道|府|県)\\s*${JP}{1,8}(?:市|区|郡|町村)\\s*(?:に?\\s*)(?:在住|出身|通勤|勤務中)|${JP}{2,8}(?:市|区|町|村)にお住まい`,
			'g',
		),
		mask: (value) => value.replace(new RegExp(JP, 'g'), '・'),
		precision: '地域と居住の主張が同じ文に現れる場合のみ。場所名だけの記述は検出しない。',
	},
	{
		code: 'D006',
		title: '第三者本人の氏名 (敬称付き日本語名)',
		class: 'person',
		re: new RegExp(`${JP}{1,6}(?:さん|様|氏|くん|ちゃん)`, 'g'),
		mask: (value) => value.replace(new RegExp(JP, 'g'), '・'),
		precision:
			'`皆さん` / `皆様` / `各方` / `仕様` などの一般語と、敬称の前が 1 文字だけの語は除外する。名寄せ (照合) は行わない — 同一人物の判断は owner の判定 axis。`specification` 相当の語が誤検出になると、レビュー担当は報告を無視しはじめる。',
		skip: (value) => !isLikelyPersonName(value),
	},
	{
		code: 'D007',
		title: '第三者本人の氏名 (敬称付きラテン名)',
		class: 'person',
		re: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
		mask: (value) =>
			value.replace(/\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+/i, '').replace(/[A-Za-z]/g, 'x'),
		precision:
			'敬称つきの Firstname Lastname のみを対象。敬称なしの英語名・固有名詞・プロダクト名は検出しない。',
	},
	{
		code: 'D008',
		title: '生年月日',
		class: 'person',
		re: /(?:生年月日|誕生日|Date of Birth|DOB)\s*[:：]?|(?:19|20)\d{2}\s*[年/\-.]\s*\d{1,2}\s*[月/\-.]\s*\d{1,2}\s*日\s*(?:生まれ|生まれです|時点)/g,
		mask: (value) => value.replace(/\d/g, '#'),
		precision:
			'`生年月日` / `誕生日` のラベル、または「〇〇年〇〇月〇〇日生まれ」の形のみ。通常の年月日 (`2026-09-19`) は一致しない。',
	},
	{
		code: 'D009',
		title: 'マイナンバー等の 12 桁識別番号',
		class: 'identifier',
		re: /(?<![\d-])\d{4}[-\s]?\d{4}[-\s]?\d{4}(?![\d-])/g,
		mask: (value) => value.replace(/\d/g, '#'),
		precision: '4-4-4 の 12 桁のみ。電話番号 (3-4-4) と日付 (2 桁月日) には一致しない。',
	},
	{
		code: 'D010',
		title: '画像メタデータの身元 / 位置情報 (EXIF)',
		class: 'image',
		scan: 'exif',
		mask: (value) => `${EXIF_PERSONAL_KEYS.includes(value) ? value : '[exif-key]'}`,
		precision:
			'migrator が抽出した EXIF キー (`Artist` / `UserComment` / `GPS*` / …) のみ。カメラ機種 (Make / Model) と撮影日時 (DateTimeOriginal) は含めない。',
	},
	{
		code: 'D011',
		title: '個人撮影を前提としたファイル名 (自撮り / 自宅 / 連番カメラ名)',
		class: 'image',
		re: /(?:自撮り|自宅|私物)|(?:20\d{6}[-_])|(?:DSC[_-]?\d{4,})|(?:IMG[_-]\d{4,})(?:\.[A-Za-z0-9]{2,4})?/g,
		mask: (value) => value.replace(/\d/g, '#'),
		precision:
			'個人撮影を前提とした語 (`自撮り` / `自宅` / `私物`) とカメラ既定名のみ。`og/default-card.png` のような 发布用アセット名は一致しない。',
	},
];

/**
 * 敬称付き日本語名の候補が「，第三者の本人名」でない一般語。
 *
 * 一文字 + 敬称 (`皆さん`) は規則側で除外し、それ以外はこの集合で
 * 除外する。検出側だけを完美にするより、誤検出の語を明示してレビュー
 * 側が「なぜ出なかったか」を説明できるようにする。
 */
const NAME_STOPLIST = new Set([
	'皆様',
	'皆さん',
	'みなさん',
	'各方',
	'各位',
	'諸兄',
	'本社',
	'貴社',
	'御社',
	'弊社',
	'同事',
	'同業',
	'先方',
	'関係者',
	'本人',
	'その方',
	'全社',
	'当社',
	'当該',
	'全件',
	'本日',
	'明日',
	'昨日',
	'以前',
	'以来',
	'以上',
	'全部',
	'合計',
	'仕様',
	'同様',
	'一様',
	'多様',
	'表現',
	'表示',
	'画像',
	'匿名',
	'同氏',
	'別氏',
	'本人',
	'会員',
	'全員',
	'家族',
	'友人',
	'来場者',
	'参加者',
	'関係者',
	'利用者',
	'閲覧者',
	'閲覧者',
	'作成者',
	'編集者',
	'提供者',
]);

/**
 * `田中さん` は本人名、`皆さん` / `各位さん` は一般語。
 *
 * 敬称の直前が 1 文字だけの語 (`皆`, `各`) は、それ自体が敬称と
 * 語になる一般語なので除外する。
 */
export function isLikelyPersonName(value) {
	const honourific = /(?:さん|様|氏|くん|ちゃん)$/.exec(value);
	if (!honourific) return false;
	const stem = value.slice(0, value.length - honourific[0].length);
	if (stem.length <= 1) return false;
	if (NAME_STOPLIST.has(value)) return false;
	return true;
}

/**
 * Mask one matched value for a report.
 *
 * Digits become `#`, ASCII letters become `x`, and every Japanese-script
 * character becomes `・`, so a name / address / identifier is reported by
 * shape and length only. The raw value stays inside this module.
 */
export function maskValue(value) {
	return String(value)
		.replace(/\d/g, '#')
		.replace(/[A-Za-z]/g, 'x')
		.replace(new RegExp(JP, 'g'), '・');
}

/**
 * One detected candidate.
 *
 * `at` locates it (`field` + character offset, or `images[2].exif.GPSLatitude`),
 * `masked` is the report-safe rendering. The raw match is deliberately
 * NOT part of the public shape of this record — callers that need the
 * literal re-derive it from the corpus they already hold.
 */
export function candidateOf(rule, field, match, index) {
	return {
		code: rule.code,
		title: rule.title,
		class: rule.class,
		field,
		at: `${field} offset ${index}`,
		masked: rule.mask ? rule.mask(match) : maskValue(match),
	};
}

/**
 * Raw matches of every text rule over one string.
 *
 * INTERNAL to this module: the value is what a decision must be made
 * about, so it cannot leave — `findTextCandidates` masks it, and
 * `reviewCorpus` uses the raw form only to decide coverage. Nothing in
 * the rendered report, the CLI output or the API of this module
 * exposes it.
 */
export function rawTextMatches(text) {
	const found = [];
	if (typeof text !== 'string' || text.length === 0) return found;
	for (const rule of RULES) {
		if (!rule.re) continue;
		for (const match of text.matchAll(rule.re)) {
			if (rule.skip?.(match[0])) continue;
			found.push({ rule, value: match[0], index: match.index ?? 0 });
		}
	}
	return found.sort((a, b) => a.index - b.index);
}

/**
 * Text rules over one string, reported in masked form. `field` is only
 * used for the report.
 */
export function findTextCandidates(text, field = 'text') {
	return rawTextMatches(text).map((hit) => candidateOf(hit.rule, field, hit.value, hit.index));
}

/**
 * Image-descriptor rules: EXIF keys whose value is an identity or a
 * position, plus the file-name shape. The `path` is scanned as text so
 * `D011` can fire; `alt` / `caption` go through the text rules so a
 * captioned name in a Miro image is caught too.
 */
export function findImageCandidates(image, label = 'images[0]') {
	const found = [];
	if (!image || typeof image !== 'object') return found;
	for (const field of SCANNED_IMAGE_TEXT_FIELDS) {
		found.push(...findTextCandidates(image[field], `${label}.${field}`));
	}
	if (typeof image.path === 'string') {
		found.push(...findTextCandidates(image.path, `${label}.path`));
	}
	const exif = image.exif;
	if (exif && typeof exif === 'object') {
		for (const key of Object.keys(exif).sort()) {
			const value = exif[key];
			const populated = value !== undefined && value !== null && String(value).trim().length > 0;
			if (!EXIF_PERSONAL_KEYS.includes(key)) continue;
			if (!populated) continue;
			const rule = RULES.find((entry) => entry.code === 'D010');
			found.push({
				code: rule.code,
				title: rule.title,
				class: rule.class,
				field: `${label}.exif.${key}`,
				at: `${label}.exif.${key}`,
				masked: rule.mask ? rule.mask(key) : maskValue(key),
			});
		}
	}
	return found;
}

/** Every candidate one migrated record carries, in a stable order. */
export function findRecordCandidates(record) {
	if (!record || typeof record !== 'object') return [];
	const found = [];
	for (const field of SCANNED_TEXT_FIELDS) {
		found.push(...findTextCandidates(record[field], field));
	}
	const images = Array.isArray(record.images) ? record.images : [];
	images.forEach((image, index) => {
		found.push(...findImageCandidates(image, `images[${index}]`));
	});
	return found.sort((a, b) =>
		a.field < b.field ? -1 : a.field > b.field ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
	);
}

/** True when `decision` is one of the three declared states. */
export function isKnownDecision(decision) {
	return DECISIONS.includes(decision);
}

/**
 * Resolve one record's decision.
 *
 * Fail closed: an absent or unrecognised decision is `review_required`,
 * because the publication authority is the owner's and an unrecognised
 * value is not a decision at all.
 */
export function resolveDecision(record) {
	const declared = record?.publication?.decision;
	const decision = isKnownDecision(declared) ? declared : 'review_required';
	return {
		decision,
		declared: typeof declared === 'string' ? declared : null,
		decidedBy:
			typeof record?.publication?.decided_by === 'string' ? record.publication.decided_by : null,
		basis: typeof record?.publication?.basis === 'string' ? record.publication.basis.trim() : '',
	};
}

/** Is this record allowed to contribute to the public bundle? */
export function isPublishable(record) {
	const { decision, decidedBy, basis } = resolveDecision(record);
	return decision === 'approved' && decidedBy === PUBLICATION_AUTHORITY && basis.length > 0;
}

/**
 * The public bundle: what the migration would actually publish.
 *
 * Only records whose owner decision is complete (approved + owner +
 * basis) contribute, and they contribute whole — there is no per-field
 * redaction. Withheld records are listed with their candidate count so
 * the report can say what was held back and why, without repeating it.
 */
export function buildPublicBundle(records) {
	const published = [];
	const withheld = [];
	for (const record of records) {
		const candidates = findRecordCandidates(record);
		const entry = {
			id: record.id,
			source: record.source ?? null,
			title: record.title ?? '',
			candidateCount: candidates.length,
		};
		if (isPublishable(record)) {
			published.push({
				...entry,
				decision: resolveDecision(record).decision,
				basis: resolveDecision(record).basis,
				fields: [
					...SCANNED_TEXT_FIELDS.filter(
						(field) => typeof record[field] === 'string' && record[field].length > 0,
					),
					...(Array.isArray(record.images) && record.images.length > 0 ? ['images'] : []),
				],
			});
		} else {
			withheld.push({ ...entry, decision: resolveDecision(record).decision });
		}
	}
	return {
		published: published.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		withheld: withheld.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	};
}

const finding = (code, severity, message) => ({ code, severity, message });

/**
 * The gate decision.
 *
 * Errors are the fail-closed states:
 *   - a withheld record's own text or title reached published content
 *     (`E001`) — the acceptance condition of Issue #494;
 *   - an approval without the owner's authority (`E002`) or without a
 *     basis (`E003`) — a fabricated approval is worse than none;
 *   - an unrecognised decision value (`E004`);
 *   - a personal-data candidate in published content that no approved
 *     record covers (`E005`) — the reverse direction, so pasting a
 *     number into a shipped file fails too;
 *   - a duplicate record id (`E006`) or a malformed corpus (`E007`);
 *   - a corpus that yields no candidate at all (`E008`) — a detector
 *     that never fires proves nothing, so a corpus that silently lost
 *     its private sample is a failure, not a clean run.
 *
 * Warnings are the `review required` signal itself: the records waiting
 * for the owner decision are named and counted (`W001`, `W002`).
 */
export function reviewCorpus({ corpus, publishedFiles = [], corpusLabel = 'corpus' }) {
	const findings = [];
	const records = Array.isArray(corpus?.records) ? corpus.records : [];

	if (!corpus || corpus.schema !== REVIEW_SCHEMA) {
		findings.push(
			finding(
				'E007',
				'error',
				`${corpusLabel} has no \`schema: "${REVIEW_SCHEMA}"\` block; the corpus is malformed, so no decision can be trusted.`,
			),
		);
	}

	const seen = new Map();
	const reviewed = [];
	let candidateTotal = 0;

	records.forEach((record, index) => {
		if (
			!record ||
			typeof record !== 'object' ||
			typeof record.id !== 'string' ||
			record.id.length === 0
		) {
			findings.push(
				finding('E007', 'error', `${corpusLabel}.records[${index}] has no string \`id\`.`),
			);
			return;
		}
		if (seen.has(record.id)) {
			findings.push(
				finding(
					'E006',
					'error',
					`Record id \`${record.id}\` appears twice; a decision can only address one record.`,
				),
			);
			return;
		}
		seen.set(record.id, record);

		const resolution = resolveDecision(record);
		const candidates = findRecordCandidates(record);
		candidateTotal += candidates.length;

		if (!isKnownDecision(resolution.declared)) {
			findings.push(
				finding(
					'E004',
					'error',
					`Record \`${record.id}\` declares decision ${resolution.declared === null ? '(none)' : `\`${resolution.declared}\``}; only ${DECISIONS.map((value) => `\`${value}\``).join(' / ')} are accepted, so the record is held back as review_required.`,
				),
			);
		}
		if (resolution.decision === 'approved' && resolution.decidedBy !== PUBLICATION_AUTHORITY) {
			findings.push(
				finding(
					'E002',
					'error',
					`Record \`${record.id}\` is marked approved but \`decided_by\` is ${resolution.decidedBy === null ? '(none)' : `\`${resolution.decidedBy}\``}; publication authority is the owner's alone.`,
				),
			);
		}
		if (resolution.decision === 'approved' && resolution.basis.length === 0) {
			findings.push(
				finding(
					'E003',
					'error',
					`Record \`${record.id}\` is marked approved with no \`basis\`; an approval that cites no permission or license is an assumption.`,
				),
			);
		}

		reviewed.push({
			id: record.id,
			source: record.source ?? null,
			title: record.title ?? '',
			decision: resolution.decision,
			decidedBy: resolution.decidedBy,
			basis: resolution.basis,
			publishable: isPublishable(record),
			candidates,
		});
	});

	reviewed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	// Which raw values must never reach a published file.
	//
	// The unit is the withheld record's own content — its title, its
	// text, and each image alt / caption / path. A token-level check
	// (「自撮り」, 「東京都」) would fire on unrelated shipped copy, so
	// the rule asks the sharper question: did this record's own text
	// reach a file a visitor can read? A partial copy that carried only
	// one candidate is caught by E005 instead, from the other side.
	const withheldRecords = reviewed.filter((entry) => !entry.publishable);
	for (const entry of withheldRecords) {
		const record = seen.get(entry.id);
		const needles = new Set();
		for (const value of [record?.title, record?.text]) {
			if (typeof value === 'string' && value.trim().length >= 8) needles.add(value.trim());
		}
		for (const image of Array.isArray(record?.images) ? record.images : []) {
			for (const field of ['alt', 'caption', 'path']) {
				const value = image?.[field];
				if (typeof value === 'string' && value.trim().length >= 8) needles.add(value.trim());
			}
		}
		for (const file of publishedFiles) {
			if (!file || typeof file.text !== 'string') continue;
			for (const needle of needles) {
				if (file.text.includes(needle)) {
					findings.push(
						finding(
							'E001',
							'error',
							`A withheld record (\`${entry.id}\`, decision ${entry.decision}) has its own content present in published file \`${file.path}\`. review_required means it does not ship.`,
						),
					);
				}
			}
		}
	}

	// The reverse direction: published content is scanned too, so
	// pasting a number into a shipped file fails as well. A candidate
	// is covered when an owner-approved record's own text carries the
	// same literal — i.e. the owner decided to publish exactly that.
	const approvedTexts = reviewed
		.filter((entry) => entry.publishable)
		.flatMap((entry) => {
			const record = seen.get(entry.id);
			const values = [];
			for (const value of [record?.title, record?.text]) {
				if (typeof value === 'string') values.push(value);
			}
			for (const image of Array.isArray(record?.images) ? record.images : []) {
				for (const field of ['alt', 'caption', 'path']) {
					if (typeof image?.[field] === 'string') values.push(image[field]);
				}
			}
			return values;
		});
	const reported = new Set();
	for (const file of publishedFiles) {
		if (!file || typeof file.text !== 'string') continue;
		for (const hit of rawTextMatches(file.text)) {
			if (approvedTexts.some((value) => value.includes(hit.value))) continue;
			const key = `${file.path}:${hit.rule.code}:${hit.value}`;
			if (reported.has(key)) continue;
			reported.add(key);
			const candidate = candidateOf(hit.rule, file.path, hit.value, hit.index);
			findings.push(
				finding(
					'E005',
					'error',
					`Published file \`${file.path}\` carries a ${candidate.code} ${candidate.title} candidate (\`${candidate.masked}\`) that no owner-approved record covers. Publishing it needs an explicit owner decision, not a code change.`,
				),
			);
		}
	}

	if (candidateTotal === 0 && records.length > 0) {
		findings.push(
			finding(
				'E008',
				'error',
				`The detector found no candidate in ${records.length} corpus record(s). A detector that never fires proves nothing: the corpus lost its private sample.`,
			),
		);
	}

	for (const entry of reviewed.filter((item) => item.decision === 'review_required')) {
		findings.push(
			finding(
				'W001',
				'warn',
				`Record \`${entry.id}\` (${entry.source ?? 'unknown source'}) is review_required: ${entry.candidates.length} candidate(s) found, no owner decision. It is withheld from the public bundle.`,
			),
		);
	}
	for (const entry of reviewed.filter((item) => item.decision === 'rejected')) {
		findings.push(
			finding(
				'W002',
				'warn',
				`Record \`${entry.id}\` (${entry.source ?? 'unknown source'}) is rejected by owner decision: ${entry.candidates.length} candidate(s) withheld from the public bundle.`,
			),
		);
	}

	const bundle = buildPublicBundle(records);
	return {
		schema: REVIEW_SCHEMA,
		corpusLabel,
		reviewed,
		publicBundle: bundle,
		counts: {
			records: reviewed.length,
			candidates: candidateTotal,
			published: bundle.published.length,
			withheld: bundle.withheld.length,
			reviewRequired: reviewed.filter((entry) => entry.decision === 'review_required').length,
			rejected: reviewed.filter((entry) => entry.decision === 'rejected').length,
			byClass: countByClass(reviewed),
		},
		findings,
		verdict: verdictOf(findings),
	};
}

/** Candidate counts per data class, for the report summary. */
export function countByClass(reviewed) {
	const counts = new Map();
	for (const entry of reviewed) {
		for (const candidate of entry.candidates) {
			const bucket = counts.get(candidate.class) ?? { class: candidate.class, count: 0 };
			bucket.count += 1;
			counts.set(candidate.class, bucket);
		}
	}
	return [...counts.values()].sort((a, b) => (a.class < b.class ? -1 : a.class > b.class ? 1 : 0));
}

/** `fail` on any error, `review` on warnings only, `pass` otherwise. */
export function verdictOf(findings) {
	if (findings.some((entry) => entry.severity === 'error')) return 'fail';
	if (findings.some((entry) => entry.severity === 'warn')) return 'review';
	return 'pass';
}

const bullet = (values, empty = '(なし)') =>
	values.length === 0 ? `- ${empty}` : values.map((value) => `- ${value}`).join('\n');

const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
	);

/**
 * The published-information / external-communication / dependency /
 * audit-target disclosure this gate is required to state (acceptance
 * condition 2 of Issue #494). It is a pure function of the injected
 * declaration so the report can never quietly drop a row.
 */
export const PUBLICATION_DISCLOSURE = {
	publishes: [
		'移行 corpus のうち owner が `approved` / `decided_by: owner` / `basis` 付きで承認したレコードだけ (レコード単位。字段単位の redact は提供しない)',
		'公開承認レコードの title / text / images (alt・caption・file path)',
		'検出候補はルール id・フィールド・オフセット・masked 形状のみ。生の値はレポートにも CI log にも出さない',
	],
	externalCommunication: [
		'外部通信なし。gate は socket を開かず、binding を読まず、secret を読まない (AGENTS.md section 4)',
		'外部 validator / OCR / LLM API を呼ばない。判定はこの repository 内のルール + owner decision のみ',
		'スクリーンショット生成はローカル HTML -> chromium -> sharp で完結する (dev サーバーも Worker も起動しない)',
	],
	dependencies: [
		'gate: `node:fs` / `node:path` / `node:url` のみ (npm dependency を追加しない)',
		'library `scripts/personal-data-review.mjs` は外部依存ゼロ。Worker / SSR からは import されない',
		'screenshot: 既存の devDependency `@playwright/test` (chromium) と `sharp` のみ',
	],
	auditTargets: [
		'corpus: `docs/migration/personal-data-review/corpus.json`',
		'公開 content root: `copy/**`, `public/**`, `src/about/**`, `src/portfolio/**`',
		'レポート: `docs/verification/privacy/publication-redaction-review.md`',
		'検証画像: `docs/verification/privacy/publication-redaction-review.webp`',
		'規則表: `scripts/personal-data-review.mjs#RULES` (コード D001-D011 は安定識別子)',
	],
	remainingRisks: [
		'画像そのものは検査しない (OCR なし)。顔・書類・手書きの住所は画像内に残る可能性があり、owner の目視判断が必要',
		'`D006` / `D007` は敬称無しの氏名を検出しない。刷新を意図しない公開記録は owner 判断に委ねられる',
		'corpus に無い移行元 (Miro の別 board、前述でない Notion ページ) はこの gate の対象外。取り込みが別途必要',
		'`docs/migration/` は personal data 自体を置かないという invariant を保つため、実数据的ではなく synthetic fixture のみを収録する',
	],
};

/**
 * Human-readable report (the tracked `.md` artifact).
 *
 * A pure function of the review plus the digests the caller injects, so
 * `--check` byte-compares it: an unreviewed corpus change leaves the
 * report stale and the gate red.
 */
export function renderMarkdownReport({ review, corpusDigest = '', publishedDigest = '' }) {
	const lines = [
		'# Publication redaction review — 公開データの個人情報検出と掲載承認',
		'',
		'> Generated by `pnpm run publication:redaction:write`',
		'> (`scripts/check-publication-redaction.mjs`). Do not hand-edit:',
		'> `pnpm run publication:redaction:check` fails when this file no longer',
		'> matches the corpus + published content it describes.',
		'',
		'| Item | Value |',
		'| --- | --- |',
		`| Corpus | \`${review.corpusLabel}\` (schema \`${review.schema}\`) |`,
		`| Corpus digest (sha-256, 12) | \`${corpusDigest}\` |`,
		`| Published content digest (sha-256, 12) | \`${publishedDigest}\` |`,
		`| Records | ${review.counts.records} |`,
		`| Candidates found | ${review.counts.candidates} |`,
		`| Published (owner-approved) | ${review.counts.published} |`,
		`| Withheld | ${review.counts.withheld} (review_required ${review.counts.reviewRequired} / rejected ${review.counts.rejected}) |`,
		`| Verdict | **${review.verdict}** |`,
		'',
		'## 1. 公開する情報 (what this gate publishes)',
		'',
		...PUBLICATION_DISCLOSURE.publishes.map((line) => `- ${line}`),
		'',
		'### Public bundle — approved records only',
		'',
		'| Record | Source | Title | Fields | Candidates | Basis |',
		'| --- | --- | --- | --- | --- | --- |',
		...(review.publicBundle.published.length === 0
			? ['| _(no owner-approved record)_ | — | — | — | — | — |']
			: review.publicBundle.published.map(
					(entry) =>
						`| \`${entry.id}\` | ${entry.source ?? '—'} | ${entry.title} | ${entry.fields.map((field) => `\`${field}\``).join(', ')} | ${entry.candidateCount} | ${entry.basis} |`,
				)),
		'',
		'### Withheld records — reason and candidate count',
		'',
		'| Record | Source | Decision | Candidates |',
		'| --- | --- | --- | --- |',
		...(review.publicBundle.withheld.length === 0
			? ['| _(nothing withheld)_ | — | — | — |']
			: review.publicBundle.withheld.map(
					(entry) =>
						`| \`${entry.id}\` | ${entry.source ?? '—'} | ${entry.decision} | ${entry.candidateCount} |`,
				)),
		'',
		'## 2. 外部通信 (external communication)',
		'',
		...PUBLICATION_DISCLOSURE.externalCommunication.map((line) => `- ${line}`),
		'',
		'## 3. 依存 (dependencies)',
		'',
		...PUBLICATION_DISCLOSURE.dependencies.map((line) => `- ${line}`),
		'',
		'## 4. 監査対象 (audit targets)',
		'',
		...PUBLICATION_DISCLOSURE.auditTargets.map((line) => `- ${line}`),
		'',
		'## 5. 検出規則 (rules) — コードは安定識別子',
		'',
		'| Code | Class | 検出対象 | 意図的に一致させないもの |',
		'| --- | --- | --- | --- |',
		...RULES.map(
			(rule) => `| \`${rule.code}\` | ${rule.class} | ${rule.title} | ${rule.precision} |`,
		),
		'',
		'## 6. レコード別レビュー結果',
		'',
		'| Record | Source | Decision | decided_by | Candidates | Basis |',
		'| --- | --- | --- | --- | --- | --- |',
		...(review.reviewed.length === 0
			? ['| _(empty corpus)_ | — | — | — | — | — |']
			: review.reviewed.map(
					(entry) =>
						`| \`${entry.id}\` | ${entry.source ?? '—'} | ${entry.decision} | ${entry.decidedBy ?? '—'} | ${entry.candidates.length} | ${entry.basis || '—'} |`,
				)),
		'',
		'### Candidates (masked — 生値は出さない)',
		'',
		...(review.reviewed.every((entry) => entry.candidates.length === 0)
			? ['_(no candidate)_']
			: review.reviewed.flatMap((entry) =>
					entry.candidates.map(
						(candidate) =>
							`- \`${candidate.code}\` \`${entry.id}\` ${candidate.at} → \`${candidate.masked}\``,
					),
				)),
		'',
		'## 7. Findings',
		'',
		...(review.findings.length === 0
			? ['_(no finding)_']
			: review.findings.map(
					(entry) => `- **${entry.severity.toUpperCase()}** \`${entry.code}\` ${entry.message}`,
				)),
		'',
		'## 8. 残るリスク (remaining risks)',
		'',
		...PUBLICATION_DISCLOSURE.remainingRisks.map((line) => `- ${line}`),
		'',
		'## 9. Owner workflow',
		'',
		bullet([
			'`docs/migration/personal-data-review/corpus.json` の `publication.decision` を `approved` / `rejected` / 削除 のいずれかにする。`decided_by` は `owner`、`basis` には実際に依拠した許可・ライセンス・出典を書く',
			'`pnpm run publication:redaction:write` でレポートを更新する',
			'`pnpm run verify:publication-redaction-screenshot` で検証画像を更新する',
			'根拠が無いまま `approved` にすると `E002` / `E003` で fail する。推測で公開することはできない',
		]),
		'',
	];
	return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * Standalone HTML rendering of the same report — the
 * verification-screen surface for
 * `docs/verification/privacy/publication-redaction-review.webp`.
 * No stylesheet, no font, no network: the artefact has to render
 * identically offline.
 */
export function renderHtmlReport({ review, corpusDigest = '', publishedDigest = '' }) {
	const code = (value) => `<code>${escapeHtml(value)}</code>`;
	const dash = (value) => escapeHtml(value ?? '—');
	const row = (cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
	const metric = (label, value) => row([escapeHtml(label), value]);
	const list = (lines) =>
		`<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
	const table = (header, rows, empty) =>
		rows.length === 0
			? `<table><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr><tr><td colspan="${header.length}" class="muted">${escapeHtml(empty)}</td></tr></table>`
			: `<table><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr>\n  ${rows.join('\n  ')}</table>`;

	const publishedRows = review.publicBundle.published.map((entry) =>
		row([
			code(entry.id),
			dash(entry.source),
			escapeHtml(entry.title),
			entry.fields.map((field) => code(field)).join(', '),
			String(entry.candidateCount),
			escapeHtml(entry.basis),
		]),
	);
	const withheldRows = review.publicBundle.withheld.map((entry) =>
		row([
			code(entry.id),
			dash(entry.source),
			escapeHtml(entry.decision),
			String(entry.candidateCount),
		]),
	);
	const ruleRows = RULES.map((rule) =>
		row([
			code(rule.code),
			escapeHtml(rule.class),
			escapeHtml(rule.title),
			escapeHtml(rule.precision),
		]),
	);
	const reviewedRows = review.reviewed.map((entry) =>
		row([
			code(entry.id),
			dash(entry.source),
			escapeHtml(entry.decision),
			dash(entry.decidedBy),
			String(entry.candidates.length),
			escapeHtml(entry.basis || '—'),
		]),
	);
	const candidateLines = review.reviewed.flatMap((entry) =>
		entry.candidates.map(
			(candidate) => `${candidate.code} ${entry.id} ${candidate.at} → ${candidate.masked}`,
		),
	);
	const findings = review.findings
		.map(
			(entry) =>
				`<div class="finding ${entry.severity}"><span class="tag">${escapeHtml(entry.severity.toUpperCase())}</span>${code(entry.code)} ${escapeHtml(entry.message)}</div>`,
		)
		.join('\n');

	const summary = [
		metric(
			'verdict',
			`<span class="verdict ${review.verdict}">${review.verdict.toUpperCase()}</span>`,
		),
		metric('corpus', code(review.corpusLabel)),
		metric('corpus digest (sha-256, 12)', code(corpusDigest)),
		metric('published content digest (sha-256, 12)', code(publishedDigest)),
		metric('records', String(review.counts.records)),
		metric('candidates found', String(review.counts.candidates)),
		metric('published (owner-approved)', String(review.counts.published)),
		metric(
			'withheld',
			`${review.counts.withheld} (review_required ${review.counts.reviewRequired} / rejected ${review.counts.rejected})`,
		),
	].join('\n  ');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Publication redaction review</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.6 -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; margin: 0; padding: 40px; color: #1a1a1a; background: #fbfbf9; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 30px 0 8px; border-bottom: 1px solid #e2e0da; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 18px 0 6px; color: #40403c; }
  .sub { color: #6b6b6b; margin: 0 0 22px; }
  .verdict { display: inline-block; padding: 3px 12px; border-radius: 999px; font-weight: 700; letter-spacing: 0.04em; }
  .verdict.pass { background: #e6f2e6; color: #1c5c2c; }
  .verdict.review { background: #fbf1da; color: #7a5410; }
  .verdict.fail { background: #fbe4e4; color: #8c1f1f; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #e2e0da; padding: 6px 10px; text-align: left; vertical-align: top; font-size: 13px; }
  th { background: #f2f1ec; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  ul { margin: 4px 0; padding-left: 22px; }
  .muted { color: #8a8a8a; }
  .finding { border-left: 3px solid #cfcac0; padding: 2px 0 2px 12px; margin: 6px 0; }
  .finding.error { border-left-color: #c0392b; }
  .finding.warn { border-left-color: #c08a1e; }
  .tag { font-size: 11px; letter-spacing: 0.08em; font-weight: 700; margin-right: 8px; }
</style>
</head>
<body>
<h1>Publication redaction review</h1>
<p class="sub">公開データの個人情報検出と掲載承認チェック — Issue #494 / scripts/check-publication-redaction.mjs</p>

<h2>Summary</h2>
<table>
  ${summary}
</table>

<h2>1. 公開する情報 (public bundle)</h2>
${list(PUBLICATION_DISCLOSURE.publishes)}
${table(['Record', 'Source', 'Title', 'Fields', 'Candidates', 'Basis'], publishedRows, 'no owner-approved record')}
<h3>Withheld records</h3>
${table(['Record', 'Source', 'Decision', 'Candidates'], withheldRows, 'nothing withheld')}

<h2>2. 外部通信 / 3. 依存 / 4. 監査対象</h2>
${list(PUBLICATION_DISCLOSURE.externalCommunication)}
${list(PUBLICATION_DISCLOSURE.dependencies)}
${list(PUBLICATION_DISCLOSURE.auditTargets)}

<h2>5. 検出規則 (D001-D011)</h2>
${table(['Code', 'Class', '検出対象', '意図的に一致させないもの'], ruleRows, 'no rule')}

<h2>6. レコード別レビュー結果</h2>
${table(['Record', 'Source', 'Decision', 'decided_by', 'Candidates', 'Basis'], reviewedRows, 'empty corpus')}

<h2>Candidates (masked)</h2>
${candidateLines.length === 0 ? '<p class="muted">no candidate</p>' : list(candidateLines)}

<h2>7. Findings (${review.findings.length})</h2>
${review.findings.length === 0 ? '<p class="muted">no finding</p>' : findings}

<h2>8. 残るリスク (remaining risks)</h2>
${list(PUBLICATION_DISCLOSURE.remainingRisks)}
</body>
</html>
`;
}
