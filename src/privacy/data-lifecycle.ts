/**
 * Data lifecycle registry (Issue #496) — what this platform stores, for
 * how long, how it is deleted, and where it leaves the deployment.
 *
 * Why this obligation exists
 * --------------------------
 * The shipped public wording used to claim two things the code does not
 * support: that the visitor cookie is 「匿名」 ("anonymous", in
 * `src/home/footer.tsx` and the home reactions section description) and
 * that nothing identifies a visitor. It also stayed silent on the two
 * facts a reader can actually check in this repository — that the
 * cookie value is written into a D1 row, and that page views are sent
 * to a third-party analytics property.
 *
 * The fix is not "write a longer paragraph". It is to give the public
 * wording ONE source of truth and let a test prove the wording never
 * says more than the source does. That source is this file.
 *
 * Ownership (ADR-0008, obligation-oriented)
 * ----------------------------------------
 *   - Obligation: the registry of stored data, its retention, its
 *     deletion path, and its transmission target — plus the JA/EN
 *     sentences the public surface renders from it.
 *   - Change reason: a data store changes shape (a column, a TTL, a
 *     destination). The registry and the public wording change together
 *     or the contract test fails.
 *   - Authority: the facts are read off `src/**`, `migrations/*.sql`
 *     and `wrangler.jsonc`. Every entry carries `evidence` pointers so
 *     a reviewer can re-derive the claim. The owner decides what is
 *     *published* (`publication.status`), exactly as `docs/personal/
 *     knowledge-model.md` separates truth authority from publication
 *     authority.
 *   - Dependency direction: this is a **LEAF**. It imports nothing from
 *     any other obligation — not even for the constants it quotes.
 *     `scripts/check-architecture.mjs` enforces the leaf rule (test
 *     files under a leaf are exempt, which is how `data-lifecycle.test.ts`
 *     can cross-check the registry against the real code). The same
 *     shape `src/i18n/**` and `src/logging/**` use.
 *   - Lifecycle: born with the first stored store; it dies when the
 *     platform stops storing visitor data (in which case the public
 *     wording is deleted with it).
 *
 * Why the constants are restated instead of imported
 * --------------------------------------------------
 * The registry must stay a leaf, so it cannot `import { DEDUP_WINDOW_MS }`
 * from the HTTP boundary. It restates the value in prose and the test
 * asserts the prose against the real constant — a duplicated literal
 * with a machine check is a different failure mode from a silent
 * divergence: `DEDUP_WINDOW_MS` changing without this file failing
 * `pnpm run test` cannot ship.
 */

/** How long a stored item stays, as a classification the wording can key on. */
export type RetentionKind =
	/** A cookie `Max-Age` the browser enforces. */
	| 'cookie-max-age'
	/** A server-side window that expires the row on a later write. */
	| 'windowed'
	/** No expiry column and no purge job: the row stays until someone deletes it. */
	| 'until-deleted'
	/** The data is a counter, not a record of a person. */
	| 'aggregate'
	/** Retention is decided by a third party, not by this platform. */
	| 'third-party'
	/** Nothing is stored, so there is nothing to expire. */
	| 'not-applicable';

/** Who can delete the item — the one honest answer per entry. */
export type DeletionChannel =
	/** The visitor can delete their own item from the page. */
	| 'visitor-action'
	/** Only the operator, by hand, in the storage layer. */
	| 'operator-action'
	/** Only the third party that received it. */
	| 'third-party'
	/** No deletion affordance is published (and none may be claimed). */
	| 'none-published'
	/** Nothing is stored; deletion does not apply. */
	| 'not-applicable';

/** Where the data leaves the deployment, if anywhere. */
export type TransferTarget =
	/** Stays in this deployment (D1 / R2 / the visitor's own browser). */
	| 'none'
	/** Google Analytics 4 property (measurement id comes from a runtime secret). */
	| 'google-analytics-4';

/** A JA/EN pair. The document language is `ja`, so JA text carries no `lang` tag. */
export interface BilingualText {
	readonly ja: string;
	readonly en: string;
}

