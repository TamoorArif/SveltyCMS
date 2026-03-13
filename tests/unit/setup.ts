// 0. GLOBALS HELPER
const setGlobal = (name: string, value: any) => {
	Object.defineProperty(globalThis, name, {
		value,
		writable: true,
		configurable: true,
		enumerable: true
	});
};

// detect environment
const isBun = typeof Bun !== 'undefined';

/**
 * MASTER UNIT TEST SETUP - VERSION 8.1 (AGNOSTIC RUNES)
 * Supports both Bun Test and Vitest.
 */

// 1. MODULE MOCKING (Hoisted by Bun and Vitest)
let mock: any;
let vitest: any;

if (isBun) {
	// Bun environment
	const bunTest = await import(/* @vite-ignore */ 'bun' + ':test');
	mock = bunTest.mock;
	if (!globalThis.mock) setGlobal('mock', bunTest.mock);
	if (!globalThis.spyOn) setGlobal('spyOn', bunTest.spyOn);
	if (!globalThis.vi) setGlobal('vi', { fn: bunTest.mock, spyOn: bunTest.spyOn });
	if (!globalThis.describe) setGlobal('describe', bunTest.describe);
	if (!globalThis.test) setGlobal('test', bunTest.test);
	if (!globalThis.it) setGlobal('it', bunTest.it);
	if (!globalThis.expect) setGlobal('expect', bunTest.expect);
	if (!globalThis.beforeEach) setGlobal('beforeEach', bunTest.beforeEach);
	if (!globalThis.afterEach) setGlobal('afterEach', bunTest.afterEach);
	if (!globalThis.beforeAll) setGlobal('beforeAll', bunTest.beforeAll);
	if (!globalThis.afterAll) setGlobal('afterAll', bunTest.afterAll);
} else {
	// Node/Vitest environment - Vitest handles globals via config
	const vitestModule = await import('vitest');
	vitest = vitestModule;
	mock = vitestModule.vi.fn;
	if (!globalThis.mock) setGlobal('mock', vitestModule.vi.fn);
}

const mockLogger = {
	fatal: mock(() => {}),
	error: mock(() => {}),
	warn: mock(() => {}),
	info: mock(() => {}),
	debug: mock(() => {}),
	trace: mock(() => {}),
	channel: mock(() => mockLogger),
	dump: mock(() => {})
};

// Helper for cross-runner module mocking
const moduleMock = (path: string, factory: () => any) => {
	if (isBun) {
		mock.module(path, factory);
	} else if (vitest?.vi) {
		vitest.vi.mock(path, factory);
	}
};

moduleMock('@utils/logger', () => ({ logger: mockLogger, default: mockLogger }));
moduleMock('@utils/logger.server', () => ({ logger: mockLogger, default: mockLogger }));

moduleMock('$app/environment', () => ({
	browser: true,
	dev: true,
	building: false,
	version: '1.0.0'
}));

moduleMock('svelte/reactivity', () => ({
	SvelteMap: Map,
	SvelteSet: Set
}));

moduleMock('$app/navigation', () => ({
	goto: mock(() => Promise.resolve()),
	invalidate: mock(() => Promise.resolve()),
	invalidateAll: mock(() => Promise.resolve()),
	afterNavigate: mock(() => {}),
	beforeNavigate: mock(() => {})
}));

moduleMock('$app/forms', () => ({
	applyAction: mock(() => Promise.resolve()),
	enhance: mock(() => {}),
	deserialize: mock((v: any) => {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	})
}));

moduleMock('$app/paths', () => ({ base: '', assets: '' }));

moduleMock('$app/state', () => ({
	page: {
		url: new URL('http://localhost')
	}
}));

moduleMock('sveltekit-rate-limiter/server', () => ({
	RateLimiter: class {
		check = mock(() => Promise.resolve({ success: true }));
		isLimited = mock(() => Promise.resolve(false));
		add = mock(() => {});
		clear = mock(() => {});
	}
}));

