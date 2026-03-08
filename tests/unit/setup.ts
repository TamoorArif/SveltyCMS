import { mock } from 'bun:test';

// 1. Svelte 5 Rune Mocks
(globalThis as any).$state = (v: any) => v;
(globalThis as any).$state.snapshot = (v: any) => v;
const derivedMock = (fn: any) => (typeof fn === 'function' ? fn() : fn);
(globalThis as any).$derived = derivedMock;
(globalThis as any).$derived.by = derivedMock;
(globalThis as any).$effect = (fn: any) => { if (typeof fn === 'function') fn(); };
(globalThis as any).$effect.root = (fn: any) => { if (typeof fn === 'function') fn(); return () => {}; };
(globalThis as any).$props = () => ({});
(globalThis as any).$bindable = (v: any) => v;
(globalThis as any).$inspect = () => ({ with: () => {} });

// 2. Module Mocks
mock.module('$app/environment', () => ({ browser: true, dev: true, building: false, version: '1.0.0' }));
mock.module('$app/navigation', () => ({
	goto: mock(() => Promise.resolve()), invalidate: mock(() => Promise.resolve()),
	invalidateAll: mock(() => Promise.resolve()), afterNavigate: mock(() => {}), beforeNavigate: mock(() => {})
}));
mock.module('$app/forms', () => ({
	applyAction: mock(() => Promise.resolve()), enhance: mock(() => {}),
	deserialize: mock((v: any) => { try { return JSON.parse(v); } catch { return v; } })
}));
mock.module('$app/paths', () => ({ base: '', assets: '' }));
mock.module('svelte/reactivity', () => ({ SvelteMap: class extends Map {}, SvelteSet: class extends Set {} }));
mock.module('sveltekit-rate-limiter/server', () => ({
    RateLimiter: class {
        check = mock(() => Promise.resolve({ success: true }));
        isLimited = mock(() => Promise.resolve(false));
        add = mock(() => {}); clear = mock(() => {});
    }
}));

// 3. Browser Globals
class StorageMock implements Storage {
	private store: Record<string, string> = {};
	get length() { return Object.keys(this.store).length; }
	clear() { this.store = {}; }
	getItem(key: string) { return this.store[key] || null; }
	key(index: number) { return Object.keys(this.store)[index] || null; }
	removeItem(key: string) { delete this.store[key]; }
	setItem(key: string, value: string) { this.store[key] = String(value); }
}

if (typeof window === 'undefined') {
	const localStorage = new StorageMock();
	const sessionStorage = new StorageMock();
	(globalThis as any).window = {
		setTimeout, clearTimeout, setInterval, clearInterval,
		addEventListener: mock(() => {}), removeEventListener: mock(() => {}),
		location: new URL('http://localhost'),
		matchMedia: mock((query: string) => ({
			matches: false, media: query, onchange: null, addListener: mock(() => {}),
			removeListener: mock(() => {}), addEventListener: mock(() => {}),
			removeEventListener: mock(() => {}), dispatchEvent: mock(() => true)
		})),
		localStorage, sessionStorage,
		crypto: { randomUUID: () => crypto.randomUUID() },
		fetch: mock(() => Promise.resolve(new Response('{}')))
	};
	(globalThis as any).document = {
		cookie: '', addEventListener: mock(() => {}), removeEventListener: mock(() => {}),
		dispatchEvent: mock(() => true),
		createElement: mock(() => ({ 
			style: {}, appendChild: mock(() => {}), setAttribute: mock(() => {}),
			classList: { add: mock(() => {}), remove: mock(() => {}), contains: mock(() => false), toggle: mock(() => false) }
		}))
	};
	(globalThis as any).localStorage = localStorage;
	(globalThis as any).sessionStorage = sessionStorage;
}

