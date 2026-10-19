import { css } from '../../styled-system/css';
import type { DataLifecycleEntry } from '../privacy/data-lifecycle';
import {
	DELETION_REQUEST_CHANNEL,
	filterPublishedEntries,
	getPublishedDataLifecycle,
} from '../privacy/data-lifecycle';

/**
 * The public data / retention notice (Issue #496).
 *
 * Where the copy lives
 * --------------------
 * The sentences are NOT written here. They come from
 * `src/privacy/data-lifecycle.ts` — the obligation that owns "what this
 * platform stores, for how long, and who may delete it". This component
 * only decides the shape: a collapsed `<details>` disclosure in the
 * footer, one definition row per published entry.
 *
 * Why a disclosure rather than a page
 * -----------------------------------
 * Issue #496 asks the public wording to match the implementation, not
 * for a new site section. A route would need its own status row, nav
 * entry and composition review — a different PR's work. A `<details>`
 * block keeps the footer's three-column spread intact while making every
 * fact one click away on every page, including the ones that need
 * explaining rather than scrolling past.
 *
 * Fail-closed publication
 * -----------------------
 * Only entries with `publication.status === 'approved'` render
 * (`filterPublishedEntries`). A `pending` entry is documented in the
 * registry and appears nowhere, so an unapproved fact cannot leak into
 * the document by being "harmless". The filter runs inside the
 * component, so the rule holds for whatever set it is handed.
 *
 * Language of parts
 * -----------------
 * The document language is `ja` (`<html lang="ja">`,
 * `src/routes/__root.tsx`), so Japanese passages carry no `lang` and
 * every English passage is wrapped in `lang="en"` — the contract
 * `src/i18n/language-of-parts.ts` owns, applied the same way the
 * previous footer note applied it.
 */
export interface PrivacyNoticeProps {
	/**
	 * The entries to consider. Defaults to the registry's published set
	 * (`getPublishedDataLifecycle()`).
	 *
	 * Why the seam exists: "a `pending` entry renders nowhere" can
	 * only be proven against a set that actually contains one. The
	 * shipped registry publishes everything it declares, so the test
	 * passes a fixture with a `pending` entry and asserts it is
	 * absent from the markup.
	 */
	readonly entries?: readonly DataLifecycleEntry[];
}

export function PrivacyNotice({ entries = getPublishedDataLifecycle() }: PrivacyNoticeProps) {
	// The component filters, not just the registry: the fail-closed
	// rule then holds for whatever set it is handed.
	const published = filterPublishedEntries(entries);
	return (
		<details
			className={css({
				marginBlockStart: '10',
				paddingBlockStart: '6',
				borderBlockStartWidth: '1px',
				borderBlockStartColor: 'border.subtle',
				borderBlockStartStyle: 'solid',
				fontFamily: 'sans',
				fontSize: 'sm',
				lineHeight: '1.6',
				color: 'text.muted',
			})}
		>
			<summary
				className={css({
					cursor: 'pointer',
					fontWeight: '600',
					color: 'text.default',
					_focusVisible: {
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				データと保持期間 / <span lang="en">Data and retention</span>
			</summary>
			<p
				className={css({
					margin: '0',
					marginBlockStart: '4',
				})}
			>
				{DELETION_REQUEST_CHANNEL.statement.ja}
				<span lang="en"> {DELETION_REQUEST_CHANNEL.statement.en}</span>
			</p>
			<dl
				className={css({
					display: 'grid',
					gap: '4',
					margin: '0',
					marginBlockStart: '4',
				})}
			>
				{published.map((entry) => (
					<div key={entry.id} data-lifecycle-id={entry.id}>
						<dt
							className={css({
								fontWeight: '600',
								color: 'text.default',
							})}
						>
							{entry.label.ja}
							<span lang="en"> {entry.label.en}</span>
						</dt>
						<dd
							className={css({
								margin: '0',
								marginBlockStart: '1',
							})}
						>
							<p className={css({ margin: '0' })}>
								<strong>保存項目:</strong> {entry.stores.ja}
								<span lang="en"> {entry.stores.en}</span>
							</p>
							<p className={css({ margin: '0' })}>
								<strong>保持期間:</strong> {entry.retention.statement.ja}
								<span lang="en"> {entry.retention.statement.en}</span>
							</p>
							<p className={css({ margin: '0' })}>
								<strong>削除:</strong> {entry.deletion.statement.ja}
								<span lang="en"> {entry.deletion.statement.en}</span>
							</p>
							<p className={css({ margin: '0' })}>
								<strong>外部送信:</strong> {entry.transfer.statement.ja}
								<span lang="en"> {entry.transfer.statement.en}</span>
							</p>
							<p className={css({ margin: '0' })}>
								<strong>公開範囲:</strong> {entry.visibility.ja}
								<span lang="en"> {entry.visibility.en}</span>
							</p>
						</dd>
					</div>
				))}
			</dl>
		</details>
	);
}