// 2. ENVIRONMENT GLOBALS
setGlobal('browser', true);
setGlobal('dev', true);
setGlobal('building', false);
setGlobal('logger', mockLogger);

process.env.BROWSER = 'true';
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// 3. SVELTE 5 RUNES
// For unit tests without a compiler, $state should be transparent for primitives
// to avoid Proxy-to-boolean identity check failures (e.g. expect(val).toBe(true)).
const $state = Object.assign(
	(v: any) => {
		// Only use Proxy for objects/arrays to allow deep reactivity simulation
		if (typeof v === 'object' && v !== null) {
			if (v instanceof Map || v instanceof Set || v instanceof Date || v instanceof RegExp) {
				return v;
			}
			return new Proxy(v, {
				get(target, prop) {
					const val = target[prop];
					return typeof val === 'function' ? val.bind(target) : val;
				},
				set(target, prop, value) {
					target[prop] = value;
					return true;
				}
			});
		}
		// Return primitives directly
		return v;
	},
	{
		snapshot: (v: any) => {
			if (typeof v !== 'object' || v === null) return v;
			try {
				return JSON.parse(JSON.stringify(v));
			} catch {
				return v;
			}
		}
	}
);

// $derived should also be transparent if possible, or a reactive-like object
const $derived = Object.assign(
	(fn: any) => {
		const getter = typeof fn === 'function' ? fn : () => fn;
		// In tests without a compiler, a class property assigned $derived(fn)
		// will be set once. To support dynamic updates, we'd need a real getter.
		// For now, we return a Proxy that traps common coercion.
		return new Proxy(
			{},
			{
				get(_, prop) {
					const val = getter();
					if (prop === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? String(val) : val);
					if (prop === 'valueOf') return () => val;
					if (prop === 'toString') return () => String(val);
					if (val !== null && typeof val === 'object') {
						const subVal = val[prop];
						return typeof subVal === 'function' ? subVal.bind(val) : subVal;
					}
					return val;
				}
			}
		);
	},
	{
		by: (fn: any) => {
			const getter = typeof fn === 'function' ? fn : () => fn;
			return new Proxy(
				{},
				{
					get(_, prop) {
						const val = getter();
						if (prop === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? String(val) : val);
						if (prop === 'valueOf') return () => val;
						if (prop === 'toString') return () => String(val);
						if (val !== null && typeof val === 'object') {
							const subVal = val[prop];
							return typeof subVal === 'function' ? subVal.bind(val) : subVal;
						}
						return val;
					}
				}
			);
		}
	}
);

const $effect = Object.assign(
	(fn: any) => {
		if (typeof fn === 'function') fn();
	},
	{
		root: (fn: any) => {
			if (typeof fn === 'function') fn();
			return () => {};
		},
		pre: (fn: any) => {
			if (typeof fn === 'function') fn();
		}
	}
);

setGlobal('$state', $state);
setGlobal('$derived', $derived);
setGlobal('$effect', $effect);
setGlobal('$props', () => ({}));
setGlobal('$bindable', (v: any) => v);
setGlobal('$inspect', () => ({ with: () => {} }));

// 4. SVELTE COMMON MODULES
const svelteCommon = {
	untrack: mock((fn: any) => fn()),
	onMount: (fn: any) => fn?.(),
	onDestroy: (fn: any) => fn?.(),
	beforeUpdate: (fn: any) => fn?.(),
	afterUpdate: (fn: any) => fn?.(),
	tick: () => Promise.resolve(),
	getAllContexts: () => new Map(),
	getContext: () => undefined,
	setContext: (_unused: any, v: any) => v,
	hasContext: () => false,
	createContext: () => [() => ({}), (v: any) => v]
};

moduleMock('svelte', () => svelteCommon);
moduleMock('svelte/server', () => svelteCommon);
moduleMock('svelte/internal', () => ({
	noop: () => {},
	safe_not_equal: () => true,
	subscribe: () => () => {},
	run_all: () => {},
	is_function: (v: any) => typeof v === 'function'
}));

