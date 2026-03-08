import { mock } from 'bun:test';

/**
 * AGGRESSIVE UNIT TEST SETUP
 * Optimized for Svelte 5 + Bun + CI (Linux)
 * Version: 3.0 (Absolute Persistence)
 */

// 1. ABSOLUTE ENVIRONMENT ENFORCEMENT
// We must set these before ANY application code is imported.
(globalThis as any).browser = true;
(globalThis as any).dev = true;
(globalThis as any).building = false;

process.env.BROWSER = 'true';
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// 2. SVELTE 5 RUNES - High-fidelity functional mocks
const stateMock = (v: any) => {
	if (typeof v === 'object' && v !== null) {
		if (v instanceof Map || v instanceof Set) return v;
		if (Array.isArray(v)) {
			return new Proxy(v, {
				get(target, prop) {
					const val = target[prop as any];
					if (typeof val === 'function') return val.bind(target);
					return val;
				},
				set(target, prop, value) {
					target[prop as any] = value;
					return true;
				}
			});
		}
		return new Proxy(v, {
			get(target, prop) {
				const val = target[prop];
				if (typeof val === 'function') return val.bind(target);
				return val;
			},
			set(target, prop, value) {
				target[prop] = value;
				return true;
			}
		});
	}
	return v;
};

(globalThis as any).$state = stateMock;
(globalThis as any).$state.snapshot = (v: any) => v;

// $derived mock that supports both being called as a function AND property access
const derivedMock = (fn: any) => {
	const getter = typeof fn === 'function' ? fn : () => fn;
	return {
		get value() {
			return getter();
		},
		// Standard JS toString/valueOf to help with some comparisons
		toString: () => String(getter()),
		valueOf: () => getter()
	};
};

(globalThis as any).$derived = derivedMock;
(globalThis as any).$derived.by = derivedMock;

(globalThis as any).$effect = (fn: any) => {
	if (typeof fn === 'function') fn();
};
(globalThis as any).$effect.root = (fn: any) => {
	if (typeof fn === 'function') fn();
	return () => {};
};

(globalThis as any).$props = () => ({});
(globalThis as any).$bindable = (v: any) => v;
(globalThis as any).$inspect = () => ({ with: () => {} });

// 3. CORE MODULE MOCKS
// Lock down the environment module so it never returns false
const env = { browser: true, dev: true, building: false, version: '1.0.0' };
mock.module('$app/environment', () => env);

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

mock.module('svelte', () => ({
	untrack: (fn: any) => fn(),
	onMount: (fn: any) => fn?.(),
	onDestroy: (fn: any) => fn?.(),
	beforeUpdate: (fn: any) => fn?.(),
	afterUpdate: (fn: any) => fn?.(),
	tick: () => Promise.resolve(),
	getAllContexts: () => new Map(),
	getContext: () => undefined,
	setContext: (_k: any, v: any) => v,
	hasContext: () => false,
	createContext: () => ({})
}));

mock.module('svelte/internal', () => ({
	noop: () => {},
	safe_not_equal: () => true,
	subscribe: () => () => {},
	run_all: () => {},
	is_function: (v: any) => typeof v === 'function'
}));

// FORCE Svelte reactivity to use native collections for 100% reliable test state
mock.module('svelte/reactivity', () => ({
	SvelteMap: Map,
	SvelteSet: Set
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

// Create a robust window/document mock that persists across the test runner
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

// Force assign to globalThis using property descriptors to prevent overrides
Object.defineProperty(globalThis, 'window', { value: windowMock, writable: true, configurable: true });
Object.defineProperty(globalThis, 'document', {
	value: {
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
	},
	writable: true,
	configurable: true
});

Object.defineProperty(globalThis, 'localStorage', { value: localStorage, writable: true, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorage, writable: true, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, writable: true, configurable: true });
Object.defineProperty(globalThis, 'requestAnimationFrame', { value: (cb: any) => setTimeout(cb, 0), writable: true, configurable: true });
Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: (id: any) => clearTimeout(id), writable: true, configurable: true });

// 5. APPLICATION LOGIC MOCKS
class AppErrorStub extends Error {
	status: number;
	code: string;
	details: any;
	constructor(message: string, status = 500, code: string | any = 'INTERNAL_ERROR', details?: any) {
		super(message);
		this.status = status;
		if (typeof code === 'string') {
			this.code = code;
			this.details = details;
		} else {
			this.code = 'INTERNAL_ERROR';
			this.details = code;
		}
	}
}
(globalThis as any).AppError = AppErrorStub;
import('../../src/utils/error-handling')
	.then((mod) => {
		(globalThis as any).AppError = mod.AppError;
	})
	.catch(() => {});

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
		return { DB_TYPE: 'mongodb', MULTI_TENANT: false, FIREWALL_ENABLED: true }[key];
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
			oauthController: { authorize: mock(() => Promise.resolve({ redirect_url: 'sso' })) },
			connectionAPIController: { createSAMLConnection: mock(() => Promise.resolve({ id: 'conn_123' })) }
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
	getPrivateEnv: () => (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' },
	setPrivateEnv: (env: any) => {
		(globalThis as any).privateEnv = env;
	},
	loadPrivateConfig: () => Promise.resolve((globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' }),
	clearPrivateConfigCache: () => {},
	initializeOnRequest: () => Promise.resolve(),
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
	setSetupComplete: (val: boolean) => {
		isSetupCompleteValue = val;
	}
};
mock.module('@utils/setup-check', () => mockSetupCheck);
(globalThis as any).mockSetupCheck = mockSetupCheck;

console.log('✅ Fresh Master Test Setup Loaded');
console.log('Diagnostic - browser:', (globalThis as any).browser);
