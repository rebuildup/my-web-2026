/**
 * Safe upload-failure sentences for the admin image library
 * (Issue #458).
 *
 * `uploadReactionImage` rejects with a stable `image_policy:<code>`
 * string, and the delete path with `image_referenced`. The admin UI
 * renders THIS map, never the raw server message: a rejection must
 * not echo internals (bucket keys, SQL, stack fragments) into the
 * page, and it must not depend on message text that a future
 * refactor could reword.
 *
 * An unrecognised failure falls back to one generic sentence. The
 * raw message is still written to the browser console so an operator
 * can debug, but it never reaches the DOM.
 */

/** Fallback for anything the server did not label with a known code. */
export const GENERIC_UPLOAD_FAILURE =
	'アップロードに失敗しました。時間をおいて再度お試しください。';

const POLICY_MESSAGES: Readonly<Record<string, string>> = {
	invalid_filename: 'ファイル名が使用できません。パスや「..」を含む名前は拒否されます。',
	unsupported_content_type: '許可されない形式です。PNG / JPEG / WebP / GIF を選択してください。',
	oversize: 'ファイルが大きすぎます。256 KiB 以下にしてください。',
	empty_payload: 'ファイルが空です。別の画像を選択してください。',
	svg_not_allowed: 'SVG は受け付けません。PNG / JPEG / WebP / GIF に変換してください。',
	content_type_mismatch: '拡張子と中身が一致しません。実際の画像ファイルを選択してください。',
	unrecognized_signature: '画像ファイルとして認識できません。別の画像を選択してください。',
	image_referenced:
		'リアクションで参照中の画像は削除できません。先にリアクションを削除してください。',
};

const POLICY_PREFIX = 'image_policy:';

/**
 * Turn a server failure into a sentence that is safe to render.
 *
 * Only `image_policy:<known code>` and `image_referenced` resolve to a
 * specific message; everything else collapses to
 * `GENERIC_UPLOAD_FAILURE`.
 */
export function describeUploadFailure(err: unknown): string {
	if (err instanceof Error) return messageForCode(err.message);
	if (typeof err === 'string') return messageForCode(err);
	return GENERIC_UPLOAD_FAILURE;
}

function messageForCode(raw: string): string {
	if (raw === 'image_referenced') return POLICY_MESSAGES.image_referenced;
	if (raw.startsWith(POLICY_PREFIX)) {
		return POLICY_MESSAGES[raw.slice(POLICY_PREFIX.length)] ?? GENERIC_UPLOAD_FAILURE;
	}
	return GENERIC_UPLOAD_FAILURE;
}
