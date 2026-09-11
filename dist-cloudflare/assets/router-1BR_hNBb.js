import {
	f as functionalUpdate,
	a as arraysEqual,
	c as compileDecodeCharMap,
	b as createSieveCache,
	t as trimPath,
	r as rewriteBasepath,
	d as composeRewrites,
	p as processRouteTree,
	e as processRouteMasks,
	g as resolvePath,
	h as findRouteMatch,
	i as trimPathRight,
	j as findFlatMatch,
	k as deepEqual,
	l as getUrlScheme,
	m as protocolRelativePrefixRegex,
	n as loadRouteChunk,
	o as preloadClientRoute,
	q as findSingleMatch,
	D as DEFAULT_PROTOCOL_ALLOWLIST,
	s as buildRouteBranch,
	u as interpolatePath,
	v as isNotFound,
	w as isRedirect,
	x as nullReplaceEqualDeep,
	y as replaceEqualDeep,
	z as last,
	A as decodePath,
	B as executeRewriteInput,
	C as normalizeProtocolRelative,
	E as parseHref,
	F as hasKeys,
	G as executeRewriteOutput,
	H as encodePathLikeUrl,
	I as isDangerousProtocol,
	J as rootRouteId,
	K as redirect,
	L as invariant,
	M as trimPathLeft,
	N as joinPaths,
	O as useRouter,
	P as reactExports,
	Q as dummyMatchContext,
	R as matchContext,
	S as useForwardedRef,
	T as exactPathTest,
	U as removeTrailingSlash,
	V as React,
	W as jsxRuntimeExports,
	X as isModuleNotFoundError,
	Y as reactUse,
	Z as useHydrated,
	_ as _getAssetMatches,
	$ as escapeHtml,
	a0 as getAssetCrossOrigin,
	a1 as getScriptPreloadAttrs,
	a2 as appendUniqueUserTags,
	a3 as resolveManifestCssLink,
	a4 as Outlet,
	a5 as TSS_SERVER_FUNCTION,
	a6 as getServerFnById,
	a7 as createServerFn,
} from './worker-entry-BHTWc-M0.js';
function encode(obj, stringify = String) {
	let result;
	for (const key in obj) {
		const val = obj[key];
		if (val !== void 0) (result ||= new URLSearchParams()).set(key, stringify(val));
	}
	return result ? result.toString() : '';
}
function toValue(str) {
	if (!str) return '';
	if (str === 'false') return false;
	if (str === 'true') return true;
	return +str * 0 === 0 && +str + '' === str ? +str : str;
}
function decode(str) {
	const searchParams = new URLSearchParams(str);
	const result = /* @__PURE__ */ Object.create(null);
	for (const [key, value] of searchParams.entries()) {
		const previousValue = result[key];
		if (previousValue == null) result[key] = toValue(value);
		else if (Array.isArray(previousValue)) previousValue.push(toValue(value));
		else result[key] = [previousValue, toValue(value)];
	}
	return result;
}
const jsonStart = /^(?:\s|["[{\d-]|fa|nu|tr)/;
const defaultParseSearch = parseSearchWith(JSON.parse);
const defaultStringifySearch = stringifySearchWith(JSON.stringify, JSON.parse);
function parseSearchWith(parser) {
	const isJsonParser = parser === JSON.parse;
	return (searchStr) => {
		if (searchStr[0] === '?') searchStr = searchStr.substring(1);
		const query = decode(searchStr);
		for (const key in query) {
			const value = query[key];
			if (typeof value === 'string') {
				if (isJsonParser && !jsonStart.test(value)) continue;
				try {
					query[key] = parser(value);
				} catch (_err) {}
			}
		}
		return query;
	};
}
function stringifySearchWith(stringify, parser) {
	const isJsonParser = parser === JSON.parse;
	function stringifyValue(val) {
		if (val && typeof val === 'object')
			try {
				return stringify(val);
			} catch (_err) {}
		else if (parser && typeof val === 'string') {
			if (isJsonParser && !jsonStart.test(val)) return val;
			try {
				parser(val);
				return stringify(val);
			} catch (_err) {}
		}
		return val;
	}
	return (search) => {
		const searchStr = encode(search, stringifyValue);
		return searchStr ? `?${searchStr}` : '';
	};
}
function createNonReactiveMutableStore(initialValue) {
	let value = initialValue;
	return {
		get() {
			return value;
		},
		set(nextOrUpdater) {
			value = functionalUpdate(nextOrUpdater, value);
		},
	};
}
function createNonReactiveReadonlyStore(read) {
	return {
		get() {
			return read();
		},
	};
}
function createRouterStores(initialLocation, config) {
	const { createMutableStore, createReadonlyStore, batch } = config;
	const byRoute = /* @__PURE__ */ new Map();
	const status = createMutableStore('idle');
	const location = createMutableStore(initialLocation);
	const resolvedLocation = createMutableStore(void 0);
	const ids = createMutableStore([]);
	const matches = createReadonlyStore(() => ids.get().map((id) => byRoute.get(id).get()));
	const __store = createReadonlyStore(() => ({
		status: status.get(),
		isLoading: status.get() === 'pending',
		matches: matches.get(),
		location: location.get(),
		resolvedLocation: resolvedLocation.get(),
	}));
	function getMatchStore(routeId) {
		let matchStore = byRoute.get(routeId);
		if (!matchStore) {
			matchStore = createMutableStore(void 0);
			byRoute.set(routeId, matchStore);
		}
		return matchStore;
	}
	const store = {
		status,
		location,
		resolvedLocation,
		ids,
		matches,
		byRoute,
		__store,
		getMatchStore,
		setMatches,
	};
	function setMatches(nextMatches) {
		const previousIds = ids.get();
		const nextIds = nextMatches.map((match) => match.routeId);
		batch(() => {
			if (!arraysEqual(previousIds, nextIds)) ids.set(nextIds);
			for (const id of previousIds) if (!nextIds.includes(id)) byRoute.get(id).set(() => void 0);
			for (const nextMatch of nextMatches) {
				const matchStore = getMatchStore(nextMatch.routeId);
				if (matchStore.get() !== nextMatch) matchStore.set(nextMatch);
			}
		});
	}
	return store;
}
function isExternalUrl(url, origin) {
	return (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin || !!url.username || !!url.password;
}
function getUrlPath(url) {
	return url.pathname + url.search + url.hash;
}
function routeNeedsLoad(route) {
	return (
		route.options.loader ||
		route.options.beforeLoad ||
		route.lazyFn ||
		route.options.component?.preload ||
		route.options.pendingComponent?.preload
	);
}
function getLocationChangeInfo(location, resolvedLocation) {
	return {
		fromLocation: resolvedLocation,
		toLocation: location,
		pathChanged: resolvedLocation?.pathname !== location.pathname,
		hrefChanged: resolvedLocation?.href !== location.href,
		hashChanged: resolvedLocation?.hash !== location.hash,
	};
}
function _getUserHistoryState({
	key: _key,
	__TSR_key: _tsrKey,
	__TSR_index: _tsrIndex,
	__hashScrollIntoViewOptions: _hashScroll,
	...state
}) {
	return state;
}
function lifecycleEnd(matches) {
	return matches.findIndex((match) => match.status === 'error' || match.status === 'notFound' || match._notFound) + 1;
}
function runRouteLifecycle(router2, previous, matches, previousEnd, nextEnd, owner) {
	if (previousEnd) previous = previous.slice(0, previousEnd);
	if (nextEnd) matches = matches.slice(0, nextEnd);
	for (const match of previous) {
		if (!matches.some((candidate) => candidate.routeId === match.routeId)) router2.routesById[match.routeId].options.onLeave?.(match);
	}
	for (const match of matches) {
		router2.routesById[match.routeId].options[previous.some((candidate) => candidate.routeId === match.routeId) ? 'onStay' : 'onEnter']?.(
			match,
		);
	}
}
var RouterCore = class {
	/**
	 * @deprecated Use the `createRouter` function instead
	 */
	constructor(options, getStoreConfig) {
		this.tempLocationKey = `${Math.round(Math.random() * 1e7)}`;
		this._scroll = { next: true };
		this.subscribers = /* @__PURE__ */ new Set();
		this._cache = /* @__PURE__ */ new Map();
		this._committed = [];
		this.routeBranchCache = /* @__PURE__ */ new WeakMap();
		this.lightweightCache = /* @__PURE__ */ new WeakMap();
		this.startTransition = async (fn) => {
			fn();
			return false;
		};
		this.update = (newOptions) => {
			const prevOptions = this.options;
			const prevBasepath = this.basepath ?? prevOptions?.basepath ?? '/';
			const basepathWasUnset = this.basepath === void 0;
			const prevRewriteOption = prevOptions?.rewrite;
			this.options = {
				...prevOptions,
				...newOptions,
			};
			this.isServer = this.options.isServer ?? isServer ?? typeof document === 'undefined';
			this.protocolAllowlist = new Set(this.options.protocolAllowlist);
			if (this.options.pathParamsAllowedCharacters) this.pathParamsDecoder = compileDecodeCharMap(this.options.pathParamsAllowedCharacters);
			if (!this.history || (this.options.history && this.options.history !== this.history))
				if (!this.options.history);
				else this.history = this.options.history;
			this.origin = this.options.origin;
			if (!this.origin) this.origin = 'http://localhost';
			if (this.history) this.updateLatestLocation();
			if (this.options.routeTree !== this.routeTree) {
				this.routeTree = this.options.routeTree;
				let processRouteTreeResult;
				if (globalThis.__TSR_CACHE__ && globalThis.__TSR_CACHE__.routeTree === this.routeTree) {
					const cached = globalThis.__TSR_CACHE__;
					this.resolvePathCache = cached.resolvePathCache;
					processRouteTreeResult = cached.processRouteTreeResult;
				} else {
					this.resolvePathCache = createSieveCache(1e3);
					processRouteTreeResult = this.buildRouteTree();
					if (globalThis.__TSR_CACHE__ === void 0)
						globalThis.__TSR_CACHE__ = {
							routeTree: this.routeTree,
							processRouteTreeResult,
							resolvePathCache: this.resolvePathCache,
						};
				}
				this.setRoutes(processRouteTreeResult);
			}
			if (!this.stores && this.latestLocation) {
				const config = this.getStoreConfig(this);
				this.batch = config.batch;
				this.stores = createRouterStores(this.latestLocation, config);
			}
			const nextBasepath = this.options.basepath ?? '/';
			const nextRewriteOption = this.options.rewrite;
			if (basepathWasUnset || prevBasepath !== nextBasepath || prevRewriteOption !== nextRewriteOption) {
				this.basepath = nextBasepath;
				const rewrites = [];
				const trimmed = trimPath(nextBasepath);
				if (trimmed && trimmed !== '/') rewrites.push(rewriteBasepath({ basepath: nextBasepath }));
				if (nextRewriteOption) rewrites.push(nextRewriteOption);
				this.rewrite = rewrites.length === 0 ? void 0 : rewrites.length === 1 ? rewrites[0] : composeRewrites(rewrites);
				if (this.history) this.updateLatestLocation();
				if (this.stores) this.stores.location.set(this.latestLocation);
			}
		};
		this.updateLatestLocation = () => {
			this.latestLocation = this.parseLocation(this.history.location, this.latestLocation);
		};
		this.buildRouteTree = () => {
			const result = processRouteTree(this.routeTree, this.options.caseSensitive, (route, i) => {
				route.init({ originalIndex: i });
			});
			if (this.options.routeMasks) processRouteMasks(this.options.routeMasks, result.processedTree);
			return result;
		};
		this.subscribe = (eventType, fn) => {
			const listener = {
				eventType,
				fn,
			};
			this.subscribers.add(listener);
			return () => {
				this.subscribers.delete(listener);
			};
		};
		this.emit = (routerEvent) => {
			for (const listener of this.subscribers)
				if (listener.eventType === routerEvent.type)
					try {
						listener.fn(routerEvent);
					} catch (e) {
						console.error(e);
					}
		};
		this.parseLocation = (locationToParse, previousLocation) => {
			const parse = ({ pathname, search, hash, href, state }) => {
				if (!this.rewrite && !/[ \x00-\x1f\x7f\u0080-\uffff]/.test(pathname)) {
					const parsedSearch2 = this.options.parseSearch(search);
					const searchStr2 = this.options.stringifySearch(parsedSearch2);
					return {
						href: pathname + searchStr2 + hash,
						publicHref: pathname + searchStr2 + hash,
						pathname: decodePath(pathname),
						external: false,
						searchStr: searchStr2,
						search: nullReplaceEqualDeep(previousLocation?.search, parsedSearch2),
						hash: decodePath(hash.slice(1)),
						state: replaceEqualDeep(previousLocation?.state, state),
					};
				}
				const fullUrl = new URL(href, this.origin);
				const url = executeRewriteInput(this.rewrite, fullUrl);
				const parsedSearch = this.options.parseSearch(url.search);
				const searchStr = this.options.stringifySearch(parsedSearch);
				url.search = searchStr;
				return {
					href: url.href.replace(url.origin, ''),
					publicHref: href,
					pathname: decodePath(normalizeProtocolRelative(url.pathname)),
					external: !!this.rewrite && isExternalUrl(url, this.origin),
					searchStr,
					search: nullReplaceEqualDeep(previousLocation?.search, parsedSearch),
					hash: decodePath(url.hash.slice(1)),
					state: replaceEqualDeep(previousLocation?.state, state),
				};
			};
			const location = parse(locationToParse);
			const { __tempLocation, __tempKey } = location.state;
			if (__tempLocation && (!__tempKey || __tempKey === this.tempLocationKey)) {
				const parsedTempLocation = parse(__tempLocation);
				parsedTempLocation.state.key = location.state.key;
				parsedTempLocation.state.__TSR_key = location.state.__TSR_key;
				delete parsedTempLocation.state.__tempLocation;
				return {
					...parsedTempLocation,
					maskedLocation: location,
				};
			}
			return location;
		};
		this.resolvePathWithBase = (from, path) => {
			return resolvePath({
				base: from,
				to: path,
				trailingSlash: this.options.trailingSlash,
				cache: this.resolvePathCache,
			});
		};
		this.matchRoutes = (pathnameOrNext, locationSearchOrOpts, opts) => {
			if (typeof pathnameOrNext === 'string')
				return this.matchRoutesInternal(
					{
						pathname: pathnameOrNext,
						search: locationSearchOrOpts,
					},
					opts,
				);
			return this.matchRoutesInternal(pathnameOrNext, locationSearchOrOpts);
		};
		this.getMatchedRoutes = (pathname) => {
			const rawParams = /* @__PURE__ */ Object.create(null);
			const match = findRouteMatch(trimPathRight(pathname), this.processedTree, true);
			if (match) Object.assign(rawParams, match.rawParams);
			return [match?.branch || [this.routesById['__root__']], rawParams, match?.route];
		};
		this.buildLocation = (opts) => {
			const build = (dest = {}) => {
				if (dest.href) {
					const parsed = parseHref(dest.href, {});
					dest = {
						...dest,
						to: executeRewriteInput(this.rewrite, new URL(parsed.pathname, this.origin)).pathname,
						search: this.options.parseSearch(parsed.search),
						hash: parsed.hash.slice(1),
					};
				}
				const currentLocation = dest._fromLocation || this._pendingLocation || this.latestLocation;
				const lightweightResult = this.matchRoutesLightweight(currentLocation);
				const defaultedFromPath = dest.unsafeRelative === 'path' ? currentLocation.pathname : (dest.from ?? lightweightResult[1]);
				const fromSearch = lightweightResult[2];
				const fromParams = lightweightResult[3];
				const nextTo = this.resolvePathWithBase(defaultedFromPath, dest.to ? `${dest.to}` : '.');
				let nextParams = resolveNextParams(dest.params, fromParams);
				const destRoute = this.routesByPath[trimPathRight(nextTo)];
				let destRoutes;
				if (destRoute) destRoutes = this.getRouteBranch(destRoute);
				else if (nextTo.includes('$')) destRoutes = [];
				else {
					const [matchedRoutes, rawParams, foundRoute] = this.getMatchedRoutes(nextTo);
					destRoutes = matchedRoutes;
					if (this.options.notFoundRoute && (!foundRoute || (foundRoute.path !== '/' && rawParams['**'])))
						destRoutes = [...destRoutes, this.options.notFoundRoute];
				}
				if (destRoutes.length && hasKeys(nextParams))
					for (const route of destRoutes) {
						const fn = route.options.params?.stringify ?? route.options.stringifyParams;
						if (fn) {
							if (nextParams === fromParams) nextParams = Object.assign(/* @__PURE__ */ Object.create(null), nextParams);
							try {
								Object.assign(nextParams, fn(nextParams));
							} catch {}
						}
					}
				const nextPathname = opts.leaveParams
					? nextTo
					: decodePath(
							normalizeProtocolRelative(
								interpolatePath({
									path: nextTo,
									params: nextParams,
									decoder: this.pathParamsDecoder,
									server: this.isServer,
								}).interpolatedPath,
							),
						);
				let nextSearch = fromSearch;
				if (opts._includeValidateSearch && this.options.search?.strict) {
					const validatedSearch = {};
					destRoutes.forEach((route) => {
						if (route.options.validateSearch)
							try {
								Object.assign(
									validatedSearch,
									validateSearch(route.options.validateSearch, {
										...validatedSearch,
										...nextSearch,
									}),
								);
							} catch {}
					});
					nextSearch = validatedSearch;
				}
				nextSearch = applySearchMiddleware(nextSearch, dest, destRoutes, opts._includeValidateSearch);
				nextSearch = nullReplaceEqualDeep(fromSearch, nextSearch);
				const searchStr = this.options.stringifySearch(nextSearch);
				const hash = dest.hash === true ? currentLocation.hash : dest.hash ? functionalUpdate(dest.hash, currentLocation.hash) : void 0;
				const hashStr = hash ? `#${hash}` : '';
				let nextState = dest.state === true ? currentLocation.state : dest.state ? functionalUpdate(dest.state, currentLocation.state) : {};
				if (dest.state) nextState = replaceEqualDeep(currentLocation.state, nextState);
				const fullPath = `${nextPathname}${searchStr}${hashStr}`;
				let href;
				let publicHref;
				let external = false;
				if (this.rewrite) {
					const url = new URL(fullPath, this.origin);
					const origin = url.origin;
					const rewrittenUrl = executeRewriteOutput(this.rewrite, url);
					href = getUrlPath(url);
					if (isExternalUrl(rewrittenUrl, origin)) {
						publicHref = rewrittenUrl.href;
						external = true;
					} else publicHref = normalizeProtocolRelative(getUrlPath(rewrittenUrl));
				} else {
					href = encodePathLikeUrl(fullPath);
					publicHref = href;
				}
				return {
					publicHref,
					href,
					pathname: nextPathname,
					search: nextSearch,
					searchStr,
					state: nextState,
					hash: hash ?? '',
					external,
					unmaskOnReload: dest.unmaskOnReload,
				};
			};
			const next = build(opts);
			if (opts.mask)
				next.maskedLocation = build({
					from: opts.from,
					...opts.mask,
				});
			else if (this.options.routeMasks) {
				const match = findFlatMatch(next.pathname, this.processedTree);
				if (match) {
					const params = Object.assign(/* @__PURE__ */ Object.create(null), match.rawParams);
					const { from: _from, params: maskParams, ...maskProps } = match.route;
					const nextParams = resolveNextParams(maskParams, params);
					next.maskedLocation = build({
						from: opts.from,
						...maskProps,
						params: nextParams,
					});
				}
			}
			return next;
		};
		this.commitLocation = async ({ viewTransition, ignoreBlocker, ...next }) => {
			const nextLocation = next.maskedLocation ?? next;
			if (nextLocation.external && false);
			let historyAction;
			const isSameLocation =
				trimPathRight(this.latestLocation.href) === trimPathRight(next.href) &&
				deepEqual(_getUserHistoryState(next.state), _getUserHistoryState(this.latestLocation.state));
			const previousCommitPromise = this._commitPromise;
			let resolve;
			const commitPromise = new Promise((done) => {
				resolve = done;
			});
			commitPromise.resolve = () => {
				resolve();
				previousCommitPromise?.resolve();
			};
			this._commitPromise = commitPromise;
			if (isSameLocation) this.load();
			else {
				let { maskedLocation, hashScrollIntoView, ...nextHistory } = next;
				if (maskedLocation) {
					nextHistory = {
						...maskedLocation,
						state: {
							...maskedLocation.state,
							__tempKey: void 0,
							__tempLocation: {
								...nextHistory,
								search: nextHistory.searchStr,
								state: {
									...nextHistory.state,
									__tempKey: void 0,
									__tempLocation: void 0,
									__TSR_key: void 0,
									key: void 0,
								},
							},
						},
					};
					if (nextHistory.unmaskOnReload ?? this.options.unmaskOnReload ?? false) nextHistory.state.__tempKey = this.tempLocationKey;
				}
				nextHistory.state.__hashScrollIntoViewOptions = hashScrollIntoView ?? this.options.defaultHashScrollIntoView ?? true;
				this.shouldViewTransition = viewTransition;
				historyAction = next.replace ? 'REPLACE' : 'PUSH';
				this.history[historyAction === 'REPLACE' ? 'replace' : 'push'](nextHistory.publicHref, nextHistory.state, { ignoreBlocker });
				if (!this.history.subscribers.size) this.load({ action: { type: historyAction } });
			}
			this._scroll.next = next.resetScroll ?? true;
			return this._commitPromise;
		};
		this.buildAndCommitLocation = ({ replace, resetScroll, hashScrollIntoView, viewTransition, ignoreBlocker, ...rest } = {}) => {
			const location = this.buildLocation({
				...rest,
				_includeValidateSearch: true,
			});
			this._pendingLocation = location;
			const commitPromise = this.commitLocation({
				...location,
				viewTransition,
				replace,
				resetScroll,
				hashScrollIntoView,
				ignoreBlocker,
			});
			queueMicrotask(() => {
				if (this._pendingLocation === location) this._pendingLocation = void 0;
			});
			return commitPromise;
		};
		this.navigate = async ({ to, reloadDocument, href, publicHref, ...rest }) => {
			const hrefScheme = href ? getUrlScheme(href) : void 0;
			if (hrefScheme || reloadDocument) {
				if (to !== void 0 || !href) {
					const location = this.buildLocation({
						to,
						...rest,
					});
					const publicLocation = location.maskedLocation ?? location;
					href ??= publicLocation.publicHref;
					publicHref ??= publicLocation.publicHref;
				}
				const reloadHref = !hrefScheme && publicHref ? publicHref : href;
				return documentNavigation(this, reloadHref, rest);
			}
			return this.buildAndCommitLocation({
				...rest,
				href,
				to,
				_isNavigate: true,
			});
		};
		this.load = async (opts) => {
			return loadServerRoute(this, opts);
		};
		this.startViewTransition = (fn) => {
			this.shouldViewTransition ?? this.options.defaultViewTransition;
			this.shouldViewTransition = void 0;
			return fn();
		};
		this.invalidate = (opts) => {
			const committedMatches = this._committed;
			const filter = opts?.filter;
			const preloads = this._preloads;
			const invalidIds = new Set(
				[...committedMatches, ...this._cache.values(), ...[...(preloads?.values() ?? [])].flat(), ...(this._tx?.[3] ?? [])]
					.filter((match) => !filter || filter(match))
					.map((match) => match.id),
			);
			const discardedPreloads = [];
			for (const [controller, matches] of preloads ?? [])
				if (matches.some((match) => invalidIds.has(match.id))) {
					preloads.delete(controller);
					discardedPreloads.push(controller);
				}
			const invalidate = (d) => {
				if (invalidIds.has(d.id)) {
					const route = this.routesById[d.routeId];
					const next = {
						...d,
						invalid: true,
						...((opts?.forcePending || d.status === 'error' || d.status === 'notFound') && routeNeedsLoad(route)
							? {
									status: 'pending',
									error: void 0,
								}
							: void 0),
					};
					d._flight = void 0;
					return next;
				}
				return d;
			};
			this._committed = committedMatches.map(invalidate);
			for (const [id, match] of this._cache)
				if (invalidIds.has(id)) {
					match.invalid = true;
					if (opts?.forcePending) match.status = 'pending';
				}
			for (const id of invalidIds) this._flights?.delete(id);
			for (const controller of discardedPreloads) controller.abort();
			this.shouldViewTransition = false;
			return this.load({ sync: opts?.sync });
		};
		this.resolveRedirect = (redirect2) => {
			const options2 = redirect2.options;
			let href = redirect2.headers.get('Location') || options2.href;
			if (!href) {
				const location = this.buildLocation(options2);
				href = (location.maskedLocation ?? location).publicHref || '/';
			}
			let scheme;
			if (protocolRelativePrefixRegex.test(href) || ((scheme = getUrlScheme(href)) && !this.protocolAllowlist.has(scheme)))
				throw new Error('Redirect blocked: unsafe protocol');
			if (scheme === 'http:' || scheme === 'https:') {
				const url = new URL(href);
				if (url.pathname.startsWith('//')) href = url.href;
				else if (!isExternalUrl(url, this.origin)) {
					href = getUrlPath(url);
					scheme = void 0;
				}
			}
			if (scheme) options2.reloadDocument = true;
			options2.href = href;
			redirect2.headers.set('Location', href);
			return redirect2;
		};
		this.clearCache = (opts) => {
			const cached = this._cache;
			const preloads = this._preloads;
			const filter = opts?.filter;
			const discarded = [];
			const discardedIds = [];
			for (const [id, match] of cached)
				if (!filter || filter(match)) {
					discardedIds.push(id);
					discarded.push(match);
				}
			const abort = [];
			for (const [controller, matches] of preloads ?? [])
				if (!filter || matches.some(filter)) {
					abort.push(controller);
					discarded.push(...matches);
				}
			for (const id of discardedIds) cached.delete(id);
			for (const controller of abort) preloads.delete(controller);
			for (const match of discarded) {
				const flight = match._flight;
				match._flight = void 0;
				if (flight && !--flight[2]) {
					if (this._flights?.get(match.id) === flight) this._flights.delete(match.id);
					abort.push(flight[1]);
				}
			}
			for (const controller of abort) controller.abort();
		};
		this.loadRouteChunk = loadRouteChunk;
		this.preloadRoute = (opts) => preloadClientRoute(this, opts);
		this.matchRoute = (location, opts) => {
			const matchLocation = {
				...location,
				to: location.to ? this.resolvePathWithBase(location.from || '', location.to) : void 0,
				params: location.params || {},
				leaveParams: true,
			};
			const next = this.buildLocation(matchLocation);
			const isPending = this.stores.status.get() === 'pending';
			if (opts?.pending && !isPending) return false;
			const baseLocation =
				(opts?.pending ?? !isPending) ? this.latestLocation : this.stores.resolvedLocation.get() || this.stores.location.get();
			const match = findSingleMatch(
				next.pathname,
				opts?.caseSensitive ?? false,
				opts?.fuzzy ?? false,
				baseLocation.pathname,
				this.processedTree,
			);
			if (!match) return false;
			if (location.params) {
				if (!deepEqual(match.rawParams, location.params, { partial: true })) return false;
			}
			if (opts?.includeSearch ?? true) return deepEqual(baseLocation.search, next.search, { partial: true }) ? match.rawParams : false;
			return match.rawParams;
		};
		this.getStoreConfig = getStoreConfig;
		this.update({
			defaultPreloadDelay: 50,
			defaultPendingMs: 1e3,
			defaultPendingMinMs: 500,
			context: void 0,
			...options,
			caseSensitive: options.caseSensitive ?? false,
			notFoundMode: options.notFoundMode ?? 'fuzzy',
			stringifySearch: options.stringifySearch ?? defaultStringifySearch,
			parseSearch: options.parseSearch ?? defaultParseSearch,
			protocolAllowlist: options.protocolAllowlist ?? DEFAULT_PROTOCOL_ALLOWLIST,
		});
	}
	isShell() {
		return !!this.options.isShell;
	}
	get state() {
		return this.stores.__store.get();
	}
	setRoutes({ routesById, routesByPath, processedTree }) {
		this.routesById = routesById;
		this.routesByPath = routesByPath;
		this.processedTree = processedTree;
		const notFoundRoute = this.options.notFoundRoute;
		if (notFoundRoute) {
			notFoundRoute.init({ originalIndex: 99999999999 });
			this.routesById[notFoundRoute.id] = notFoundRoute;
		}
	}
	getRouteBranch(route) {
		let branch = this.routeBranchCache.get(route);
		if (!branch) {
			branch = buildRouteBranch(route);
			this.routeBranchCache.set(route, branch);
		}
		return branch;
	}
	matchRoutesInternal(next, opts) {
		const [initialMatchedRoutes, rawParams, foundRoute] = this.getMatchedRoutes(next.pathname);
		let matchedRoutes = initialMatchedRoutes;
		let isGlobalNotFound = false;
		if (foundRoute ? foundRoute.path !== '/' && rawParams['**'] : trimPathRight(next.pathname))
			if (this.options.notFoundRoute) matchedRoutes = [...matchedRoutes, this.options.notFoundRoute];
			else isGlobalNotFound = true;
		const _notFoundRouteId = isGlobalNotFound ? findGlobalNotFoundRouteId(this.options.notFoundMode, matchedRoutes) : void 0;
		const matches = new Array(matchedRoutes.length);
		const committed = this._committed;
		const previousAt = (route, index) => {
			const match = committed[index];
			return match?.routeId === route.id
				? match
				: route === this.options.notFoundRoute
					? committed.find((candidate) => candidate.routeId === route.id)
					: void 0;
		};
		let strictParams;
		for (let index = 0; index < matchedRoutes.length; index++) {
			const route = matchedRoutes[index];
			const parentMatch = matches[index - 1];
			let preMatchSearch;
			let strictMatchSearch;
			let searchError;
			{
				const parentSearch = parentMatch?.search ?? next.search;
				const parentStrictSearch = parentMatch?._strictSearch ?? void 0;
				try {
					const strictSearch = validateSearch(route.options.validateSearch, { ...parentSearch }) ?? void 0;
					preMatchSearch = {
						...parentSearch,
						...strictSearch,
					};
					strictMatchSearch = {
						...parentStrictSearch,
						...strictSearch,
					};
				} catch (err) {
					let searchParamError = err;
					if (!(err instanceof SearchParamError)) searchParamError = new SearchParamError(err.message, { cause: err });
					if (opts?.throwOnError) throw searchParamError;
					preMatchSearch = parentSearch;
					strictMatchSearch = {};
					searchError = searchParamError;
				}
			}
			let loaderDeps = '';
			let loaderDepsHash = '';
			try {
				loaderDeps = route.options.loaderDeps?.({ search: preMatchSearch }) ?? '';
				loaderDepsHash = loaderDeps ? JSON.stringify(loaderDeps) || '' : '';
			} catch (cause2) {
				if (opts?.throwOnError) throw cause2;
				searchError ??= cause2;
			}
			const { interpolatedPath, usedParams } = interpolatePath({
				path: route.fullPath,
				params: rawParams,
				decoder: this.pathParamsDecoder,
				server: this.isServer,
			});
			const matchId = route.id + interpolatedPath + loaderDepsHash;
			const previousMatch = previousAt(route, index);
			const existingMatch = this._cache.get(matchId) ?? (previousMatch?.id === matchId ? previousMatch : void 0);
			strictParams = existingMatch?._strictParams ?? Object.assign(usedParams, strictParams);
			let paramsError;
			if (!existingMatch)
				try {
					extractStrictParams(route, strictParams);
				} catch (err) {
					if (isNotFound(err) || isRedirect(err)) paramsError = err;
					else paramsError = new PathParamError(err.message, { cause: err });
					if (opts?.throwOnError) throw paramsError;
				}
			const cause = previousMatch ? 'stay' : 'enter';
			let match;
			if (existingMatch)
				match = {
					...existingMatch,
					cause,
					search: previousMatch
						? nullReplaceEqualDeep(previousMatch.search, preMatchSearch)
						: nullReplaceEqualDeep(existingMatch.search, preMatchSearch),
					_strictSearch: strictMatchSearch,
					searchError,
				};
			else {
				const status = routeNeedsLoad(route) ? 'pending' : 'success';
				match = {
					id: matchId,
					ssr: void 0,
					index,
					routeId: route.id,
					params: previousMatch?.params ?? strictParams,
					_strictParams: strictParams,
					pathname: interpolatedPath,
					updatedAt: Date.now(),
					search: previousMatch ? nullReplaceEqualDeep(previousMatch.search, preMatchSearch) : preMatchSearch,
					_strictSearch: strictMatchSearch,
					searchError,
					status,
					isFetching: false,
					error: void 0,
					paramsError,
					context: {},
					abortController: opts?._controller ?? new AbortController(),
					cause,
					loaderDeps: previousMatch ? replaceEqualDeep(previousMatch.loaderDeps, loaderDeps) : loaderDeps,
					invalid: false,
					preload: false,
					staticData: route.options.staticData || {},
					fullPath: route.fullPath,
				};
			}
			const _notFound = _notFoundRouteId === route.id;
			if (match._notFound && !_notFound) match.error = void 0;
			match._notFound = _notFound;
			matches[index] = match;
		}
		for (let index = 0; index < matches.length; index++) {
			const match = matches[index];
			match.params = match.cause === 'stay' ? nullReplaceEqualDeep(match.params, strictParams) : strictParams;
			if (opts?._controller) match.context = {};
		}
		return matches;
	}
	/**
	 * Lightweight route matching for buildLocation.
	 * Only computes fullPath, accumulated search, and params - skipping expensive
	 * operations like AbortController, loaderDeps, and full match objects.
	 */
	matchRoutesLightweight(location) {
		const lastRouteId = last(this.stores.ids.get());
		const lastStateMatch = lastRouteId ? this.stores.byRoute.get(lastRouteId).get() : void 0;
		const lastStateMatchId = lastStateMatch?.id;
		const cached = this.lightweightCache.get(location);
		if (cached && cached[0] === lastStateMatchId) return cached[1];
		const [matchedRoutes, rawParams] = this.getMatchedRoutes(location.pathname);
		const lastRoute = last(matchedRoutes);
		const accumulatedSearch = { ...location.search };
		for (const route of matchedRoutes)
			try {
				Object.assign(accumulatedSearch, validateSearch(route.options.validateSearch, accumulatedSearch));
			} catch {}
		const canReuseParams = lastStateMatch && lastStateMatch.routeId === lastRoute.id && lastStateMatch.pathname === location.pathname;
		let params;
		if (canReuseParams) params = lastStateMatch.params;
		else {
			const strictParams = Object.assign(/* @__PURE__ */ Object.create(null), rawParams);
			for (const route of matchedRoutes)
				try {
					extractStrictParams(route, strictParams);
				} catch {}
			params = strictParams;
		}
		const result = [matchedRoutes, lastRoute.fullPath, accumulatedSearch, params];
		this.lightweightCache.set(location, [lastStateMatchId, result]);
		return result;
	}
};
async function documentNavigation(router2, href, { replace, ignoreBlocker }) {
	if (isDangerousProtocol(href, router2.protocolAllowlist)) {
		return;
	}
	if (!ignoreBlocker) {
		const blockers = router2.history._getBlockers();
		for (const blocker of blockers)
			if (blocker?.blockerFn) {
				if (
					await blocker.blockerFn({
						currentLocation: router2.history.location,
						nextLocation: router2.history.location,
						action: replace ? 'REPLACE' : 'PUSH',
					})
				)
					return;
			}
	}
	router2.history._ignoreNextBeforeUnload?.(href);
	if (replace) window.location.replace(href);
	else window.location.href = href;
}
var SearchParamError = class extends Error {};
var PathParamError = class extends Error {};
function validateSearch(validateSearch2, input) {
	if (validateSearch2 == null) return {};
	if ('~standard' in validateSearch2) {
		const result = validateSearch2['~standard'].validate(input);
		if (result instanceof Promise) throw new SearchParamError('Async validation not supported');
		if (result.issues) throw new SearchParamError(JSON.stringify(result.issues, void 0, 2), { cause: result });
		return result.value;
	}
	if ('parse' in validateSearch2) return validateSearch2.parse(input);
	if (typeof validateSearch2 === 'function') return validateSearch2(input);
	return {};
}
function applySearchMiddleware(search, dest, destRoutes, includeValidateSearch) {
	const middlewares = [];
	for (const route of destRoutes) {
		const routeOptions = route.options;
		if ('search' in routeOptions) {
			if (routeOptions.search?.middlewares) middlewares.push(...routeOptions.search.middlewares);
		} else if (routeOptions.preSearchFilters || routeOptions.postSearchFilters) {
			const legacyMiddleware = ({ search: search2, next }) => {
				const result = next(
					routeOptions.preSearchFilters ? routeOptions.preSearchFilters.reduce((prev, next2) => next2(prev), search2) : search2,
				);
				return routeOptions.postSearchFilters ? routeOptions.postSearchFilters.reduce((prev, next2) => next2(prev), result) : result;
			};
			middlewares.push(legacyMiddleware);
		}
		const routeValidateSearch = routeOptions.validateSearch;
		if (includeValidateSearch && routeValidateSearch) {
			const validate = ({ search: search2, next, meta }) => {
				const result = next(search2);
				try {
					const validated = validateSearch(routeValidateSearch, result);
					if (meta && validated) {
						for (const key in validated) if (!(key in result)) (meta.defaulted ||= /* @__PURE__ */ new Map()).set(key, validated[key]);
					}
					return {
						...result,
						...validated,
					};
				} catch {}
				return result;
			};
			middlewares.push(validate);
		}
	}
	const applyNext = (index, currentSearch, meta) => {
		if (index >= middlewares.length) {
			if (!dest.search) return {};
			if (dest.search === true) return currentSearch;
			const result = functionalUpdate(dest.search, currentSearch);
			if (meta) meta.explicit = result;
			return result;
		}
		const next = (newSearch, collectMeta) => {
			if (collectMeta) {
				const nextMeta = meta || {};
				return {
					search: applyNext(index + 1, newSearch, nextMeta),
					meta: nextMeta,
				};
			}
			return applyNext(index + 1, newSearch, meta);
		};
		return middlewares[index]({
			search: currentSearch,
			next,
			meta,
		});
	};
	return applyNext(0, search);
}
function findGlobalNotFoundRouteId(notFoundMode, routes) {
	if (notFoundMode !== 'root') {
		let fallback;
		for (let i = routes.length - 1; i >= 0; i--) {
			const route = routes[i];
			if (route.options.notFoundComponent) return route.id;
			fallback ||= route.children && route.id;
		}
		if (fallback) return fallback;
	}
	return rootRouteId;
}
function resolveNextParams(spec, base) {
	if (spec === false || spec === null) return /* @__PURE__ */ Object.create(null);
	if ((spec ?? true) === true) return base;
	const next = Object.assign(/* @__PURE__ */ Object.create(null), base);
	return Object.assign(next, functionalUpdate(spec, next));
}
function extractStrictParams(route, accumulatedParams) {
	const parseParams = route.options.params?.parse ?? route.options.parseParams;
	if (parseParams) Object.assign(accumulatedParams, parseParams(accumulatedParams));
}
function waitForReason(value, signal, onLate) {
	const promise = Promise.resolve(value);
	if (signal.aborted) {
		return Promise.race([Promise.reject(signal.reason), promise]);
	}
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		promise
			.then((result) => {
				if (signal.aborted);
				else resolve(result);
			}, reject)
			.finally(() => signal.removeEventListener('abort', abort));
	});
}
const SUCCESS = 0;
const ERROR = 1;
const NOT_FOUND = 2;
const REDIRECTED = 3;
const SKIPPED = 4;
function getRoute(router2, match) {
	return router2.routesById[match.routeId];
}
function normalize(value, rejected) {
	if (isRedirect(value)) return [REDIRECTED, value];
	if (isNotFound(value)) return [NOT_FOUND, value];
	if (rejected && typeof value?.then === 'function') value = new Error('A Promise was thrown', { cause: value });
	return rejected ? [ERROR, value] : [SUCCESS, value];
}
function normalizeError(router2, lane, route, cause, signal, notify = true) {
	signal?.throwIfAborted();
	let outcome = normalize(cause, true);
	if (outcome[0] !== ERROR) return materializeRedirect(router2, lane, route, outcome, signal, notify);
	try {
		route.options.onError?.(outcome[1]);
	} catch (onErrorCause) {
		outcome = normalize(onErrorCause, true);
	}
	signal?.throwIfAborted();
	return materializeRedirect(router2, lane, route, outcome, signal, notify);
}
function materializeRedirect(router2, lane, route, outcome, signal, notify = true) {
	if (outcome[0] !== REDIRECTED) return outcome;
	signal?.throwIfAborted();
	try {
		outcome[1].options._fromLocation = lane.location;
		router2.resolveRedirect(outcome[1]);
		signal?.throwIfAborted();
		return outcome;
	} catch (cause) {
		signal?.throwIfAborted();
		return notify ? normalizeError(router2, lane, route, cause, signal, false) : [ERROR, cause];
	}
}
function maybe(value, cause) {
	if (cause !== void 0)
		return {
			status: 'error',
			error: cause,
		};
	return {
		status: 'success',
		value,
	};
}
function navigateFrom(router2, location) {
	return (options) =>
		router2.navigate({
			...options,
			_fromLocation: location,
		});
}
function waitFor(value, signal) {
	return signal ? waitForReason(value, signal) : value;
}
function resolveSsr(router2, lane, index) {
	const match = lane.matches[index];
	const route = getRoute(router2, match);
	const parentSsr = lane.matches[index - 1]?.ssr;
	if (router2.isShell()) return route.id === rootRouteId;
	if (parentSsr === false) return false;
	const inherit = (value) => {
		return value === true && parentSsr === 'data-only' ? 'data-only' : value;
	};
	const defaultSsr = router2.options.defaultSsr ?? true;
	const inheritedDefault = inherit(defaultSsr);
	match.ssr = inheritedDefault;
	const option = route.options.ssr;
	if (option === void 0) return inheritedDefault;
	if (typeof option !== 'function') return inherit(option);
	const context = {
		search: maybe(match.search, match.searchError),
		params: maybe(match.params, match.paramsError),
		location: lane.location,
		matches: lane.matches.map((candidate) => ({
			index: candidate.index,
			pathname: candidate.pathname,
			fullPath: candidate.fullPath,
			staticData: candidate.staticData,
			id: candidate.id,
			routeId: candidate.routeId,
			search: maybe(candidate.search, candidate.searchError),
			params: maybe(candidate.params, candidate.paramsError),
			ssr: candidate.ssr,
		})),
	};
	try {
		return Promise.resolve(option(context)).then((value) => inherit(value ?? defaultSsr));
	} catch (cause) {
		return Promise.reject(cause);
	}
}
function stampNotFound(match, outcome) {
	if (outcome[0] === NOT_FOUND && !outcome[1].routeId) outcome[1].routeId = match.routeId;
	return outcome;
}
async function contextualize(router2, lane, signal) {
	const globalBoundary = lane.matches.findIndex((match) => match._notFound);
	let end = globalBoundary < 0 ? lane.matches.length : globalBoundary + 1;
	let failure;
	let parentContext = { ...(router2.options.context ?? {}) };
	for (let index = 0; index < end; index++) {
		const match = lane.matches[index];
		const route = getRoute(router2, match);
		try {
			const ssr = resolveSsr(router2, lane, index);
			match.ssr = ssr instanceof Promise ? await ssr : ssr;
		} catch (cause) {
			signal?.throwIfAborted();
			failure = [index, stampNotFound(match, normalizeError(router2, lane, route, cause, signal))];
			end = index;
		}
		signal?.throwIfAborted();
		if (failure?.[1][0] === REDIRECTED) break;
		match.__beforeLoadContext = void 0;
		let context = parentContext;
		try {
			let routeContext;
			if (route.options.context) {
				const routeContextOptions = {
					deps: match.loaderDeps,
					params: match.params,
					context: parentContext,
					location: lane.location,
					navigate: navigateFrom(router2, lane.location),
					buildLocation: router2.buildLocation,
					cause: match.cause,
					abortController: match.abortController,
					preload: false,
					matches: lane.matches,
					routeId: route.id,
				};
				routeContext = route.options.context(routeContextOptions) ?? void 0;
			}
			context = {
				...parentContext,
				...routeContext,
			};
			match.context = context;
		} catch (cause) {
			signal?.throwIfAborted();
			if (!failure) failure = [index, stampNotFound(match, normalizeError(router2, lane, route, cause, signal))];
			end = index;
			break;
		}
		signal?.throwIfAborted();
		if (failure) break;
		const validationError = match.paramsError ?? match.searchError;
		if (validationError !== void 0) {
			failure = [index, stampNotFound(match, normalizeError(router2, lane, route, validationError, signal))];
			end = index;
			break;
		}
		signal?.throwIfAborted();
		if (match.ssr === false || !route.options.beforeLoad) {
			parentContext = context;
			continue;
		}
		const abortController = match.abortController;
		const options = {
			search: match.search,
			abortController,
			params: match.params,
			preload: false,
			context,
			location: lane.location,
			navigate: navigateFrom(router2, lane.location),
			buildLocation: router2.buildLocation,
			cause: match.cause,
			matches: lane.matches,
			routeId: route.id,
			...router2.options.additionalContext,
		};
		try {
			const beforeLoadContext = await route.options.beforeLoad(options);
			signal?.throwIfAborted();
			const outcome = stampNotFound(match, materializeRedirect(router2, lane, route, normalize(beforeLoadContext, false), signal));
			if (outcome[0] !== SUCCESS) {
				failure = [index, outcome];
				end = index;
				break;
			}
			match.__beforeLoadContext = beforeLoadContext;
			match.context = {
				...context,
				...beforeLoadContext,
			};
			parentContext = match.context;
		} catch (cause) {
			signal?.throwIfAborted();
			failure = [index, stampNotFound(match, normalizeError(router2, lane, route, cause, signal))];
			end = index;
			break;
		}
	}
	return {
		location: lane.location,
		matches: lane.matches,
		end,
		failure,
	};
}
function getLoaderContext(router2, lane, match, route, index, tasks) {
	return {
		params: match.params,
		deps: match.loaderDeps,
		preload: false,
		parentMatchPromise: tasks[index - 1]?.match,
		abortController: match.abortController,
		context: match.context,
		location: lane.location,
		navigate: navigateFrom(router2, lane.location),
		cause: match.cause,
		route,
		...router2.options.additionalContext,
	};
}
function createLoaderTask(router2, lane, index, tasks, signal) {
	const match = lane.matches[index];
	const route = getRoute(router2, match);
	let outcome;
	if (match.ssr === false) outcome = Promise.resolve([SKIPPED]);
	else {
		const routeLoader = route.options.loader;
		const loader = typeof routeLoader === 'function' ? routeLoader : routeLoader?.handler;
		if (!loader) outcome = Promise.resolve([SUCCESS, void 0]);
		else
			outcome = Promise.resolve()
				.then(() => loader(getLoaderContext(router2, lane, match, route, index, tasks)))
				.then(
					(result) => normalize(result, false),
					(cause) => normalize(cause, true),
				)
				.then((result) => {
					if (signal?.aborted || match.abortController.signal.reason === lane) return [SKIPPED];
					if (result[0] === ERROR) result = normalizeError(router2, lane, route, result[1], signal);
					else result = materializeRedirect(router2, lane, route, result, signal);
					return stampNotFound(match, result);
				});
	}
	const parentMatch = outcome.then((result) => {
		const snapshot = { ...match };
		if (result[0] === SUCCESS) {
			snapshot.loaderData = result[1];
			snapshot.status = 'success';
			snapshot.error = void 0;
			snapshot.invalid = false;
			snapshot.isFetching = false;
		} else if (result[0] === ERROR) {
			snapshot.status = 'error';
			snapshot.error = result[1];
		} else if (result[0] === NOT_FOUND) {
			snapshot.status = 'notFound';
			snapshot.error = result[1];
		}
		return snapshot;
	});
	return {
		index,
		outcome,
		match: parentMatch,
	};
}
async function getNotFoundBoundary(router2, matches, indexed, signal, fallback = 0) {
	const cause = indexed?.[1][1];
	let index = cause?.routeId ? matches.findIndex((match) => match.routeId === cause.routeId) : (indexed?.[0] ?? matches.length - 1);
	if (index < 0) index = 0;
	for (let candidate = index; candidate >= 0; candidate--) {
		const route = getRoute(router2, matches[candidate]);
		try {
			const loading = loadRouteChunk(route, false);
			if (loading) await loading;
		} catch {
			signal?.throwIfAborted();
		}
		signal?.throwIfAborted();
		if (route.options.notFoundComponent) return candidate;
	}
	return cause?.routeId ? index : fallback;
}
function abortMatches(matches, start = 0, reason) {
	for (let index = start; index < matches.length; index++) matches[index].abortController.abort(reason);
}
async function applyFailure(router2, lane, indexed, signal) {
	if (!indexed) {
		const boundary2 = lane.matches.findIndex((match2) => match2._notFound);
		if (boundary2 >= 0) {
			abortMatches(lane.matches, boundary2 + 1);
			return {
				status: 404,
				boundary: boundary2,
				kind: NOT_FOUND,
			};
		}
		return { status: 200 };
	}
	const [index, outcome] = indexed;
	if (outcome[0] === ERROR) {
		const match2 = lane.matches[index];
		match2._notFound = void 0;
		match2.status = 'error';
		match2.error = outcome[1];
		match2.isFetching = false;
		abortMatches(lane.matches, index + 1);
		return {
			status: 500,
			boundary: index,
			kind: ERROR,
		};
	}
	const boundary = indexed[2] ?? (await getNotFoundBoundary(router2, lane.matches, indexed, signal));
	const match = lane.matches[boundary];
	const cause = outcome[1];
	cause.routeId = match.routeId;
	match._notFound = void 0;
	if (match.routeId === router2.routeTree.id) {
		match.status = 'success';
		match._notFound = true;
		match.error = cause;
	} else {
		match.status = 'notFound';
		match.error = cause;
	}
	match.isFetching = false;
	abortMatches(lane.matches, boundary + 1);
	return {
		status: 404,
		boundary,
		kind: NOT_FOUND,
	};
}
async function loadNormalChunks(router2, lane, end, signal) {
	const chunks = [];
	for (let index = 0; index < lane.matches.length; index++) {
		const match = lane.matches[index];
		if (index >= end || match.ssr !== true || match.status !== 'success') continue;
		const route = getRoute(router2, match);
		try {
			const loading = loadRouteChunk(route);
			if (loading) {
				const chunk = loading.then(
					() => {
						signal?.throwIfAborted();
					},
					(cause) => {
						signal?.throwIfAborted();
						return [index, stampNotFound(match, normalizeError(router2, lane, route, cause, signal))];
					},
				);
				chunk.catch(() => {});
				chunks.push(chunk);
			}
		} catch (cause) {
			signal?.throwIfAborted();
			chunks.push([index, stampNotFound(match, normalizeError(router2, lane, route, cause, signal))]);
		}
	}
	for (const chunk of chunks) {
		const indexed = Array.isArray(chunk) ? chunk : await chunk;
		if (indexed) return indexed;
	}
}
async function projectLane(router2, lane, signal) {
	for (const match of lane.matches) {
		const routeOptions = getRoute(router2, match).options;
		if (routeOptions.head || routeOptions.scripts || routeOptions.headers) {
			const context = {
				ssr: router2.options.ssr,
				matches: lane.matches,
				match,
				params: match.params,
				loaderData: match.loaderData,
			};
			try {
				const [head, scripts, headers] = await Promise.all([
					routeOptions.head?.(context),
					routeOptions.scripts?.(context),
					routeOptions.headers?.(context),
				]);
				signal?.throwIfAborted();
				match.meta = head?.meta;
				match.links = head?.links;
				match.headScripts = head?.scripts;
				match.styles = head?.styles;
				match.scripts = scripts;
				match.headers = headers;
			} catch (cause) {
				signal?.throwIfAborted();
				console.error(cause);
			}
		}
		if (match.ssr === false || match.status !== 'success' || match._notFound) break;
	}
}
async function executeServerLane(router2, location, matchedMatches, signal) {
	const matched = {
		location,
		matches: matchedMatches.map((match) => ({
			...match,
			__beforeLoadContext: void 0,
			context: {},
			isFetching: false,
			abortController: new AbortController(),
		})),
	};
	const abortLane = () => abortMatches(matched.matches, 0, signal?.reason);
	if (signal?.aborted) {
		abortLane();
		signal.throwIfAborted();
	}
	signal?.addEventListener('abort', abortLane, { once: true });
	try {
		const plannedGlobalBoundary = matched.matches.findIndex((match) => match._notFound);
		if (router2.options.notFoundMode !== 'root' && plannedGlobalBoundary >= 0) {
			const boundary = await getNotFoundBoundary(router2, matched.matches, void 0, signal, plannedGlobalBoundary);
			if (boundary !== plannedGlobalBoundary) {
				matched.matches[plannedGlobalBoundary]._notFound = void 0;
				matched.matches[boundary]._notFound = true;
			}
		}
		const lane = await contextualize(router2, matched, signal);
		signal?.throwIfAborted();
		let loaderEnd = lane.end;
		if (lane.failure?.[1][0] === REDIRECTED) loaderEnd = 0;
		else if (lane.failure?.[1][0] === NOT_FOUND) {
			lane.failure[2] = await getNotFoundBoundary(router2, lane.matches, lane.failure, signal);
			loaderEnd = Math.min(loaderEnd, lane.failure[2] + 1);
		}
		const tasks = [];
		for (let index = 0; index < loaderEnd; index++) {
			const task = createLoaderTask(router2, lane, index, tasks, signal);
			tasks.push(task);
		}
		let loaderFailure;
		let control = lane.failure?.[1][0] === REDIRECTED ? lane.failure : void 0;
		try {
			await Promise.all(
				tasks.map((task) =>
					task.outcome.then((loadedOutcome) => {
						const match = lane.matches[task.index];
						const outcome = loadedOutcome;
						if (outcome[0] === SUCCESS) {
							match.loaderData = outcome[1];
							match.status = 'success';
							match.error = void 0;
							match.invalid = false;
							match.isFetching = false;
							match.updatedAt = Date.now();
						} else if (outcome[0] === REDIRECTED) {
							control = [task.index, outcome];
							throw control;
						} else {
							if (match.ssr !== false) {
								match.status = 'success';
								match.error = void 0;
								match.invalid = true;
								match.isFetching = false;
							}
							if (!loaderFailure && outcome[0] !== SKIPPED) loaderFailure = [task.index, outcome];
						}
					}),
				),
			);
		} catch (cause) {
			if (!Array.isArray(cause)) throw cause;
			control = cause;
		}
		signal?.throwIfAborted();
		if (control?.[1][0] === REDIRECTED) {
			abortMatches(lane.matches, 0, lane);
			return {
				type: 'redirect',
				redirect: control[1][1],
			};
		}
		let failure = lane.failure ?? loaderFailure;
		const plannedBoundary = lane.matches.findIndex((match) => match._notFound);
		let readinessEnd;
		if (failure) {
			const outcomeEnd = (failure[2] ??=
				failure[1][0] === NOT_FOUND ? await getNotFoundBoundary(router2, lane.matches, failure, signal) : failure[0]);
			for (const task of tasks) {
				if (task.index >= outcomeEnd) break;
				const outcome = await task.outcome;
				if (outcome[0] !== SUCCESS && outcome[0] < REDIRECTED && !('loaderData' in lane.matches[task.index])) {
					failure = [task.index, outcome];
					failure[2] = outcome[0] === NOT_FOUND ? await getNotFoundBoundary(router2, lane.matches, failure, signal) : task.index;
					break;
				}
			}
			readinessEnd = failure[2];
		} else readinessEnd = plannedBoundary < 0 ? lane.matches.length : plannedBoundary;
		const requiredFailure = await loadNormalChunks(router2, lane, readinessEnd, signal);
		signal?.throwIfAborted();
		if (requiredFailure) {
			if (requiredFailure[1][0] === REDIRECTED) {
				abortMatches(lane.matches);
				return {
					type: 'redirect',
					redirect: requiredFailure[1][1],
				};
			}
			failure = requiredFailure;
		}
		const terminal = await applyFailure(router2, lane, failure, signal);
		if (terminal.boundary !== void 0) {
			const match = lane.matches[terminal.boundary];
			if (match.ssr === true) {
				const route = getRoute(router2, match);
				try {
					if (terminal.kind === ERROR) await loadRouteChunk(route, 'errorComponent');
					else if (match._notFound) await Promise.all([loadRouteChunk(route), loadRouteChunk(route, 'notFoundComponent')]);
					else await loadRouteChunk(route, 'notFoundComponent');
				} catch {}
				signal?.throwIfAborted();
			}
		}
		signal?.throwIfAborted();
		await projectLane(
			router2,
			{
				location: lane.location,
				matches: lane.matches,
			},
			signal,
		);
		signal?.throwIfAborted();
		router2.serverSsr?.onCleanup(abortLane);
		return {
			type: 'render',
			status: terminal.status,
			matches: lane.matches,
		};
	} finally {
		signal?.removeEventListener('abort', abortLane);
	}
}
async function loadServerRoute(router2, opts) {
	router2.updateLatestLocation();
	const next = router2.latestLocation;
	const previous = router2._committed;
	const previousEnd = router2._lifecycleEnd;
	let result;
	try {
		const canonical = router2.buildLocation({
			to: next.pathname,
			search: true,
			params: true,
			hash: true,
			state: true,
			_includeValidateSearch: true,
		});
		if (next.publicHref !== canonical.publicHref) throw redirect({ href: canonical.publicHref || '/' });
		const changeInfo = getLocationChangeInfo(next, router2.stores.resolvedLocation.get());
		router2.emit({
			type: 'onBeforeNavigate',
			...changeInfo,
		});
		router2.emit({
			type: 'onBeforeLoad',
			...changeInfo,
		});
		opts?._signal?.throwIfAborted();
		result = await waitFor(executeServerLane(router2, next, router2.matchRoutes(next), opts?._signal), opts?._signal);
		opts?._signal?.throwIfAborted();
	} catch (cause) {
		opts?._signal?.throwIfAborted();
		if (!isRedirect(cause)) throw cause;
		cause.options._fromLocation = next;
		result = {
			type: 'redirect',
			redirect: router2.resolveRedirect(cause),
		};
	}
	router2._serverResult = result;
	let nextEnd = 0;
	router2.batch(() => {
		router2.stores.location.set(next);
		router2.stores.status.set('idle');
		if (result.type === 'render') {
			router2._committed = result.matches;
			nextEnd = router2._lifecycleEnd = lifecycleEnd(result.matches);
			router2.stores.setMatches(result.matches);
			router2.stores.resolvedLocation.set(next);
		}
	});
	if (result.type === 'render') runRouteLifecycle(router2, previous, result.matches, previousEnd, nextEnd);
	router2._commitPromise?.resolve();
	router2._commitPromise = void 0;
}
const isServer = true;
var BaseRoute = class {
	get to() {
		return this._to;
	}
	get id() {
		return this._id;
	}
	get path() {
		return this._path;
	}
	get fullPath() {
		return this._fullPath;
	}
	constructor(options) {
		this.init = (opts) => {
			this.originalIndex = opts.originalIndex;
			const options2 = this.options;
			const isRoot = !options2?.path && !options2?.id;
			this.parentRoute = this.options.getParentRoute?.();
			if (isRoot) this._path = rootRouteId;
			else if (!this.parentRoute) {
				invariant();
			}
			let path = isRoot ? rootRouteId : options2?.path;
			if (path && path !== '/') path = trimPathLeft(path);
			const customId = options2?.id || path;
			let id = isRoot ? rootRouteId : joinPaths([this.parentRoute.id === '__root__' ? '' : this.parentRoute.id, customId]);
			if (path === '__root__') path = '/';
			if (id !== '__root__') id = joinPaths(['/', id]);
			const fullPath = id === '__root__' ? '/' : joinPaths([this.parentRoute.fullPath, path]);
			this._path = path;
			this._id = id;
			this._fullPath = fullPath;
			this._to = trimPathRight(fullPath);
		};
		this.addChildren = (children) => {
			return this._addFileChildren(children);
		};
		this._addFileChildren = (children) => {
			if (Array.isArray(children)) this.children = children;
			if (typeof children === 'object' && children !== null) this.children = Object.values(children);
			return this;
		};
		this._addFileTypes = () => {
			return this;
		};
		this.updateLoader = (options2) => {
			Object.assign(this.options, options2);
			return this;
		};
		this.update = (options2) => {
			Object.assign(this.options, options2);
			return this;
		};
		this.lazy = (lazyFn) => {
			this.lazyFn = lazyFn;
			return this;
		};
		this.redirect = (opts) =>
			redirect({
				from: this.fullPath,
				...opts,
			});
		this.options = options || {};
		this.isRoot = !options?.getParentRoute;
		if (options?.id && options?.path) throw new Error(`Route cannot have both an 'id' and a 'path' option.`);
	}
};
var BaseRootRoute = class extends BaseRoute {
	constructor(options) {
		super(options);
	}
};
function useMatch(opts) {
	const router2 = useRouter();
	const nearestRouteId = reactExports.useContext(opts.from ? dummyMatchContext : matchContext);
	const routeId = opts.from ?? nearestRouteId;
	const matchStore = router2.stores.getMatchStore(routeId);
	{
		const match = matchStore.get();
		if (!match) {
			if (opts.shouldThrow ?? true) {
				invariant();
			}
			return;
		}
		return opts.select ? opts.select(match) : match;
	}
}
function useLoaderData(opts) {
	return useMatch({
		from: opts.from,
		strict: opts.strict,
		structuralSharing: opts.structuralSharing,
		select: (match) => {
			return opts.select ? opts.select(match.loaderData) : match.loaderData;
		},
	});
}
function useLoaderDeps(opts) {
	const { select, ...rest } = opts;
	return useMatch({
		...rest,
		select: (match) => {
			return select ? select(match.loaderDeps) : match.loaderDeps;
		},
	});
}
function useParams(opts) {
	return useMatch({
		from: opts.from,
		shouldThrow: opts.shouldThrow,
		structuralSharing: opts.structuralSharing,
		strict: opts.strict,
		select: (match) => {
			const params = opts.strict === false ? match.params : match._strictParams;
			return opts.select ? opts.select(params) : params;
		},
	});
}
function useSearch(opts) {
	return useMatch({
		from: opts.from,
		strict: opts.strict,
		shouldThrow: opts.shouldThrow,
		structuralSharing: opts.structuralSharing,
		select: (match) => {
			return opts.select ? opts.select(match.search) : match.search;
		},
	});
}
function useNavigate(_defaultOpts) {
	const router2 = useRouter();
	return reactExports.useCallback(
		(options) => {
			return router2.navigate({
				...options,
				from: options.from ?? _defaultOpts?.from,
			});
		},
		[_defaultOpts?.from, router2],
	);
}
function useRouteContext(opts) {
	return useMatch({
		...opts,
		select: (match) => (opts.select ? opts.select(match.context) : match.context),
	});
}
function resolveExternalLink(to, protocolAllowlist) {
	const scheme = typeof to === 'string' && getUrlScheme(to);
	if (!scheme) return;
	if (!protocolAllowlist.has(scheme)) {
		return null;
	}
	return to;
}
function useLinkProps(options, forwardedRef) {
	const router2 = useRouter();
	const innerRef = useForwardedRef(forwardedRef);
	const {
		activeProps,
		inactiveProps,
		activeOptions,
		to: toOption,
		preload: userPreload,
		preloadDelay: userPreloadDelay,
		preloadIntentProximity: _preloadIntentProximity,
		hashScrollIntoView,
		replace,
		startTransition,
		resetScroll,
		viewTransition,
		children,
		target,
		disabled,
		style,
		className,
		onClick,
		onBlur,
		onFocus,
		onMouseEnter,
		onMouseLeave,
		onTouchStart,
		ignoreBlocker,
		params: _params,
		search: _search,
		hash: _hash,
		state: _state,
		mask: _mask,
		reloadDocument: _reloadDocument,
		unsafeRelative: _unsafeRelative,
		from: _from,
		_fromLocation,
		...propsSafeToSpread
	} = options;
	const to = toOption;
	{
		const directExternalLink = resolveExternalLink(to, router2.protocolAllowlist);
		const next = directExternalLink === void 0 ? router2.buildLocation(options) : void 0;
		const hrefOption = next ? getHrefOption(next, router2, disabled) : (directExternalLink ?? void 0);
		const linkDisabled2 = disabled || !hrefOption;
		const externalLink2 = directExternalLink ?? (hrefOption && getUrlScheme(hrefOption) ? hrefOption : void 0);
		const isActive2 = (() => {
			if (!next || (!disabled && !hrefOption) || externalLink2) return false;
			const currentLocation = router2.stores.location.get();
			const exact = activeOptions?.exact ?? false;
			if (exact) {
				if (!exactPathTest(currentLocation.pathname, next.pathname, router2.basepath)) return false;
			} else {
				const currentPathSplit = removeTrailingSlash(currentLocation.pathname, router2.basepath);
				const nextPathSplit = removeTrailingSlash(next.pathname, router2.basepath);
				if (!(
					currentPathSplit.startsWith(nextPathSplit) &&
					(currentPathSplit.length === nextPathSplit.length || currentPathSplit[nextPathSplit.length] === '/')
				))
					return false;
			}
			if (activeOptions?.includeSearch ?? true) {
				if (currentLocation.search !== next.search) {
					const currentSearchEmpty =
						!currentLocation.search || (typeof currentLocation.search === 'object' && !hasKeys(currentLocation.search));
					const nextSearchEmpty = !next.search || (typeof next.search === 'object' && !hasKeys(next.search));
					if (!(currentSearchEmpty && nextSearchEmpty)) {
						if (
							!deepEqual(currentLocation.search, next.search, {
								partial: !exact,
								ignoreUndefined: !activeOptions?.explicitUndefined,
							})
						)
							return false;
					}
				}
			}
			if (activeOptions?.includeHash) return false;
			return true;
		})();
		if (externalLink2)
			return {
				...propsSafeToSpread,
				ref: innerRef,
				href: externalLink2,
				...(children && { children }),
				...(target && { target }),
				...(disabled && { disabled }),
				...(style && { style }),
				...(className && { className }),
			};
		const resolvedActiveProps = isActive2 ? (functionalUpdate(activeProps, {}) ?? STATIC_ACTIVE_OBJECT) : STATIC_EMPTY_OBJECT;
		const resolvedInactiveProps = isActive2 ? STATIC_EMPTY_OBJECT : (functionalUpdate(inactiveProps, {}) ?? STATIC_EMPTY_OBJECT);
		const resolvedStyle2 = (() => {
			const baseStyle = style;
			const activeStyle = resolvedActiveProps.style;
			const inactiveStyle = resolvedInactiveProps.style;
			if (!baseStyle && !activeStyle && !inactiveStyle) return;
			if (baseStyle && !activeStyle && !inactiveStyle) return baseStyle;
			if (!baseStyle && activeStyle && !inactiveStyle) return activeStyle;
			if (!baseStyle && !activeStyle && inactiveStyle) return inactiveStyle;
			return {
				...baseStyle,
				...activeStyle,
				...inactiveStyle,
			};
		})();
		const resolvedClassName2 = (() => {
			const baseClassName = className;
			const activeClassName = resolvedActiveProps.className;
			const inactiveClassName = resolvedInactiveProps.className;
			if (!baseClassName && !activeClassName && !inactiveClassName) return '';
			let out = '';
			if (baseClassName) out = baseClassName;
			if (activeClassName) out = out ? `${out} ${activeClassName}` : activeClassName;
			if (inactiveClassName) out = out ? `${out} ${inactiveClassName}` : inactiveClassName;
			return out;
		})();
		return {
			...propsSafeToSpread,
			...resolvedActiveProps,
			...resolvedInactiveProps,
			href: hrefOption,
			ref: innerRef,
			disabled: !!linkDisabled2,
			target,
			...(resolvedStyle2 && { style: resolvedStyle2 }),
			...(resolvedClassName2 && { className: resolvedClassName2 }),
			...(linkDisabled2 && STATIC_DISABLED_PROPS),
			...(isActive2 && STATIC_ACTIVE_PROPS),
		};
	}
}
var STATIC_EMPTY_OBJECT = {};
var STATIC_ACTIVE_OBJECT = { className: 'active' };
var STATIC_DISABLED_PROPS = {
	role: 'link',
	'aria-disabled': true,
};
var STATIC_ACTIVE_PROPS = {
	'data-status': 'active',
	'aria-current': 'page',
};
function getHrefOption(next, router2, disabled) {
	if (disabled) return;
	const location = next.maskedLocation ?? next;
	const href = location.external ? location.publicHref : router2.history.createHref(location.publicHref) || '/';
	if ((location.external || href !== location.publicHref) && isDangerousProtocol(href, router2.protocolAllowlist)) {
		return;
	}
	return href;
}
var Link = reactExports.forwardRef((props, ref) => {
	const { _asChild, ...rest } = props;
	let { type: _type, ...linkProps } = useLinkProps(rest, ref);
	const children = typeof rest.children === 'function' ? rest.children({ isActive: linkProps['data-status'] === 'active' }) : rest.children;
	if (!_asChild) {
		const { disabled: _, ...rest2 } = linkProps;
		linkProps = rest2;
	}
	return reactExports.createElement(_asChild || 'a', linkProps, children);
});
var Route$2 = class Route extends BaseRoute {
	/**
	 * @deprecated Use the `createRoute` function instead.
	 */
	constructor(options) {
		super(options);
		this.useMatch = (opts) => {
			return useMatch({
				...opts,
				from: this.id,
			});
		};
		this.useRouteContext = (opts) => {
			return useRouteContext({
				...opts,
				from: this.id,
			});
		};
		this.useSearch = (opts) => {
			return useSearch({
				...opts,
				from: this.id,
			});
		};
		this.useParams = (opts) => {
			return useParams({
				...opts,
				from: this.id,
			});
		};
		this.useLoaderDeps = (opts) => {
			return useLoaderDeps({
				...opts,
				from: this.id,
			});
		};
		this.useLoaderData = (opts) => {
			return useLoaderData({
				...opts,
				from: this.id,
			});
		};
		this.useNavigate = () => {
			return useNavigate({ from: this.fullPath });
		};
		this.Link = React.forwardRef((props, ref) => {
			return /* @__PURE__ */ jsxRuntimeExports.jsx(Link, {
				ref,
				from: this.fullPath,
				...props,
			});
		});
	}
};
function createRoute(options) {
	return new Route$2(options);
}
var RootRoute = class extends BaseRootRoute {
	/**
	 * @deprecated `RootRoute` is now an internal implementation detail. Use `createRootRoute()` instead.
	 */
	constructor(options) {
		super(options);
		this.useMatch = (opts) => {
			return useMatch({
				...opts,
				from: this.id,
			});
		};
		this.useRouteContext = (opts) => {
			return useRouteContext({
				...opts,
				from: this.id,
			});
		};
		this.useSearch = (opts) => {
			return useSearch({
				...opts,
				from: this.id,
			});
		};
		this.useParams = (opts) => {
			return useParams({
				...opts,
				from: this.id,
			});
		};
		this.useLoaderDeps = (opts) => {
			return useLoaderDeps({
				...opts,
				from: this.id,
			});
		};
		this.useLoaderData = (opts) => {
			return useLoaderData({
				...opts,
				from: this.id,
			});
		};
		this.useNavigate = () => {
			return useNavigate({ from: this.fullPath });
		};
		this.Link = React.forwardRef((props, ref) => {
			return /* @__PURE__ */ jsxRuntimeExports.jsx(Link, {
				ref,
				from: this.fullPath,
				...props,
			});
		});
	}
};
function createRootRoute(options) {
	return new RootRoute(options);
}
function createFileRoute(path) {
	return (options) => {
		const route = createRoute(options);
		route.isRoot = false;
		return route;
	};
}
function lazyRouteComponent(importer, exportName) {
	let loadPromise;
	let comp;
	let error;
	const load = () => {
		if (!loadPromise) {
			error = void 0;
			loadPromise = importer()
				.then((res) => {
					comp = res[exportName];
				})
				.catch((err) => {
					loadPromise = void 0;
					error = err;
				});
		}
		return loadPromise;
	};
	const lazyComp = function Lazy(props) {
		if (error) {
			if (isModuleNotFoundError(error) && false);
			throw error;
		}
		if (!comp)
			if (reactUse) reactUse(load());
			else throw load();
		return reactExports.createElement(comp, props);
	};
	lazyComp.preload = load;
	return lazyComp;
}
var getStoreFactory = (opts) => {
	return {
		createMutableStore: createNonReactiveMutableStore,
		createReadonlyStore: createNonReactiveReadonlyStore,
		batch: (fn) => fn(),
	};
};
var createRouter$1 = (options) => {
	return new Router(options);
};
var Router = class extends RouterCore {
	constructor(options) {
		super(options, getStoreFactory);
	}
};
var noopScriptHandler = () => {};
function setScriptAttrs(script, attrs) {
	if (!attrs) return;
	for (const [key, value] of Object.entries(attrs))
		if (key !== 'suppressHydrationWarning' && value !== void 0 && value !== false)
			script.setAttribute(key, typeof value === 'boolean' ? '' : String(value));
}
function Asset(asset) {
	const { attrs, children, nonce, preventScriptHoist } = asset;
	const innerHTML = reactExports.useMemo(() => (children === void 0 ? void 0 : { __html: children }), [children]);
	switch (asset.tag) {
		case 'title':
			return /* @__PURE__ */ jsxRuntimeExports.jsx('title', {
				...attrs,
				suppressHydrationWarning: true,
				children,
			});
		case 'meta':
			return /* @__PURE__ */ jsxRuntimeExports.jsx('meta', {
				...attrs,
				suppressHydrationWarning: true,
			});
		case 'link':
			return /* @__PURE__ */ jsxRuntimeExports.jsx('link', {
				...attrs,
				precedence: attrs?.precedence ?? (attrs?.rel === 'stylesheet' ? 'default' : void 0),
				nonce,
				suppressHydrationWarning: true,
			});
		case 'style':
			if (asset.inlineCss && false);
			return /* @__PURE__ */ jsxRuntimeExports.jsx('style', {
				...attrs,
				dangerouslySetInnerHTML: innerHTML,
				nonce,
			});
		case 'script':
			return /* @__PURE__ */ jsxRuntimeExports.jsx(Script, {
				attrs,
				preventScriptHoist,
				children,
			});
		default:
			return null;
	}
}
function Script({ attrs, children, preventScriptHoist }) {
	useRouter();
	useHydrated();
	const innerHTML = reactExports.useMemo(() => (children === void 0 ? void 0 : { __html: children }), [children]);
	const dataScript = typeof attrs?.type === 'string' && attrs.type !== '' && attrs.type !== 'text/javascript' && attrs.type !== 'module';
	reactExports.useEffect(() => {
		if (dataScript) return;
		if (attrs?.src) {
			const link = document.createElement('a');
			link.href = attrs.src;
			const normSrc = link.href;
			for (const el of document.scripts) if (el.src === normSrc) return;
			const script = document.createElement('script');
			setScriptAttrs(script, attrs);
			document.head.appendChild(script);
			return () => script.remove();
		}
		if (typeof children === 'string') {
			const typeAttr = typeof attrs?.type === 'string' ? attrs.type : 'text/javascript';
			const nonceAttr = typeof attrs?.nonce === 'string' ? attrs.nonce : void 0;
			for (const el of document.scripts) {
				if (el.hasAttribute('src')) continue;
				const sType = el.getAttribute('type') ?? 'text/javascript';
				const sNonce = el.getAttribute('nonce') ?? void 0;
				if (el.textContent === children && sType === typeAttr && sNonce === nonceAttr) return;
			}
			const script = document.createElement('script');
			script.textContent = children;
			setScriptAttrs(script, attrs);
			document.head.appendChild(script);
			return () => script.remove();
		}
	}, [attrs, children, dataScript]);
	{
		if (attrs?.src) {
			if (!preventScriptHoist)
				return /* @__PURE__ */ jsxRuntimeExports.jsx('script', {
					...attrs,
					suppressHydrationWarning: true,
				});
			return /* @__PURE__ */ jsxRuntimeExports.jsx('script', {
				...attrs,
				onLoad: noopScriptHandler,
				suppressHydrationWarning: true,
			});
		}
		if (typeof children === 'string')
			return /* @__PURE__ */ jsxRuntimeExports.jsx('script', {
				...attrs,
				dangerouslySetInnerHTML: innerHTML,
				suppressHydrationWarning: true,
			});
		return null;
	}
}
function buildTagsFromMatches(router2, nonce, matches, assetCrossOrigin) {
	matches = _getAssetMatches(matches);
	const routeMeta = matches.map((match) => match.meta).filter((meta) => meta !== void 0);
	const resultMeta = [];
	const metaByAttribute = {};
	let title;
	for (let i = routeMeta.length - 1; i >= 0; i--) {
		const metas = routeMeta[i];
		for (let j = metas.length - 1; j >= 0; j--) {
			const m = metas[j];
			if (!m) continue;
			if (m.title) {
				if (!title)
					title = {
						tag: 'title',
						children: m.title,
					};
			} else if ('script:ld+json' in m)
				try {
					const json = JSON.stringify(m['script:ld+json']);
					resultMeta.push({
						tag: 'script',
						attrs: { type: 'application/ld+json' },
						children: escapeHtml(json),
					});
				} catch {}
			else {
				const attribute = m.name ?? m.property;
				if (attribute)
					if (metaByAttribute[attribute]) continue;
					else metaByAttribute[attribute] = true;
				resultMeta.push({
					tag: 'meta',
					attrs: {
						...m,
						nonce,
					},
				});
			}
		}
	}
	if (title) resultMeta.push(title);
	if (nonce)
		resultMeta.push({
			tag: 'meta',
			attrs: {
				property: 'csp-nonce',
				content: nonce,
			},
		});
	resultMeta.reverse();
	const constructedLinks = matches
		.flatMap((match) => match.links ?? [])
		.filter((link) => link !== void 0)
		.map((link) => ({
			tag: 'link',
			attrs: {
				...link,
				nonce,
			},
		}));
	const manifest = router2.ssr?.manifest;
	const manifestCssTags = [];
	if (manifest) {
		matches.forEach((match) => {
			manifest.routes[match.routeId]?.css?.forEach((link) => {
				const resolvedLink = resolveManifestCssLink(link);
				manifestCssTags.push({
					tag: 'link',
					attrs: {
						rel: 'stylesheet',
						...resolvedLink,
						crossOrigin: getAssetCrossOrigin(assetCrossOrigin, 'stylesheet') ?? resolvedLink.crossOrigin,
						suppressHydrationWarning: true,
						nonce,
					},
				});
			});
		});
		if (manifest.inlineStyle)
			manifestCssTags.push({
				tag: 'style',
				attrs: {
					...manifest.inlineStyle.attrs,
					nonce,
				},
				children: manifest.inlineStyle.children,
				inlineCss: true,
			});
	}
	const preloadLinks = [];
	if (manifest)
		matches.forEach((match) => {
			manifest.routes[match.routeId]?.preloads?.forEach((preload) => {
				preloadLinks.push({
					tag: 'link',
					attrs: {
						...getScriptPreloadAttrs(manifest, preload, assetCrossOrigin),
						nonce,
					},
				});
			});
		});
	const styles = matches
		.flatMap((match) => match.styles ?? [])
		.filter((style) => style !== void 0)
		.map(({ children, ...attrs }) => ({
			tag: 'style',
			attrs: {
				...attrs,
				nonce,
			},
			children,
		}));
	const headScripts = matches
		.flatMap((match) => match.headScripts ?? [])
		.filter((script) => script !== void 0)
		.map(({ children, ...script }) => ({
			tag: 'script',
			attrs: {
				...script,
				nonce,
			},
			children,
		}));
	const tags = [];
	appendUniqueUserTags(tags, resultMeta);
	tags.push(...preloadLinks);
	appendUniqueUserTags(tags, constructedLinks);
	tags.push(...manifestCssTags);
	appendUniqueUserTags(tags, styles);
	appendUniqueUserTags(tags, headScripts);
	return tags;
}
var useTags = (assetCrossOrigin) => {
	const router2 = useRouter();
	const nonce = router2.options.ssr?.nonce;
	return buildTagsFromMatches(router2, nonce, router2.stores.matches.get(), assetCrossOrigin);
};
function HeadContent(props) {
	const tags = useTags(props.assetCrossOrigin);
	const nonce = useRouter().options.ssr?.nonce;
	return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, {
		children: tags.map((tag) =>
			/* @__PURE__ */ reactExports.createElement(Asset, {
				...tag,
				key: `tsr-meta-${JSON.stringify(tag)}`,
				nonce,
			}),
		),
	});
}
var Scripts = () => {
	const router2 = useRouter();
	const nonce = router2.options.ssr?.nonce;
	const getScripts = (matches) => {
		matches = _getAssetMatches(matches);
		const scripts = matches
			.flatMap((match) => match.scripts ?? [])
			.filter(Boolean)
			.map(({ children, ...script }) => ({
				tag: 'script',
				attrs: {
					...script,
					suppressHydrationWarning: true,
					nonce,
				},
				children,
			}));
		const manifest = router2.ssr?.manifest;
		if (!manifest) return scripts;
		for (const match of matches) {
			const manifestScripts = manifest.routes[match.routeId]?.scripts;
			if (!manifestScripts) continue;
			for (const asset of manifestScripts)
				scripts.push({
					tag: 'script',
					attrs: {
						...asset.attrs,
						nonce,
					},
					children: asset.children,
					...(typeof asset.attrs?.src === 'string' ? { preventScriptHoist: true } : {}),
				});
		}
		return scripts;
	};
	return renderScripts(router2, getScripts(router2.stores.matches.get()));
};
function renderScripts(router2, scripts) {
	if (router2.serverSsr) {
		const serverBufferedScript = router2.serverSsr.takeBufferedScripts();
		if (serverBufferedScript) scripts.unshift(serverBufferedScript);
	}
	return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, {
		children: scripts.map((asset, i) =>
			/* @__PURE__ */ reactExports.createElement(Asset, {
				...asset,
				key: `tsr-scripts-${asset.tag}-${i}`,
			}),
		),
	});
}
const Route$1 = createRootRoute({
	head: () => ({
		meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'my-web-2026' }],
	}),
	component: RootComponent,
});
function RootComponent() {
	return /* @__PURE__ */ jsxRuntimeExports.jsxs('html', {
		lang: 'ja',
		children: [
			/* @__PURE__ */ jsxRuntimeExports.jsx('head', { children: /* @__PURE__ */ jsxRuntimeExports.jsx(HeadContent, {}) }),
			/* @__PURE__ */ jsxRuntimeExports.jsxs('body', {
				children: [
					/* @__PURE__ */ jsxRuntimeExports.jsx(RootLayout, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Outlet, {}) }),
					/* @__PURE__ */ jsxRuntimeExports.jsx(Scripts, {}),
				],
			}),
		],
	});
}
function RootLayout({ children }) {
	return /* @__PURE__ */ jsxRuntimeExports.jsx('div', { id: 'app-root', 'data-app': 'my-web-2026', children });
}
var createSsrRpc = (functionId) => {
	const url = '/_serverFn/' + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true,
	});
};
const getInternalHealth = createServerFn({
	method: 'GET',
}).handler(createSsrRpc('969e5ba762fa794aeca952d5176978705ba970bb4eeb4fb3ca55cf5eb5d990c0'));
const $$splitComponentImporter = () => import('./index-CABD_Ar0.js');
const Route2 = createFileRoute()({
	loader: () => getInternalHealth(),
	component: lazyRouteComponent($$splitComponentImporter, 'component'),
});
const IndexRoute = Route2.update({
	id: '/',
	path: '/',
	getParentRoute: () => Route$1,
});
const rootRouteChildren = {
	IndexRoute,
};
const routeTree = Route$1._addFileChildren(rootRouteChildren)._addFileTypes();
function createRouter() {
	return createRouter$1({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		context: {},
	});
}
const router = /* @__PURE__ */ Object.freeze(
	/* @__PURE__ */ Object.defineProperty(
		{
			__proto__: null,
			createRouter,
		},
		Symbol.toStringTag,
		{ value: 'Module' },
	),
);
export { Route2 as R, router as r };
