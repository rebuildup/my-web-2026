import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { recordVisit } from './trail';

/**
 * Records the current public path into the visit trail (Issue #936).
 *
 * Mounted once in `src/routes/__root.tsx` for non-admin routes. It
 * renders nothing and only writes `location.pathname` — never the
 * query string — into the visitor's own `localStorage`. Every storage
 * failure is swallowed inside `recordVisit`, so this component can
 * never break a page.
 */
export function VisitTrailRecorder() {
	const { pathname } = useLocation();
	useEffect(() => {
		recordVisit(window.localStorage, pathname);
	}, [pathname]);
	return null;
}