// 5. STORAGE MOCK
class StorageMock implements Storage {
	private store: Record<string, string> = {};
	get length() {
		return Object.keys(this.store).length;
	}
	clear() {
		this.store = {};
	}
	getItem(key: string) {
		return this.store[key] || null;
	}
	key(index: number) {
		return Object.keys(this.store)[index] || null;
	}
	removeItem(key: string) {
		delete this.store[key];
	}
	setItem(key: string, value: string) {
		this.store[key] = String(value);
	}
}

const localStorage = new StorageMock();
const sessionStorage = new StorageMock();

setGlobal('localStorage', localStorage);
setGlobal('sessionStorage', sessionStorage);

// 6. WINDOW & DOCUMENT
const windowMock = {
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	innerWidth: 1024,
	innerHeight: 768,
	location: new URL('http://localhost'),
	matchMedia: mock((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: mock(() => {}),
		removeListener: mock(() => {}),
		addEventListener: mock(() => {}),
		removeEventListener: mock(() => {}),
		dispatchEvent: mock(() => true)
	})),
	localStorage,
	sessionStorage,
	crypto: { randomUUID: () => crypto.randomUUID() },
	fetch: mock(() => Promise.resolve(new Response('{}'))),
	requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
	cancelAnimationFrame: (id: any) => clearTimeout(id),
	addEventListener: mock(() => {}),
	removeEventListener: mock(() => {})
};

setGlobal('window', windowMock);
setGlobal('document', {
	cookie: '',
	addEventListener: mock(() => {}),
	removeEventListener: mock(() => {}),
	dispatchEvent: mock(() => true),
	createElement: mock(() => ({
		style: {},
		appendChild: mock(() => {}),
		setAttribute: mock(() => {}),
		classList: {
			add: mock(() => {}),
			remove: mock(() => {}),
			contains: mock(() => false),
			toggle: mock(() => false)
		}
	}))
});
setGlobal('navigator', { userAgent: 'node' });
setGlobal('requestAnimationFrame', (cb: any) => setTimeout(cb, 0));
setGlobal('cancelAnimationFrame', (id: any) => clearTimeout(id));

// 7. APPLICATION SERVICE MOCKS
class AppError extends Error {
	status: number;
	code: string;
	details: any;
	originalError: any;
	constructor(message: string, status = 500, code: string | any = 'INTERNAL_ERROR', details?: any) {
		super(message);
		this.status = status;
		this.name = 'AppError';
		if (typeof code === 'string') {
			this.code = code;
			if (details instanceof Error) {
				this.originalError = details;
			}
			this.details = details;
		} else {
			this.code = 'INTERNAL_ERROR';
			this.originalError = code;
			this.details = details;
		}
	}
}
setGlobal('AppError', AppError);

const isAppError = (v: any): v is AppError => {
	if (!v || typeof v !== 'object') return false;
	return v instanceof AppError || v.name === 'AppError' || v.__isAppError === true;
};
(AppError.prototype as any).__isAppError = true;

const isHttpError = (v: any) => v !== null && typeof v === 'object' && typeof v.status === 'number';

const getErrorMessage = (error: any): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (typeof error === 'object' && error !== null && 'body' in error) {
		const body = (error as { body: { message?: string } }).body;
		if (body?.message) return String(body.message);
	}
	if (typeof error === 'object' && error !== null) {
		if ('message' in error) return String((error as any).message);
		try {
			const str = JSON.stringify(error);
			return str === '{}' ? '[object Object]' : str;
		} catch {
			return '[object Object]';
		}
	}
	return String(error);
};

const wrapError = (error: any, message = 'An unexpected error occurred', status = 500) => {
	if (isAppError(error)) return error;
	if (isHttpError(error)) {
		const bodyMsg = (error as any).body?.message;
		return new AppError(bodyMsg || message, error.status, `HTTP_${error.status}`, error);
	}
	const errorMsg = getErrorMessage(error);
	const finalMessage = errorMsg || message;
	return new AppError(finalMessage, status, 'INTERNAL_ERROR', error);
};