export interface DataLifecycleEntry {
	/** Stable id. Used as the React key and in the verification report. */
	readonly id: string;
	/** What the entry is, as a reader would name it. */
	readonly label: BilingualText;
	/** The items actually written, named as the schema names them. */
	readonly stores: BilingualText;
	readonly retention: {
		readonly kind: RetentionKind;
		readonly statement: BilingualText;
	};
	readonly deletion: {
		readonly channel: DeletionChannel;
		readonly statement: BilingualText;
	};
	readonly transfer: {
		readonly target: TransferTarget;
		readonly statement: BilingualText;
	};
	/**
	 * What a visitor can see about the item. Never a value that
	 * identifies a visitor.
	 */
	readonly visibility: BilingualText;
	/**
	 * Repository pointers that let a reviewer re-derive every claim
	 * above. An approved entry with no evidence is an integrity error.
	 */
	readonly evidence: readonly string[];
	readonly publication: {
		/**
		 * `approved` → the wording is published. `pending` → the entry
		 * is documented here (so it is not lost) but renders nowhere.
		 * The filter is fail-closed: an unknown status is not published.
		 */
		readonly status: 'approved' | 'pending';
		readonly note: BilingualText;
	};
}

/**
 * The deletion window, as one answer.
 *
 * Issue #496 asks the public wording to name the deletion channel. The
 * honest answer today is that no request channel is published, and the
 * reason is a fact this repository can prove: `/contact` has no form
 * and `src/contact/channels.json` lists no address, and
 * `src/http/security-txt/policy.json` is still `pending` an owner
 * decision on a contact. Publishing "削除を受け付けます" here would be
 * claiming a feature that does not exist.
 */
export const DELETION_REQUEST_CHANNEL = {
	status: 'not-published',
	statement: {
		ja: 'このプラットフォームはデータ削除の依頼を受け付ける窓口を公開していません。訪問者が自分でできる削除は、各項目の「削除」に記した操作だけです。',
		en: 'This platform publishes no channel for deletion requests. The only deletions a visitor can perform are the ones listed per item above.',
	},
} as const;