// 4. AppError injection
class AppErrorStub extends Error {
	status: number; code: string; details: any;
	constructor(message: string, status = 500, code: string | any = 'INTERNAL_ERROR', details?: any) {
		super(message);
		this.status = status;
		if (typeof code === 'string') { this.code = code; this.details = details; } 
		else { this.code = 'INTERNAL_ERROR'; this.details = code; }
	}
}
(globalThis as any).AppError = AppErrorStub;
import('../../src/utils/error-handling').then(mod => { (globalThis as any).AppError = mod.AppError; }).catch(() => {});

// 5. Logger Mock
const mockLogger = {
	fatal: mock(() => {}), error: mock(() => {}), warn: mock(() => {}),
	info: mock(() => {}), debug: mock(() => {}), trace: mock(() => {}),
	channel: mock(() => mockLogger), dump: mock(() => {})
};
(globalThis as any).logger = mockLogger;
mock.module('@utils/logger', () => ({ logger: mockLogger, default: mockLogger }));
mock.module('@utils/logger.server', () => ({ logger: mockLogger, default: mockLogger }));

// 6. Settings Service Mock
const settingsMock = {
	getPrivateSettingSync: mock((key: string) => {
		const env = (globalThis as any).privateEnv || (globalThis as any).__privateEnv;
		if (env && key in env) return env[key];
		const fallbacks: any = {
			DB_TYPE: 'mongodb', DB_NAME: 'test_db', MULTI_TENANT: false, FIREWALL_ENABLED: true, USE_REDIS: false
		};
		return fallbacks[key];
	}),
	getPublicSettingSync: mock((key: string) => { return key === 'SITE_NAME' ? 'SveltyCMS Test' : undefined; }),
	getPrivateSetting: mock(async (key: string) => {
		const env = (globalThis as any).privateEnv || (globalThis as any).__privateEnv;
		if (env && key in env) return env[key];
		return 'mongodb';
	}),
	getPublicSetting: mock(async (key: string) => 'test'),
	loadSettingsCache: mock(async () => ({ loaded: true, private: {}, public: {} })),
	setSettingsCache: mock(async () => {}),
	invalidateSettingsCache: mock(async () => {}),
	isCacheLoaded: mock(() => true),
	getAllSettings: mock(async () => ({ public: {}, private: {} })),
	getUntypedSetting: mock(async () => undefined)
};
mock.module('@src/services/settings-service', () => settingsMock);

// 7. Widget Scanner Mock
mock.module('@src/widgets/scanner', () => ({
	coreModules: {}, customModules: {}, allWidgetModules: {},
	getWidgetNameFromPath: (path: string) => path.split('/').at(-2) || null
}));

// 8. Jackson Mock
mock.module('@boxyhq/saml-jackson', () => ({
    default: mock(() => Promise.resolve({
        oauthController: { authorize: mock(() => Promise.resolve({ redirect_url: 'https://idp.example.com/sso' })) },
        connectionAPIController: { createSAMLConnection: mock(() => Promise.resolve({ id: 'conn_123' })) }
    }))
}));

