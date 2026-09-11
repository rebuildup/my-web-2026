import { a5 as TSS_SERVER_FUNCTION, a7 as createServerFn } from './worker-entry-BHTWc-M0.js';
import 'node:async_hooks';
import 'node:stream/web';
import 'node:stream';
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = '/_serverFn/' + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true,
	});
};
const getInternalHealth_createServerFn_handler = createServerRpc(
	{
		id: '969e5ba762fa794aeca952d5176978705ba970bb4eeb4fb3ca55cf5eb5d990c0',
		name: 'getInternalHealth',
		filename: 'src/domains/health/application.ts',
	},
	(opts) => getInternalHealth.__executeServer(opts),
);
const getInternalHealth = createServerFn({
	method: 'GET',
}).handler(getInternalHealth_createServerFn_handler, async () => {
	return {
		status: 'ok',
		service: 'my-web-2026',
		version: '0.1.0',
		timestamp: /* @__PURE__ */ new Date().toISOString(),
	};
});
export { getInternalHealth_createServerFn_handler };
