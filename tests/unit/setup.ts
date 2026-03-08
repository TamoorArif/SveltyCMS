import { mock } from 'bun:test';

/**
 * AGGRESSIVE UNIT TEST SETUP - VERSION 6.0 (FINAL SHIELD)
 * Designed to survive CI (Linux) environment differences by locking down globals.
 */

// 1. ABSOLUTE ENVIRONMENT LOCKDOWN
const lockGlobal = (name: string, value: any) => {
	Object.defineProperty(globalThis, name, {
		value,
		writable: false,
		configurable: false,
		enumerable: true
	});
};

lockGlobal('browser', true);
lockGlobal('dev', true);
lockGlobal('building', false);

process.env.BROWSER = 'true';
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// 2. SVELTE 5 RUNES - High-Fidelity functional shims
const $state = Object.assign(
	(v: any) => {
		if (typeof v === 'object' && v !== null) {
			if (v instanceof Map || v instanceof Set) return v;
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
		return v;
	},
	{
		snapshot: (v: any) => JSON.parse(JSON.stringify(v))
	}
);

const $derived = Object.assign(
	(fn: any) => {
		const getter = typeof fn === 'function' ? fn : () => fn;
		return new Proxy(
			{},
			{
				get(_, prop) {
					const val = getter();
					if (prop === 'value') return val;
					if (prop === 'valueOf') return () => val;
					if (prop === 'toString') return () => String(val);
					// If the value is an object, allow access to its properties
					if (val !== null && typeof val === 'object') {
						const subVal = val[prop];
						return typeof subVal === 'function' ? subVal.bind(val) : subVal;
					}
					return undefined;
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
						if (prop === 'value') return val;
						if (prop === 'valueOf') return () => val;
						if (prop === 'toString') return () => String(val);
						// Handle nested property access like setupStore.passwordRequirements.match
						if (val !== null && typeof val === 'object') {
							const subVal = val[prop];
							return typeof subVal === 'function' ? subVal.bind(val) : subVal;
						}
						return undefined;
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
		}
	}
);

lockGlobal('$state', $state);
lockGlobal('$derived', $derived);
lockGlobal('$effect', $effect);
lockGlobal('$props', () => ({}));
lockGlobal('$bindable', (v: any) => v);
lockGlobal('$inspect', () => ({ with: () => {} }));

// 3. MODULE MOCKING (Hoisted by Bun)
mock.module('$app/environment', () => ({
	browser: true,
	dev: true,
	building: false,
	version: '1.0.0'
}));

mock.module('svelte/reactivity', () => ({
	SvelteMap: Map,
	SvelteSet: Set
}));

const svelteCommon = {
	untrack: (fn: any) => fn(),
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

mock.module('svelte', () => svelteCommon);
mock.module('svelte/server', () => svelteCommon);
mock.module('svelte/internal', () => ({
	noop: () => {},
	safe_not_equal: () => true,
	subscribe: () => () => {},
	run_all: () => {},
	is_function: (v: any) => typeof v === 'function'
}));

mock.module('$app/navigation', () => ({
	goto: mock(() => Promise.resolve()),
	invalidate: mock(() => Promise.resolve()),
	invalidateAll: mock(() => Promise.resolve()),
	afterNavigate: mock(() => {}),
	beforeNavigate: mock(() => {})
}));

mock.module('$app/forms', () => ({
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

mock.module('$app/paths', () => ({ base: '', assets: '' }));

mock.module('$app/state', () => ({
	page: {
		url: new URL('http://localhost')
	}
}));

mock.module('json-render-svelte', () => ({
	schema: { createCatalog: () => ({ components: {}, actions: {} }) },
	defineRegistry: () => ({ registry: {} })
}));

mock.module('sveltekit-rate-limiter/server', () => ({
	RateLimiter: class {
		check = mock(() => Promise.resolve({ success: true }));
		isLimited = mock(() => Promise.resolve(false));
		add = mock(() => {});
		clear = mock(() => {});
	}
}));

// 4. PERSISTENT BROWSER GLOBALS
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

lockGlobal('window', {
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
});

lockGlobal('document', {
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

lockGlobal('localStorage', localStorage);
lockGlobal('sessionStorage', sessionStorage);
lockGlobal('navigator', { userAgent: 'node' });
lockGlobal('requestAnimationFrame', (cb: any) => setTimeout(cb, 0));
lockGlobal('cancelAnimationFrame', (id: any) => clearTimeout(id));

// 5. APPLICATION SERVICE MOCKS
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
(globalThis as any).AppError = AppError;

const isAppError = (v: any): v is AppError => {
	if (!v || typeof v !== 'object') return false;
	return v instanceof AppError || v.name === 'AppError' || v.__isAppError === true;
};
(AppError.prototype as any).__isAppError = true;

const isHttpError = (v: any) => v !== null && typeof v === 'object' && typeof v.status === 'number';

const getErrorMessage = (error: any): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;

	// Handle SvelteKit HttpError structure manually
	if (typeof error === 'object' && error !== null && 'body' in error) {
		const body = (error as { body: { message?: string } }).body;
		if (body?.message) {
			return String(body.message);
		}
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
	if (isAppError(error)) {
		return error;
	}

	if (isHttpError(error)) {
		const bodyMsg = (error as any).body?.message;
		return new AppError(bodyMsg || message, error.status, `HTTP_${error.status}`, error);
	}

	const errorMsg = getErrorMessage(error);
	// Align with source implementation: preference given to extracted errorMsg
	const finalMessage = errorMsg || message;

	return new AppError(finalMessage, status, 'INTERNAL_ERROR', error);
};

// Mock the module itself to return our global AppError
mock.module('@src/utils/error-handling', () => ({
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
(globalThis as any).logger = mockLogger;
mock.module('@utils/logger', () => ({ logger: mockLogger, default: mockLogger }));
mock.module('@utils/logger.server', () => ({ logger: mockLogger, default: mockLogger }));

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
mock.module('@src/services/settings-service', () => settingsMock);

mock.module('@src/widgets/scanner', () => ({
	coreModules: {},
	customModules: {},
	allWidgetModules: {},
	getWidgetNameFromPath: (path: string) => path.split('/').at(-2) || null
}));

mock.module('@boxyhq/saml-jackson', () => ({
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

const configStateMock = {
	get privateEnv() {
		return (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' };
	},
	getPrivateEnv: () => (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' },
	setPrivateEnv: (env: any) => {
		(globalThis as any).privateEnv = env;
		(globalThis as any).__privateEnv = env;
	},
	loadPrivateConfig: () => Promise.resolve((globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' }),
	clearPrivateConfigCache: () => {},
	getDatabaseConfig: () => ({ type: 'mongodb', name: 'test_db', host: 'localhost' }),
	getDatabaseConnectionString: () => 'mongodb://localhost:27017/test_db'
};
mock.module('@src/databases/config-state', () => configStateMock);

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
(globalThis as any).metricsService = metricsMock;
mock.module('@src/services/metrics-service', () => ({ metricsService: metricsMock, default: metricsMock, cleanupMetrics: mock(() => {}) }));

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
(globalThis as any).cacheService = cacheMock;
mock.module('@src/databases/cache-service', () => ({
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
(globalThis as any).mockAuditLog = mockAuditLog;
(globalThis as any).mockDbAdapter = mockDbAdapter;

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
mock.module('@src/databases/db', () => dbMock);
mock.module('@databases/db', () => dbMock);
(globalThis as any).auth = dbMock.auth;

mock.module('@src/services/audit/audit-log-service', () => ({ auditLogService: mockAuditLog, default: mockAuditLog }));

const mockEventBus = {
	on: mock(() => {}),
	off: mock(() => {}),
	emit: mock(() => {}),
	once: mock(() => {}),
	removeAllListeners: mock(() => {})
};
(globalThis as any).mockEventBus = mockEventBus;
mock.module('@src/services/automation/event-bus', () => ({ eventBus: mockEventBus, default: mockEventBus }));

let isSetupCompleteValue = true;
const mockSetupCheck = {
	isSetupComplete: mock(() => isSetupCompleteValue),
	isSetupCompleteAsync: mock(async () => isSetupCompleteValue),
	invalidateSetupCache: mock(() => {}),
	setSetupComplete: mock((val: boolean) => {
		isSetupCompleteValue = val;
	})
};
mock.module('@utils/setup-check', () => mockSetupCheck);
(globalThis as any).mockSetupCheck = mockSetupCheck;

// Final Global Shims
(globalThis as any).importMetaGlobMock = () => ({});

console.log('✅ Fresh Master Test Setup Loaded - Version 6.0');
console.log('Diagnostic - browser:', (globalThis as any).browser);
