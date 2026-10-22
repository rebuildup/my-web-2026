/**
 * Fixture public copy for the stale-content-review gate (Issue #437).
 *
 * Four Japanese expressions, one per state the gate can report:
 *
 *   1. `現在、公開されている作品はありません。`   — a record inside the window (current)
 *   2. `最新の到達性を示しています。`           — a record outside the window (stale)
 *   3. `現在利用できる contact channel はありません。` — no record at all (unrecorded)
 *   4. `今日の font stack はそのままです。`    — a record whose dimension is typography
 *
 * plus one English expression, whose locale is not opted in (not scanned).
 *
 * The text sits in a JSX expression container on purpose. The
 * editorial approval gate's extraction reads the Japanese of a string
 * literal, and the editor formats this file — a bare JSX text child
 * would be reflowed onto one line and the segment would grow the
 * surrounding markup. A quoted literal keeps the segment byte-exact.
 *
 * The English text is a quoted literal for the same reason: the shared
 * extraction only sees Japanese, so a Latin expression is collected
 * from the line's string literals. A Latin **raw** JSX text is not
 * collected — a declared limitation of the detector.
 */

export const FixturePage = () => (
	<section>
		<p>{'現在、公開されている作品はありません。'}</p>
		<p>{'最新の到達性を示しています。'}</p>
		<p>{'現在利用できる contact channel はありません。'}</p>
		<p>{'今日の font stack はそのままです。'}</p>
		<p lang="en">{'Currently, no public work is listed here.'}</p>
	</section>
);
