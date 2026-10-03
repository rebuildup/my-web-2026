/**
 * Public surface for the `/about` obligation.
 *
 * Routes / consumers reach the loader, the server function, and
 * the page component through this barrel. The underlying files
 * are organised under `src/about/{load,public,data,types}.ts`
 * and `src/about/components/`.
 */
export { loadAbout, type AboutLoader, type AboutEnv } from './load';
export { loadAboutPage } from './public';
export { ABOUT_DATA } from './data';
export type {
	AboutData,
	AboutPageData,
	AboutIdentity,
	AboutInterest,
	AboutExternalHandle,
} from './types';
export { AboutPage } from './components';
export type { AboutPageProps } from './components';
