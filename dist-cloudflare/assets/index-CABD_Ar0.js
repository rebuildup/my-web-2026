import { W as jsxRuntimeExports } from './worker-entry-BHTWc-M0.js';
import { R as Route } from './router-1BR_hNBb.js';
import 'node:async_hooks';
import 'node:stream/web';
import 'node:stream';
function HomePage() {
	const health = Route.useLoaderData();
	return /* @__PURE__ */ jsxRuntimeExports.jsxs('main', {
		children: [
			/* @__PURE__ */ jsxRuntimeExports.jsx('h1', { children: 'my-web-2026' }),
			/* @__PURE__ */ jsxRuntimeExports.jsx('p', { children: 'Foundation release candidate.' }),
			/* @__PURE__ */ jsxRuntimeExports.jsxs('dl', {
				children: [
					/* @__PURE__ */ jsxRuntimeExports.jsx('dt', { children: 'version' }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dd', { children: health.version }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dt', { children: 'service' }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dd', { children: health.service }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dt', { children: 'status' }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dd', { children: health.status }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dt', { children: 'boot' }),
					/* @__PURE__ */ jsxRuntimeExports.jsx('dd', {
						children: /* @__PURE__ */ jsxRuntimeExports.jsx('time', { dateTime: health.timestamp, children: health.timestamp }),
					}),
				],
			}),
		],
	});
}
export { HomePage as component };