export const DATA_LIFECYCLE_ENTRIES = [
	{
		id: 'actor-cookie',
		label: {
			ja: '訪問者識別 Cookie `mw_actor_id`',
			en: 'Visitor identifier cookie `mw_actor_id`',
		},
		stores: {
			ja: 'ランダムに生成した 32 文字の識別子 1 つ。氏名・連絡先・端末・回線・位置の情報は含まれません。Cookie 属性は `Max-Age=31536000`（1 年）/ `Path=/` / `HttpOnly` / `SameSite=Lax`、HTTPS 通信時のみ `Secure` です。',
			en: 'One randomly generated 32-character identifier. It carries no name, contact, device, network or location data. Cookie attributes: `Max-Age=31536000` (1 year) / `Path=/` / `HttpOnly` / `SameSite=Lax`, plus `Secure` on HTTPS requests.',
		},
		retention: {
			kind: 'cookie-max-age',
			statement: {
				ja: 'ブラウザ側は 1 年。リアクションを追加した訪問者の場合、同じ値がサーバーのデータベース（`reactions.actor_id`）にも保存され、そのリアクションの行が削除されるまで残ります。',
				en: 'One year in the browser. For a visitor who adds a reaction the same value is also stored server-side (`reactions.actor_id`) and stays until that reaction row is deleted.',
			},
		},
		deletion: {
			channel: 'visitor-action',
			statement: {
				ja: '訪問者がリアクションの表示を切り替えると、その訪問者の行は `DELETE /api/v1/reactions` で削除されます。ブラウザの Cookie を削除しても、データベースの行は自動的に削除されません（このプラットフォームに一括削除機能はありません）。',
				en: 'Toggling a reaction issues `DELETE /api/v1/reactions` and removes that visitor’s row. Deleting the browser cookie does not delete the stored row — this platform has no bulk erasure feature.',
			},
		},
		transfer: {
			target: 'none',
			statement: {
				ja: 'ホームの読み込みは自オリジンへの内部呼び出しだけで、第三者へは送信しません。',
				en: 'The home loader only self-calls its own origin; nothing is sent to a third party.',
			},
		},
		visibility: {
			ja: '公開ページ・公開 API・閲覧解析のいずれにも、この識別子の値そのものは現れません。',
			en: 'The identifier value appears in no public page, no public API response and no analytics payload.',
		},
		evidence: [
			'src/home/reactions/cookie.ts (生成規則・属性・Max-Age)',
			'src/home/reactions/load.ts (発行タイミング・actor_id としての転送)',
			'migrations/0003_reactions.sql (reactions.actor_id 列)',
		],
		publication: {
			status: 'approved',
			note: {
				ja: 'Cookie の実際の属性と保存先はコードから確認できるため公開する。旧文言の「匿名」「個人を特定しません」は削除した。',
				en: 'Published: the cookie’s real mechanics and storage are verifiable in code. The previous 「匿名」 / “does not identify individuals” wording was removed.',
			},
		},
	},
	{
		id: 'reaction-rows',
		label: {
			ja: 'リアクション記録（データベース `reactions`）',
			en: 'Reaction records (database table `reactions`)',
		},
		stores: {
			ja: '対象キー / 訪問者識別子（上記の Cookie の値）/ API キー ID / 種類 / 値 / 記録時刻。',
			en: 'Target key / visitor identifier (the cookie value above) / API key id / kind / value / created_at.',
		},
		retention: {
			kind: 'until-deleted',
			statement: {
				ja: '自動失効はありません。有効期限列も定期削除ジョブも実装していません。訪問者本人の削除、または運用者による手動削除まで残ります。',
				en: 'No automatic expiry: this platform ships neither an expiry column nor a purge job. A row stays until the visitor deletes it or an operator removes it by hand.',
			},
		},
		deletion: {
			channel: 'visitor-action',
			statement: {
				ja: '訪問者自身のリアクションは表示の切り替えで削除できます。それ以外の行（訪問者が Cookie を消えた後など）は削除操作の入口がありません。',
				en: 'A visitor can delete their own reaction by toggling it. No affordance exists for other rows (for example one left behind after the cookie was cleared).',
			},
		},
		transfer: {
			target: 'none',
			statement: {
				ja: '送信は自オリジンへの内部呼び出しだけです。',
				en: 'Transmission is the self-call to its own origin only.',
			},
		},
		visibility: {
			ja: '公開されるのは種類ごとの件数（集計）だけで、行の内容や訪問者識別子は公開されません。',
			en: 'Only the per-kind counts are published. Row contents and visitor identifiers are not.',
		},
		evidence: [
			'migrations/0003_reactions.sql (列・UNIQUE 制約)',
			'src/http/reactions/reactions.ts (put / delete / aggregate)',
			'src/home/reactions/load.ts (訪問者識別子の付与)',
		],
		publication: {
			status: 'approved',
			note: {
				ja: '列名と削除経路がコードで確定しているため公開する。',
				en: 'Published: the columns and the deletion path are settled in code.',
			},
		},
	},
	{
		id: 'access-counter',
		label: {
			ja: 'アクセスカウンター（`access_counters` / `access_dedup`）',
			en: 'Access counter (`access_counters` / `access_dedup`)',
		},
		stores: {
			ja: '`access_counters`: キー / API キー ID / 件数 / 初訪問・最終訪問時刻（訪問者を識別しない集計値だけ）。`access_dedup`: キー / API キー ID / リクエストごとに発行する一時 UUID / 失効時刻。',
			en: '`access_counters`: key / API key id / count / first and last hit (aggregate values only — no visitor identifier). `access_dedup`: key / API key id / a per-request UUID / expiry.',
		},
		retention: {
			kind: 'windowed',
			statement: {
				ja: '重複排除行は記録から 60 分で失効します。ただし失効行の削除は同じリクエスト識別子の再訪時にしか実行されず、このプラットフォームには定期削除ジョブ（`wrangler.jsonc` に Cron 宣言なし）がありません。したがって再訪のない行はデータベースに残ります。集計行は手動削除されるまで残ります。',
				en: 'A dedup row expires 60 minutes after it is written. Expired rows are only deleted when the same request identifier returns, and this platform ships no scheduled purge job (no Cron trigger is declared in `wrangler.jsonc`). A row whose visitor never returns therefore stays in the database. Aggregate rows stay until deleted by hand.',
			},
		},
		deletion: {
			channel: 'operator-action',
			statement: {
				ja: '公開されている削除依頼窓口はありません。運用者がデータベースを手動で操作することだけが経路です。',
				en: 'No deletion-request channel is published. Manually operating the database is the only path.',
			},
		},
		transfer: {
			target: 'none',
			statement: {
				ja: 'ホームの記録・取得は自オリジンへの内部呼び出しだけです。',
				en: 'Recording and reading happen through self-calls to the same origin.',
			},
		},
		visibility: {
			ja: '公開されるのは件数と初・最終訪問時刻だけです。一時 UUID も失効時刻も公開されません。',
			en: 'Only the count and the first / last hit timestamps are published. Neither the UUID nor the expiry is.',
		},
		evidence: [
			'migrations/0002_access_counter.sql / 0005_access_counter_principal.sql (列・主キー)',
			'src/http/access-counter/counter.ts (失効削除・失効時刻の設定)',
			'src/home/access/load.ts (リクエストごとの UUID・自オリジン呼び出し)',
			'wrangler.jsonc (Cron 宣言なし)',
		],
		publication: {
			status: 'approved',
			note: {
				ja: '「60 分で消える」とは書かない。削除が再訪時にしか走らないことまで含めて公開する。',
				en: 'Published, including the fact that deletion depends on a later hit rather than running on schedule.',
			},
		},
	},
	{
		id: 'analytics-events',
		label: {
			ja: '閲覧解析（Google Analytics 4）',
			en: 'Web analytics (Google Analytics 4)',
		},
		stores: {
			ja: '送信するのは測定 ID と、ページ遷移ごとのパス情報（`page_path` / `page_location` / `page_title`）。クエリ文字列は送信前に除去され、`/admin/**` は送信対象外です。`mw_actor_id` も他の識別子も送信しません。',
			en: 'What leaves the deployment: the measurement id and, per route change, the path (`page_path` / `page_location` / `page_title`). Query strings are stripped before sending, `/admin/**` is excluded, and neither `mw_actor_id` nor any other identifier is sent.',
		},
		retention: {
			kind: 'third-party',
			statement: {
				ja: '保持期間と削除は Google 側のプロパティ設定に従います。このプラットフォームからは設定も確認もできません。',
				en: 'Retention and deletion follow the Google property settings. This platform can neither configure nor verify them.',
			},
		},
		deletion: {
			channel: 'third-party',
			statement: {
				ja: 'このプラットフォームからは削除できません。Google 側の操作が必要です。依頼窓口は公開していません。',
				en: 'Deletion cannot be performed from this platform; it requires action inside Google. No request channel is published.',
			},
		},
		transfer: {
			target: 'google-analytics-4',
			statement: {
				ja: '公開ページを読み込んだときのみ、ブラウザから Google の解析プロパティへ送信されます。',
				en: 'Sent from the visitor’s browser to the Google analytics property only when a public page is loaded.',
			},
		},
		visibility: {
			ja: '測定 ID 自体は HTML に出ますが、保存された閲覧データはこのプラットフォームのどこにも残りません。',
			en: 'The measurement id itself is present in the HTML; the collected browsing data is not stored anywhere in this platform.',
		},
		evidence: [
			'src/editorial/analytics/GoogleAnalytics.tsx (送信する値・クエリ除去・/admin 除外)',
			'src/routes/__root.tsx (測定 ID の注入位置)',
			'wrangler.jsonc (GOOGLE_ANALYTICS_MEASUREMENT_ID は実行時 secret)',
		],
		publication: {
			status: 'approved',
			note: {
				ja: '外部送信は公開してよい事実（コードで送信値が限定されている）。保持期間は第三者設定なので数値を推測せず「確認できない」と書く。',
				en: 'Published: the transfer and its exact payload are code-visible. Retention is a third-party setting, so no number is guessed — the wording says it cannot be verified here.',
			},
		},
	},
	{
		id: 'admin-auth',
		label: {
			ja: '管理者の認証情報（`/admin/**`）— 運営者自身のデータ',
			en: 'Administrator credentials (`/admin/**`) — the operator’s own data',
		},
		stores: {
			ja: '運営者自身のメールアドレスとパスワードハッシュ、セッション（有効期間 30 日 / 24 時間ごとに更新）、招待行（メールアドレス・トークンハッシュ・有効期限・受理時刻）。',
			en: 'The operator’s own email address and password hash, sessions (30-day expiry, refreshed every 24 hours), and invitation rows (email, token hash, expiry, consumed-at).',
		},
		retention: {
			kind: 'windowed',
			statement: {
				ja: 'セッションは 30 日で失効します。招待行は有効期限を過ぎると受理できず、未消費の招待は管理画面から削除できます。',
				en: 'Sessions expire after 30 days. An invitation past its expiry can no longer be accepted, and an unconsumed invitation can be deleted from the admin surface.',
			},
		},
		deletion: {
			channel: 'operator-action',
			statement: {
				ja: '運営者自身の管理画面とデータベース操作のみです。訪問者のデータではありません。',
				en: 'Only the operator’s own admin surface and direct database operations. It is not visitor data.',
			},
		},
		transfer: {
			target: 'none',
			statement: {
				ja: '外部への送信はありません。閲覧解析も `/admin/**` には送りません。',
				en: 'Nothing is sent outward; web analytics is not loaded on `/admin/**` either.',
			},
		},
		visibility: {
			ja: '認証境界の内側なので公開面には現れません。',
			en: 'It sits behind the authentication boundary and never reaches a public surface.',
		},
		evidence: [
			'src/cloudflare/auth/better-auth.ts (emailAndPassword / session.expiresIn / updateAge)',
			'src/admin/invitations/load.ts (招待行の列・削除操作)',
			'migrations/0008_admin_step_up.sql',
		],
		publication: {
			status: 'approved',
			note: {
				ja: '「フォーム」を確認した結論がこれ。入力して保存されるフォームは運営者自身の認証表单だけ。',
				en: 'This is the answer to the “forms” question: the only form that persists data is the operator’s own authentication form.',
			},
		},
	},
	{
		id: 'contact-surface',
		label: {
			ja: '問い合わせ（`/contact`）',
			en: 'Contact (`/contact`)',
		},
		stores: {
			ja: '保存されるものはありません。このページに入力フォームはなく、掲載しているのは公開済みの連絡先リンクだけです。メッセージは送信されません。',
			en: 'Nothing is stored. The page has no input form; it lists already-published contact links. No message is sent.',
		},
		retention: {
			kind: 'not-applicable',
			statement: {
				ja: '保存データがないため保持期間もありません。',
				en: 'No stored data means no retention period.',
			},
		},
		deletion: {
			channel: 'not-applicable',
			statement: {
				ja: '削除対象がないので操作は不要です。',
				en: 'Nothing to delete.',
			},
		},
		transfer: {
			target: 'none',
			statement: {
				ja: 'リンク先への移動だけです。フォームからの送信はありません。',
				en: 'Only a link navigation. There is no form submission.',
			},
		},
		visibility: {
			ja: '掲載先は `src/contact/channels.json` で、所有者は公開済みのリンクのみです。',
			en: 'The listed targets come from `src/contact/channels.json`, which contains only already-published links.',
		},
		evidence: [
			'src/contact/page.tsx (フォーム要素なし)',
			'src/contact/channels.json (掲載先はリンクのみ)',
			'src/http/security-txt/policy.json (連絡先が未承認のため 404)',
		],
		publication: {
			status: 'approved',
			note: {
				ja: 'フォームがある世界を前提にした削除窓口の説明を避けるため、「フォームが無い」ことを明示する。',
				en: 'Published so the wording does not imply a contact form exists and so no deletion channel is implied.',
			},
		},
	},
] as const satisfies readonly DataLifecycleEntry[];

