import { createFileRoute, redirect } from '@tanstack/react-router';
import { ImagesView } from '../admin/images/images';
import { getCurrentSession } from '../admin/public';
import { listReactionImages } from '../admin/images/load';

/**
 * `/admin/images` — admin reaction-image library.
 *
 * Loader: admin-only. Lists images with `referenced` flag (so the UI
 * can disable delete + show a badge). The image upload form lives in
 * the view component (composition).
 */
export const Route = createFileRoute('/admin/images')({
	loader: async () => {
		const session = await getCurrentSession();
		if (!session) {
			throw redirect({ to: '/admin/login' });
		}
		if (session.user.role !== 'admin') {
			throw redirect({ to: '/admin' });
		}
		const images = await listReactionImages({ data: {} });
		return { images };
	},
	component: ImagesRoute,
});

function ImagesRoute() {
	const { images } = Route.useLoaderData();
	return <ImagesView images={images} />;
}
