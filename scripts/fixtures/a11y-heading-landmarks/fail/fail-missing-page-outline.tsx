/**
 * Fixture — a page with NEITHER an `<h1>` NOR a `main` landmark
 * (Issue #398).
 *
 * This is the negative control for the gate's unit KIND: a unit that
 * is declared a page is asked for its `<h1>` and its landmark no
 * matter what it renders, so a page that lost BOTH is reported as
 * BOTH `page-missing-h1` and `page-missing-landmark`. The kind is
 * declared, never inferred from what the unit happens to render.
 */
export function FailMissingPageOutlinePage() {
	return (
		<div>
			<section>
				<h2>Section</h2>
				<h3>Detail</h3>
			</section>
		</div>
	);
}