/**
 * Claims the public wording must never make, and why.
 *
 * This is the executable half of the Issue's first completion criterion
 * (「存在しない削除機能や匿名性を宣言しない」). A phrase list alone would
 * be a spelling contest; each entry names the repository fact that
 * falsifies the claim, so adding one requires an argument, and the
 * integration suite asserts none of them appears in a served document.
 */
export const UNSUPPORTED_PUBLIC_CLAIMS = [
	{
		id: 'anonymity',
		patterns: [
			'匿名',
			'完全匿名',
			'個人を特定しません',
			'個人を特定できない',
			'anonymously',
			'does not identify',
		],
		why: 'The cookie is a 1-year identifier whose value is also written to `reactions.actor_id` in D1. A pseudonymous identifier is not an anonymous one, and the repository can prove the storage.',
	},
	{
		id: 'deletion-window',
		patterns: [
			'削除を受け付けます',
			'削除依頼を受け付けます',
			'削除受付',
			'privacy request',
			'deletion request channel',
			'we accept deletion requests',
			'GDPR',
		],
		why: 'No deletion-request channel is published: `/contact` has no form, `src/contact/channels.json` lists no address and `security.txt` is still pending an owner decision.',
	},
	{
		id: 'no-third-party',
		patterns: [
			'外部に送信しません',
			'第三者にも送信しません',
			'送信はされません',
			'never sent to any third party',
		],
		why: 'Public page loads send a page_view to a Google Analytics 4 property. The claim is only true when scoped to the cookie and the counter, which is how the per-entry wording states it.',
	},
	{
		id: 'auto-expiry',
		patterns: [
			'自動的に削除されます',
			'自動的に消えます',
			'24 時間後に削除されます',
			'automatically deleted',
		],
		why: 'No purge job ships. The dedup window is enforced lazily on the next hit from the same request id, and reaction rows have no expiry column at all.',
	},
] as const;