moduleMock('@src/utils/error-handling', () => ({
	AppError,
	isAppError,
	isHttpError,
	getErrorMessage,
	wrapError,
	handleApiError: mock((err: any) => {
		const status = err?.status || (isHttpError(err) ? (err as any).status : 500);
		return new Response(
			JSON.stringify({
				success: false,
				message: getErrorMessage(err),
				code: err?.code || (isHttpError(err) ? `HTTP_${err.status}` : 'INTERNAL_ERROR')
			}),
			{
				status,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	})
}));

const metricsMock = {
	incrementRequests: mock(() => {}),
	incrementErrors: mock(() => {}),
	recordResponseTime: mock(() => {}),
	incrementAuthValidations: mock(() => {}),
	incrementAuthFailures: mock(() => {}),
	recordAuthCacheHit: mock(() => {}),
	recordAuthCacheMiss: mock(() => {}),
	incrementApiRequests: mock(() => {}),
	incrementApiErrors: mock(() => {}),
	recordApiCacheHit: mock(() => {}),
	recordApiCacheMiss: mock(() => {}),
	incrementRateLimitViolations: mock(() => {}),
	incrementCSPViolations: mock(() => {}),
	incrementSecurityViolations: mock(() => {}),
	recordHookExecutionTime: mock(() => {}),
	getReport: mock(() => ({})),
	reset: mock(() => {}),
	exportPrometheus: mock(() => ''),
	destroy: mock(() => {})
};
setGlobal('metricsService', metricsMock);
moduleMock('@src/services/metrics-service', () => ({ metricsService: metricsMock, default: metricsMock, cleanupMetrics: mock(() => {}) }));

const cacheMock = {
	get: mock(async () => null),
	set: mock(async () => {}),
	setWithCategory: mock(async () => {}),
	delete: mock(async () => {}),
	clearByTags: mock(async () => {}),
	clearByPattern: mock(async () => {}),
	initialize: mock(async () => {}),
	invalidateAll: mock(async () => {}),
	getInstance: () => cacheMock
};
setGlobal('cacheService', cacheMock);
moduleMock('@src/databases/cache-service', () => ({
	cacheService: cacheMock,
	default: cacheMock,
	CacheCategory: { SESSION: 'session', USER: 'user', API: 'api' },
	SESSION_CACHE_TTL_MS: 1,
	USER_PERM_CACHE_TTL_MS: 1,
	USER_COUNT_CACHE_TTL_MS: 1,
	API_CACHE_TTL_MS: 1,
	SESSION_CACHE_TTL_S: 1,
	USER_PERM_CACHE_TTL_S: 1,
	USER_COUNT_CACHE_TTL_S: 1,
	API_CACHE_TTL_S: 1,
	REDIS_TTL_S: 1
}));

const settingsMock = {
	getPrivateSettingSync: mock((key: string) => {
		const env = (globalThis as any).privateEnv || (globalThis as any).__privateEnv;
		if (env && key in env) return env[key];
		return { DB_TYPE: 'mongodb', MULTI_TENANT: false, FIREWALL_ENABLED: true, USE_REDIS: false }[key];
	}),
	getPublicSettingSync: mock((key: string) => (key === 'SITE_NAME' ? 'SveltyCMS Test' : undefined)),
	getPrivateSetting: mock(async (key: string) => {
		const env = (globalThis as any).privateEnv || (globalThis as any).__privateEnv;
		if (env && key in env) return env[key];
		return 'mongodb';
	}),
	getPublicSetting: mock(async (_key: string) => 'test'),
	loadSettingsCache: mock(async () => ({ loaded: true, private: {}, public: {} })),
	setSettingsCache: mock(async () => {}),
	invalidateSettingsCache: mock(async () => {}),
	isCacheLoaded: mock(() => true),
	getAllSettings: mock(async () => ({ public: {}, private: {} })),
	getUntypedSetting: mock(async () => undefined)
};
moduleMock('@src/services/settings-service', () => settingsMock);

const mockAuditLog = { log: mock(() => Promise.resolve()), getLogs: mock(() => Promise.resolve([])) };
const mockDbAdapter = {
	auth: {
		getUserById: mock((id: string) => Promise.resolve({ success: true, data: { _id: id } })),
		updateUserAttributes: mock(() => Promise.resolve({ success: true })),
		getAllUsers: mock(() => Promise.resolve({ success: true, data: [] })),
		getUserCount: mock(() => Promise.resolve((globalThis as any).__mockUserCount ?? 10)),
		getAllRoles: mock(() => Promise.resolve((globalThis as any).__mockRoles ?? [{ _id: 'admin', isAdmin: true, name: 'Admin' }])),
		ensureAuth: mock(() => Promise.resolve())
	},
	system: {
		preferences: {
			get: mock(() => Promise.resolve({ success: true, data: [] })),
			set: mock(() => Promise.resolve({ success: true })),
			getMany: mock(() => Promise.resolve({ success: true, data: {} }))
		}
	},
	crud: { update: mock(() => Promise.resolve({ success: true })) }
};
setGlobal('mockAuditLog', mockAuditLog);
setGlobal('mockDbAdapter', mockDbAdapter);

const dbMock = {
	dbAdapter: mockDbAdapter,
	auth: mockDbAdapter.auth,
	getDb: () => mockDbAdapter,
	getAuth: () => mockDbAdapter.auth,
	getPrivateEnv: mock(() => (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' }),
	setPrivateEnv: mock((env: any) => {
		(globalThis as any).privateEnv = env;
	}),
	loadPrivateConfig: mock(() => Promise.resolve((globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' })),
	clearPrivateConfigCache: mock(() => {}),
	initializeOnRequest: mock(() => Promise.resolve()),
	dbInitPromise: Promise.resolve()
};
moduleMock('@src/databases/db', () => dbMock);
moduleMock('@databases/db', () => dbMock);
setGlobal('auth', dbMock.auth);

moduleMock('@src/services/audit/audit-log-service', () => ({ auditLogService: mockAuditLog, default: mockAuditLog }));

const mockEventBus = {
	on: mock(() => {}),
	off: mock(() => {}),
	emit: mock(() => {}),
	once: mock(() => {}),
	removeAllListeners: mock(() => {})
};
setGlobal('mockEventBus', mockEventBus);
moduleMock('@src/services/automation/event-bus', () => ({ eventBus: mockEventBus, default: mockEventBus }));

let isSetupCompleteValue = true;
const mockSetupCheck = {
	isSetupComplete: mock(() => isSetupCompleteValue),
	isSetupCompleteAsync: mock(async () => isSetupCompleteValue),
	invalidateSetupCache: mock(() => {}),
	setSetupComplete: mock((val: boolean) => {
		isSetupCompleteValue = val;
	})
};
moduleMock('@utils/setup-check', () => mockSetupCheck);
setGlobal('mockSetupCheck', mockSetupCheck);

moduleMock('@src/widgets/scanner', () => ({
	coreModules: {},
	customModules: {},
	allWidgetModules: {},
	getWidgetNameFromPath: (path: string) => path.split('/').at(-2) || null
}));

moduleMock('@boxyhq/saml-jackson', () => ({
	default: mock(() =>
		Promise.resolve({
			oauthController: {
				authorize: mock(() => Promise.resolve({ redirect_url: 'https://idp.example.com/sso' }))
			},
			connectionAPIController: {
				createSAMLConnection: mock(() => Promise.resolve({ id: 'conn_123' }))
			}
		})
	)
}));

console.log('✅ Master Test Setup Loaded - Version 8.1 (AGNOSTIC RUNES)');
console.log('Diagnostic - browser:', (globalThis as any).browser);

export {};
