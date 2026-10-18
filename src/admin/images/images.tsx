import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { deleteReactionImage, uploadReactionImage } from './load';
import type { AdminImage } from './load';
import { describeUploadFailure } from './upload-errors';

/**
 * Admin reaction-image UI — list + upload + delete.
 *
 * Upload accepts PNG / JPEG / WebP / GIF (≤256 KiB). The form does
 * client-side validation for nicer UX; the server function does
 * authoritative validation — declared type, size, and the magic
 * bytes that must agree with the declaration (Issue #458). A server
 * rejection is rendered through `describeUploadFailure`, so the page
 * shows a fixed sentence per policy code and never a raw server
 * message. Same image uploaded twice returns the existing id
 * (content-addressed by SHA-256).
 *
 * Delete is disabled with a tooltip when any reaction still
 * references the image. The server rejects the call in that case
 * with `image_referenced`.
 */

/*
 * Client-side pre-checks, for instant feedback only. They are a copy
 * of `ALLOWED_IMAGE_CONTENT_TYPES` / `MAX_IMAGE_BYTES` in
 * `src/http/reactions/schema.ts` and are deliberately NOT imported:
 * this is a React component and the schema module belongs to the
 * external HTTP boundary, which the client has no reason to know
 * about. The server function is authoritative — a stale copy here can
 * only cost the admin one round-trip, and the rejection renders as a
 * fixed sentence (`oversize` / `unsupported_content_type`).
 */
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const MAX_BYTES = 256 * 1024;

export interface ImagesViewProps {
	images: readonly AdminImage[];
}

export function ImagesView({ images }: ImagesViewProps) {
	return (
		<section
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="03 — Reaction images"
					title="リアクション画像 / Reaction images"
					description="PNG / JPEG / WebP / GIF、256 KiB 以下。リアクションで参照されている画像は削除不可。"
					variant="spread"
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '10',
						})}
					>
						<UploadForm />

						<div
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '4',
							})}
						>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								Library
							</span>
							{images.length === 0 ? (
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										color: 'text.muted',
									})}
								>
									まだ画像はありません。
								</p>
							) : (
								<ul
									className={css({
										margin: '0',
										padding: '0',
										listStyle: 'none',
										display: 'flex',
										flexDirection: 'column',
										gap: '3',
									})}
								>
									{images.map((img) => (
										<ImageRow key={img.id} image={img} />
									))}
								</ul>
							)}
						</div>
					</div>
				</SectionHeading>
			</Container>
		</section>
	);
}

function UploadForm() {
	const upload = useServerFn(uploadReactionImage);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			const formData = new FormData(e.currentTarget);
			const file = formData.get('image');
			if (!(file instanceof File) || file.size === 0) {
				setError('ファイルを選択してください。');
				return;
			}
			if (file.size > MAX_BYTES) {
				setError(`256 KiB 以下にしてください (現在 ${Math.round(file.size / 1024)} KiB)`);
				return;
			}
			if (!(ALLOWED as readonly string[]).includes(file.type)) {
				setError(`許可形式: ${ALLOWED.join(', ')}`);
				return;
			}
			const bytes = await file.arrayBuffer();
			const b64 = arrayBufferToBase64(bytes);
			const result = await upload({
				data: {
					contentType: file.type as (typeof ALLOWED)[number],
					bytes: b64,
					// Advisory: the server validates the name and never
					// lets it reach the R2 key, but a traversal attempt
					// is refused instead of silently ignored.
					filename: file.name,
				},
			});
			setSuccess(`uploaded: ${result.id}`);
			e.currentTarget.reset();
		} catch (err) {
			// Raw text stays in the console; the page shows only the
			// mapped sentence for a known policy code.
			console.error('[admin/images] upload failed:', err);
			setError(describeUploadFailure(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			onSubmit={onSubmit}
			className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}
		>
			<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
				<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
					Image (PNG / JPEG / WebP / GIF, ≤256 KiB)
				</span>
				<input
					type="file"
					name="image"
					accept={ALLOWED.join(',')}
					required
					className={css({
						fontFamily: 'sans',
						fontSize: 'md',
						paddingInline: '3',
						paddingBlock: '2',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '4',
						background: 'bg.surface',
						color: 'text.default',
					})}
				/>
			</label>
			<button
				type="submit"
				disabled={busy}
				className={css({
					alignSelf: 'flex-start',
					fontFamily: 'sans',
					fontSize: 'md',
					fontWeight: '600',
					color: 'text.inverse',
					background: 'bg.accent',
					border: 'none',
					borderRadius: '4',
					paddingBlock: '3',
					paddingInline: '6',
					cursor: 'pointer',
					_disabled: { opacity: '0.5' },
				})}
			>
				{busy ? 'Uploading…' : 'Upload image'}
			</button>
			{error && (
				<p
					role="alert"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{error}
				</p>
			)}
			{success && (
				<p
					className={css({
						margin: '0',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.default',
					})}
				>
					{success}
				</p>
			)}
		</form>
	);
}

function ImageRow({ image }: { image: AdminImage }) {
	const del = useServerFn(deleteReactionImage);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const title = image.referenced
		? 'reactions still reference this image; delete them first'
		: 'delete (irreversible)';
	return (
		<li
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'auto minmax(0, 3fr) minmax(0, 4fr) auto' },
				alignItems: 'center',
				gap: { base: '2', md: '6' },
				paddingBlock: '4',
				borderBlockStart: '1px solid {colors.border.subtle}',
			})}
		>
			<img
				src={`/api/v1/reaction-images/${image.id}`}
				alt=""
				width={48}
				height={48}
				className={css({
					width: '48px',
					height: '48px',
					objectFit: 'cover',
					borderRadius: '4',
					border: '1px solid {colors.border.subtle}',
				})}
			/>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				{image.contentType} · {Math.round(image.size / 1024)} KiB
			</span>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.default',
					wordBreak: 'break-all',
				})}
			>
				{image.id}
			</span>
			<div className={css({ display: 'flex', alignItems: 'center', gap: '3' })}>
				{image.referenced ? <Badge tone="neutral">referenced</Badge> : null}
				<button
					type="button"
					disabled={busy || image.referenced}
					title={title}
					onClick={async () => {
						setBusy(true);
						setError(null);
						try {
							await del({ data: { id: image.id } });
						} catch (err) {
							console.error('[admin/images] delete failed:', err);
							setError(describeUploadFailure(err));
						} finally {
							setBusy(false);
						}
					}}
					className={css({
						fontFamily: 'sans',
						fontSize: 'xs',
						fontWeight: '600',
						color: 'text.muted',
						background: 'transparent',
						border: '1px solid {colors.border.subtle}',
						borderRadius: 'full',
						paddingInline: '3',
						paddingBlock: '1',
						cursor: 'pointer',
						_hover: { color: 'text.default' },
						_disabled: { opacity: '0.5' },
					})}
				>
					{busy ? '…' : 'delete'}
				</button>
			</div>
			{error && (
				<p
					role="alert"
					className={css({
						gridColumn: '1 / -1',
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{error}
				</p>
			)}
		</li>
	);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}