/** Claims found in `text`. Empty array = the text may be published. */
export function findUnsupportedClaims(text: string): { id: string; pattern: string }[] {
	const found: { id: string; pattern: string }[] = [];
	for (const claim of UNSUPPORTED_PUBLIC_CLAIMS) {
		for (const pattern of claim.patterns) {
			if (text.includes(pattern)) found.push({ id: claim.id, pattern });
		}
	}
	return found;
}

/**
 * Cross-field invariants, enforced at module evaluation so a malformed
 * registry fails the Worker boot instead of shipping a notice that
 * quietly omits a store.
 */
function assertDataLifecycleIntegrity(entries: readonly DataLifecycleEntry[]): void {
	const ids = new Set<string>();
	for (const entry of entries) {
		if (ids.has(entry.id)) throw new Error(`[privacy] duplicate data lifecycle id: ${entry.id}`);
		ids.add(entry.id);
		for (const [field, text] of Object.entries({
			label: entry.label,
			stores: entry.stores,
			retention: entry.retention.statement,
			deletion: entry.deletion.statement,
			transfer: entry.transfer.statement,
			visibility: entry.visibility,
			'publication note': entry.publication.note,
		})) {
			if (text.ja.trim().length === 0 || text.en.trim().length === 0) {
				throw new Error(`[privacy] ${entry.id}.${field} must carry both ja and en text`);
			}
		}
		if (entry.publication.status === 'approved' && entry.evidence.length === 0) {
			throw new Error(`[privacy] ${entry.id} is approved without repository evidence`);
		}
		for (const pointer of entry.evidence) {
			// Every pointer starts with the repository path it proves,
			// optionally followed by a parenthesised gloss. A pointer
			// that names no file is not evidence.
			const path = (pointer.split('（')[0] ?? pointer).split(' ')[0] ?? '';
			const file = path.replace(/[:(]$/, '');
			const namesAFile = file.includes('/') || /\.[a-z]+$/i.test(file);
			if (!namesAFile) {
				throw new Error(`[privacy] ${entry.id} evidence must name a repository path: ${pointer}`);
			}
		}
	}
}

assertDataLifecycleIntegrity(DATA_LIFECYCLE_ENTRIES);

/**
 * The entries the public surface may render.
 *
 * Fail-closed: an entry is published only when its status is exactly
 * `approved`. A `pending` entry stays in this file (so the fact is not
 * lost) but renders nowhere and is excluded from the public wording.
 */
export function getPublishedDataLifecycle(): readonly DataLifecycleEntry[] {
	return DATA_LIFECYCLE_ENTRIES.filter((entry) => entry.publication.status === 'approved');
}

/**
 * The JA/EN sentences of every published entry, concatenated — the exact
 * surface a claim check has to pass. Both locales are included because a
 * claim is a claim in either language.
 */
export function publishedClaimSurface(): string {
	const parts: string[] = [
		DELETION_REQUEST_CHANNEL.statement.ja,
		DELETION_REQUEST_CHANNEL.statement.en,
	];
	for (const entry of getPublishedDataLifecycle()) {
		for (const text of [
			entry.label,
			entry.stores,
			entry.retention.statement,
			entry.deletion.statement,
			entry.transfer.statement,
			entry.visibility,
		]) {
			parts.push(text.ja, text.en);
		}
	}
	return parts.join('\n');
}