// 9. Database State Mock
const configStateMock = {
	get privateEnv() { return (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' }; },
	getPrivateEnv: () => (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' },
	setPrivateEnv: (env: any) => { (globalThis as any).privateEnv = env; (globalThis as any).__privateEnv = env; },
	loadPrivateConfig: () => Promise.resolve((globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' }),
	clearPrivateConfigCache: () => {},
	getDatabaseConfig: () => ({ type: 'mongodb', name: 'test_db', host: 'localhost' }),
	getDatabaseConnectionString: () => 'mongodb://localhost:27017/test_db'
};
mock.module('@src/databases/config-state', () => configStateMock);

// 10. Metrics Service Mock
const metricsMock = {
	incrementRequests: mock(() => {}), incrementErrors: mock(() => {}), recordResponseTime: mock(() => {}),
	incrementAuthValidations: mock(() => {}), incrementAuthFailures: mock(() => {}),
	recordAuthCacheHit: mock(() => {}), recordAuthCacheMiss: mock(() => {}),
	incrementApiRequests: mock(() => {}), incrementApiErrors: mock(() => {}),
	recordApiCacheHit: mock(() => {}), recordApiCacheMiss: mock(() => {}),
	incrementRateLimitViolations: mock(() => {}), incrementCSPViolations: mock(() => {}),
	incrementSecurityViolations: mock(() => {}), recordHookExecutionTime: mock(() => {}),
	getReport: mock(() => ({})), reset: mock(() => {}), exportPrometheus: mock(() => ''), destroy: mock(() => {})
};
(globalThis as any).metricsService = metricsMock;
mock.module('@src/services/metrics-service', () => ({ metricsService: metricsMock, default: metricsMock, cleanupMetrics: mock(() => {}) }));

// 11. Cache Service Mock
const cacheMock = {
	get: mock(async () => null), set: mock(async () => {}), setWithCategory: mock(async () => {}),
	delete: mock(async () => {}), clearByTags: mock(async () => {}), clearByPattern: mock(async () => {}),
	initialize: mock(async () => {}), invalidateAll: mock(async () => {}), getInstance: () => cacheMock
};
(globalThis as any).cacheService = cacheMock;
mock.module('@src/databases/cache-service', () => ({
	cacheService: cacheMock, default: cacheMock,
	CacheCategory: { SESSION: 'session', USER: 'user', API: 'api' },
    SESSION_CACHE_TTL_MS: 1, USER_PERM_CACHE_TTL_MS: 1, USER_COUNT_CACHE_TTL_MS: 1, API_CACHE_TTL_MS: 1,
    SESSION_CACHE_TTL_S: 1, USER_PERM_CACHE_TTL_S: 1, USER_COUNT_CACHE_TTL_S: 1, API_CACHE_TTL_S: 1, REDIS_TTL_S: 1
}));

// 12. Database Adapter and Audit Log Mocks
const mockAuditLog = { 
    log: mock(() => Promise.resolve()), 
    getLogs: mock(() => Promise.resolve([])) 
};
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
    dbAdapter: mockDbAdapter, auth: mockDbAdapter.auth,
    getDb: () => mockDbAdapter, getAuth: () => mockDbAdapter.auth,
    getPrivateEnv: () => (globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' },
    setPrivateEnv: (env: any) => { (globalThis as any).privateEnv = env; },
    loadPrivateConfig: () => Promise.resolve((globalThis as any).privateEnv || (globalThis as any).__privateEnv || { DB_TYPE: 'mongodb' }),
    clearPrivateConfigCache: () => {}, initializeOnRequest: () => Promise.resolve(), dbInitPromise: Promise.resolve()
};
mock.module('@src/databases/db', () => dbMock);
mock.module('@databases/db', () => dbMock);
(globalThis as any).auth = dbMock.auth;

mock.module('@src/services/audit/audit-log-service', () => ({
    auditLogService: mockAuditLog,
    default: mockAuditLog
}));

// 13. Event Bus Mock
const mockEventBus = {
    on: mock(() => {}), off: mock(() => {}), emit: mock(() => {}), once: mock(() => {}), removeAllListeners: mock(() => {})
};
(globalThis as any).mockEventBus = mockEventBus;
mock.module('@src/services/automation/event-bus', () => ({ eventBus: mockEventBus, default: mockEventBus }));

// 14. Setup Check Mock
let isSetupCompleteValue = true;
const mockSetupCheck = {
    isSetupComplete: mock(() => isSetupCompleteValue),
    isSetupCompleteAsync: mock(async () => isSetupCompleteValue),
    invalidateSetupCache: mock(() => {}),
    setSetupComplete: (val: boolean) => { isSetupCompleteValue = val; }
};
mock.module('@utils/setup-check', () => mockSetupCheck);
(globalThis as any).mockSetupCheck = mockSetupCheck;

console.log('✅ Fresh Master Test Setup Loaded');
