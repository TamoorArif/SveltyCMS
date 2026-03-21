/**
 * @file src/routes/setup/utils.ts
 * @description Core utility functions for the setup process, including database connection helpers,
 * adapter factories, and validation logic.
 *
 * This file is part of the SveltyCMS setup wizard and handles low-level setup operations
 * such as building connection strings and initializing database adapters during the setup phase.
 */

import type { DatabaseError, IDBAdapter } from "@src/databases/db-interface";
import type { DatabaseConfig } from "@src/databases/schemas";
import { logger } from "@utils/logger";

/**
 * Database connection string builder for supported database types.
 * Currently supports: MongoDB (standard and Atlas SRV), MariaDB
 * Future support planned: PostgreSQL
 */
export function buildDatabaseConnectionString(config: DatabaseConfig): string {
  // Validate config
  switch (config.type) {
    case "mongodb":
    case "mongodb+srv": {
      const isSrv = config.type === "mongodb+srv";
      const protocol = isSrv ? "mongodb+srv" : "mongodb";
      const port = isSrv || !config.port ? "" : `:${config.port}`;

      // Check if username is provided
      const user = config.user
        ? `${encodeURIComponent(config.user)}${config.password ? `:${encodeURIComponent(config.password)}` : ""}@`
        : "";

      // Only add authSource when credentials are provided
      // Only add basic auth if credentials are provided
      let queryParams = "";
      if (isSrv) {
        // Atlas without credentials but with query params
        queryParams = "?retryWrites=true&w=majority";
      }

      // Logging happens in getSetupDatabaseAdapter with correlationId
      return `${protocol}://${user}${config.host}${port}/${config.name}${queryParams}`;
    }
    case "mariadb": {
      // MariaDB connection string
      const port = config.port ? `:${config.port}` : ":3306";
      const hasCredentials = config.user && config.password;
      const user = hasCredentials
        ? `${encodeURIComponent(config.user!)}:${encodeURIComponent(config.password!)}@`
        : "";

      return `mysql://${user}${config.host}${port}/${config.name}`;
    }
    case "postgresql": {
      // PostgreSQL connection string
      const port = config.port ? `:${config.port}` : ":5432";
      const hasCredentials = config.user && config.password;
      const user = hasCredentials
        ? `${encodeURIComponent(config.user!)}:${encodeURIComponent(config.password!)}@`
        : "";

      return `postgresql://${user}${config.host}${port}/${config.name}`;
    }
    case "sqlite": {
      // SQLite connection "string" (file path)
      // Ensure host is treated as directory and name as filename
      const path = config.host.endsWith("/") ? config.host : `${config.host}/`;
      return `${path}${config.name}`;
    }
    default: {
      // TypeScript ensures exhaustive checking - this should never be reached
      // but provides a helpful message if the schema is extended without updating this function
      const EXHAUSTIVE_CHECK: never = config.type;
      throw new Error(`Unsupported database type: ${EXHAUSTIVE_CHECK}`);
    }
  }
}

/**
 * A centralized factory function to get a temporary, connected database adapter
 * for setup operations. This is the core of the refactor.
 */

export async function getSetupDatabaseAdapter(
  config: DatabaseConfig,
  options: { createIfMissing?: boolean } = {},
): Promise<{
  dbAdapter: IDBAdapter;
  connectionString: string;
}> {
  const correlationId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : (await import("node:crypto")).randomUUID();
  logger.info(`Creating setup database adapter for ${config.type}`, {
    correlationId,
  });

  const connectionString = buildDatabaseConnectionString(config);
  logger.info(`Connection string built for ${config.type}`, {
    correlationId,
    host: config.host,
    port: config.port,
    name: config.name,
    hasUser: !!config.user,
    hasPassword: !!config.password,
    // Only log sanitized connection string (without password)
    connectionStringPreview: connectionString.replace(/:[^:@]+@/, ":***@"),
  });

  // 🌟 Handle TEST_MODE centrally before doing any real database logic
  if (process.env.TEST_MODE === "true" && config.host === "mock-host") {
    logger.info(`🛠️ Mocking ${config.type} connection for setup in TEST_MODE`);

    // Return a generic mocked adapter that satisfies the IDBAdapter interface
    const mockAdapter = {
      connect: async () => ({ success: true, data: undefined }),
      disconnect: async () => {},
      auth: { setupAuthModels: async () => {} },
      crud: { count: async () => 0 },
      getConnectionHealth: async () => ({
        success: true,
        data: { healthy: true, latency: 10, activeConnections: 1 },
      }),
    } as unknown as IDBAdapter;

    return { dbAdapter: mockAdapter, connectionString };
  }

  let dbAdapter: IDBAdapter;

  switch (config.type) {
    case "mongodb":
    case "mongodb+srv":
      dbAdapter = await setupMongoDB(config, connectionString, correlationId);
      break;
    case "mariadb":
      dbAdapter = await setupMariaDB(config, connectionString, correlationId);
      break;
    case "postgresql":
      dbAdapter = await setupPostgreSQL(config, connectionString, correlationId);
      break;
    case "sqlite":
      dbAdapter = await setupSQLite(config, connectionString, options, correlationId);
      break;
    default: {
      // TypeScript ensures exhaustive checking
      const EXHAUSTIVE_CHECK: never = config.type;
      logger.error(`Unsupported database type: ${EXHAUSTIVE_CHECK}`, { correlationId });
      throw new Error(`Database type '${EXHAUSTIVE_CHECK}' is not supported for setup.`);
    }
  }

  // Initialize models and interfaces for all domain modules
  try {
    // 1. Auth: setup models and register schemas
    if (dbAdapter.ensureAuth) {
      await dbAdapter.ensureAuth();
    } else if (dbAdapter.auth?.setupAuthModels) {
      await dbAdapter.auth.setupAuthModels();
    }

    // 2. System: initialize preferences, themes, etc.
    if (dbAdapter.ensureSystem) {
      await dbAdapter.ensureSystem();
    }

    // 3. Media: initialize media methods
    if (dbAdapter.ensureMedia) {
      await dbAdapter.ensureMedia();
    }

    // 4. Content: initialize content-specific methods/models
    if (dbAdapter.ensureContent) {
      await dbAdapter.ensureContent();
    }
  } catch (err) {
    logger.error(
      `Model initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      { correlationId },
    );
    await dbAdapter.disconnect();
    throw new Error(
      `Model initialization failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }

  logger.info(`✅ Successfully created and connected adapters for ${config.type}`, {
    correlationId,
  });
  return { dbAdapter, connectionString };
}

// Strategy: setup MongoDB adapter
async function setupMongoDB(
  config: DatabaseConfig,
  connectionString: string,
  correlationId: string,
): Promise<IDBAdapter> {
  const { MongoDBAdapter } = await import("@src/databases/mongodb/mongo-db-adapter");
  const dbAdapter = new MongoDBAdapter() as IDBAdapter;

  const connectionOptions: any = {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 50,
    retryWrites: true,
    dbName: config.name,
  };

  logger.debug(`[setupMongoDB] URI: ${connectionString.replace(/:([^:@]+)@/, ":****@")}`);

  if (config.user) {
    connectionOptions.user = config.user;
    if (config.password) {
      connectionOptions.pass = config.password;
    }
  }

  /** Helper to verify authentication via a count probe or connect error */
  const checkAuthFailure = (error: any) => {
    if (!error) return false;
    const code = error.originalCode;
    const msg = (error.message || "").toLowerCase();
    const details = (typeof error.details === "string" ? error.details : "").toLowerCase();

    return (
      code === 18 ||
      code === 13 ||
      code === "18" ||
      code === "13" ||
      msg.includes("auth") ||
      msg.includes("unauthorized") ||
      msg.includes("credentials") ||
      msg.includes("authentication") ||
      msg.includes("command denied") ||
      details.includes("auth") ||
      details.includes("unauthorized") ||
      details.includes("credentials") ||
      details.includes("authentication") ||
      details.includes("requires authentication") ||
      details.includes("command denied")
    );
  };

  try {
    // Stage 1: Attempt connection with default settings
    logger.info("Attempting MongoDB connection (Stage 1: default auth)...", { correlationId });
    let connectResult = await dbAdapter.connect(connectionString, connectionOptions);

    let needsRetry = false;
    if (!connectResult.success) {
      if (
        checkAuthFailure(connectResult.error) &&
        config.user &&
        connectionOptions.authSource !== "admin"
      ) {
        needsRetry = true;
      } else {
        const isAuth = checkAuthFailure(connectResult.error);
        const hint = getDatabaseHint(connectResult.error as DatabaseError, "mongodb");
        const mainMsg = isAuth ? "Authentication failed" : connectResult.error.message;
        throw new Error(`${mainMsg}\n${hint}`);
      }
    } else {
      // If connection succeeded, verify with a probe
      const probeResult = await dbAdapter.crud.count(
        "system_content_structure",
        {},
        { silent: true },
      );
      if (!probeResult.success) {
        if (
          checkAuthFailure(probeResult.error) &&
          config.user &&
          connectionOptions.authSource !== "admin"
        ) {
          needsRetry = true;
        } else {
          const isAuth = checkAuthFailure(probeResult.error);
          const hint = getDatabaseHint(probeResult.error as DatabaseError, "mongodb");
          const mainMsg = isAuth ? "Authentication required" : probeResult.error.message;
          throw new Error(`${mainMsg}\n${hint}`);
        }
      }
    }

    // Stage 2: If Stage 1 failed due to AUTH, and we haven't tried 'admin' authSource yet, retry.
    if (needsRetry) {
      logger.info("Auth failed in Stage 1. Retrying with authSource: admin...", {
        correlationId,
      });

      await dbAdapter.disconnect();
      connectionOptions.authSource = "admin";

      connectResult = await dbAdapter.connect(connectionString, connectionOptions);

      if (connectResult.success) {
        // Verify Stage 2 with a probe
        const secondProbeResult = await dbAdapter.crud.count(
          "system_content_structure",
          {},
          { silent: true },
        );
        if (secondProbeResult.success) {
          logger.info("✅ MongoDB authenticated successfully via 'admin' authSource.", {
            correlationId,
          });
          return dbAdapter;
        }

        // If Stage 2 also fails, we throw the specific error from Stage 2
        const isAuth = checkAuthFailure(secondProbeResult.error);
        const hint = getDatabaseHint(secondProbeResult.error as DatabaseError, "mongodb");
        const mainMsg = isAuth ? "Authentication failed" : secondProbeResult.error.message;
        throw new Error(`${mainMsg}\n${hint}`);
      } else {
        // Stage 2 connect failed
        const hint = getDatabaseHint(connectResult.error as DatabaseError, "mongodb");
        throw new Error(`${connectResult.error.message}\n${hint}`);
      }
    }

    return dbAdapter;
  } catch (err: any) {
    logger.error(`MongoDB setup failed: ${err.message}`, { correlationId });
    throw err;
  }
}

/**
 * Provides a human-readable hint based on the database error and type.
 */
function getDatabaseHint(error: DatabaseError, type: string): string {
  const code = error.originalCode?.toString() || "";
  const details = typeof error.details === "string" ? error.details.toLowerCase() : "";
  const msg = (error.message.toLowerCase() + " " + details).trim();

  // 1. Connection Refused / Network issues (Generic)
  if (msg.includes("econnrefused") || msg.includes("etimedout") || msg.includes("enotfound")) {
    const portMapping: Record<string, string> = {
      mongodb: "27017",
      mariadb: "3306",
      postgresql: "5432",
    };
    const defaultPort = portMapping[type] || "default port";
    return `Hint: Check if the ${type.toUpperCase()} service is running and accessible. Ensure ${
      msg.includes("enotfound") ? "the host address is correct" : `port ${defaultPort} is open`
    } and not blocked by a firewall.`;
  }

  // 2. Auth Errors
  if (
    msg.includes("auth") ||
    msg.includes("denied") ||
    msg.includes("password") ||
    msg.includes("login") ||
    msg.includes("identity")
  ) {
    // MariaDB/MySQL: 1045 = ER_ACCESS_DENIED_ERROR
    if (type === "mariadb" && code === "1045") {
      return "Hint: Access denied. Double-check your MariaDB username and password.";
    }
    // PostgreSQL: 28P01 = invalid_password, 28000 = invalid_authorization_specification
    if (type === "postgresql" && (code === "28P01" || code === "28000")) {
      return "Hint: Authentication failed. Verify your PostgreSQL username and password.";
    }
    // MongoDB: 18 = AuthenticationFailed, 13 = Unauthorized
    if (type === "mongodb") {
      if (
        code === "18" ||
        code === "13" ||
        msg.includes("requires authentication") ||
        msg.includes("command denied")
      ) {
        if (!msg.includes("admin") && (msg.includes("admin") || details.includes("admin"))) {
          return "Hint: Authentication failed via 'admin'. Please check your root credentials.";
        }
        return "Hint: Authentication failed. If this database is secured (like Docker), please provide a username and password.";
      }
    }
    return "Hint: Authentication failed. Please verify your credentials.";
  }

  // 3. Missing Database
  if (msg.includes("database") && (msg.includes("not exist") || msg.includes("unknown"))) {
    // MariaDB: 1049 = ER_BAD_DB_ERROR
    // PostgreSQL: 3D000 = invalid_catalog_name
    return `Hint: The database may not exist. Please manually create it or check the name capitalization.`;
  }

  // 4. SQLite specific
  if (type === "sqlite") {
    if (msg.includes("cantopen"))
      return "Hint: Cannot open database file. Check directory permissions.";
    if (msg.includes("perm"))
      return "Hint: Permission denied. Ensure the process can write to the file.";
  }

  return "Hint: Please check your configuration and ensure the database server is reachable.";
}

// Strategy: setup MariaDB adapter
async function setupMariaDB(
  _config: DatabaseConfig,
  connectionString: string,
  _correlationId: string,
): Promise<IDBAdapter> {
  const { MariaDBAdapter } = await import("@src/databases/mariadb/mariadb-adapter");
  const dbAdapter = new MariaDBAdapter() as IDBAdapter;

  const connectResult = await dbAdapter.connect(connectionString);
  if (!connectResult.success) {
    const hint = getDatabaseHint(connectResult.error, "mariadb");
    throw new Error(`${connectResult.error.message}\n${hint}`);
  }

  // For MariaDB, we do a simple query to verify permissions
  const probeResult = await dbAdapter.crud.count("system_content_structure", {});
  if (!probeResult.success) {
    const hint = getDatabaseHint(probeResult.error, "mariadb");
    if (
      probeResult.error.message.includes("denied") ||
      probeResult.error.message.includes("auth")
    ) {
      throw new Error(`Authentication failed: ${probeResult.error.message}\n${hint}`);
    }
  }

  return dbAdapter;
}

// Strategy: setup PostgreSQL adapter
async function setupPostgreSQL(
  _config: DatabaseConfig,
  connectionString: string,
  _correlationId: string,
): Promise<IDBAdapter> {
  const { PostgreSQLAdapter } = await import("@src/databases/postgresql/postgres-adapter");
  const dbAdapter = new PostgreSQLAdapter() as IDBAdapter;

  const connectResult = await dbAdapter.connect(connectionString);
  if (!connectResult.success) {
    const hint = getDatabaseHint(connectResult.error, "postgresql");
    throw new Error(`${connectResult.error.message}\n${hint}`);
  }

  const probeResult = await dbAdapter.crud.count("system_content_structure", {});
  if (!probeResult.success) {
    const hint = getDatabaseHint(probeResult.error, "postgresql");
    if (
      probeResult.error.message.includes("denied") ||
      probeResult.error.message.includes("auth")
    ) {
      throw new Error(`Authentication failed: ${probeResult.error.message}\n${hint}`);
    }
  }
  return dbAdapter;
}

// Strategy: setup SQLite adapter
async function setupSQLite(
  _config: DatabaseConfig,
  connectionString: string,
  options: { createIfMissing?: boolean },
  correlationId: string,
): Promise<IDBAdapter> {
  try {
    const { existsSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    if (!existsSync(connectionString)) {
      if (options.createIfMissing) {
        logger.info(`[setupSQLite] Creating missing SQLite database file: ${connectionString}`, {
          correlationId,
        });
        // Ensure directory exists
        const dir = dirname(connectionString);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        // Create an empty file to allow the adapter to connect and run migrations
        writeFileSync(connectionString, "");
      } else {
        throw new Error(`SQLite database file "${connectionString}" does not exist.`);
      }
    }

    const { SQLiteAdapter } = await import("@src/databases/sqlite/sqlite-adapter");
    const dbAdapter = new SQLiteAdapter() as IDBAdapter;
    const connectResult = await dbAdapter.connect(connectionString);
    if (!connectResult.success) {
      const hint = getDatabaseHint(connectResult.error, "sqlite");
      throw new Error(`${connectResult.error.message}\n${hint}`);
    }
    return dbAdapter;
  } catch (err: any) {
    logger.error(`SQLite setup failed: ${err.message}`, { correlationId });
    throw err;
  }
}

// Probes for a local Redis server on port 6379.
export async function checkRedis(): Promise<boolean> {
  const { createClient } = await import("redis");
  const client = createClient({
    socket: {
      host: "localhost",
      port: 6379,
      connectTimeout: 1000,
    },
  });

  try {
    await client.connect();
    await client.ping();
    await client.quit();
    logger.info("🚀 Local Redis detected during setup probe");
    return true;
  } catch {
    // Redis not available - silent failure, it's just a probe
    return false;
  }
}
