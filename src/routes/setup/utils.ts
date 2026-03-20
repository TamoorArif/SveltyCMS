/**
 * @file src/routes/setup/utils.ts
 * @description Core utility functions for the setup process, including database connection helpers,
 * adapter factories, and validation logic.
 *
 * This file is part of the SveltyCMS setup wizard and handles low-level setup operations
 * such as building connection strings and initializing database adapters during the setup phase.
 */

import type { IDBAdapter } from "@src/databases/db-interface";
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

  // Initialize auth models with error handling
  try {
    // Ensure auth module is initialized before accessing it
    if (dbAdapter.ensureAuth) {
      await dbAdapter.ensureAuth();
    } else {
      await dbAdapter.auth.setupAuthModels();
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
    if (connectionString.startsWith("mongodb+srv://")) {
      connectionOptions.authSource = "admin";
    }
  }

  try {
    const connectResult = await dbAdapter.connect(connectionString, connectionOptions);
    if (!connectResult.success) {
      throw new Error(connectResult.error.message);
    }

    logger.info("Running authentication verification probe for MongoDB...", { correlationId });

    try {
      // Revert to using the adapter's CRUD method to avoid dependency on global mongoose
      // and to avoid needing cluster-wide 'listDatabases' permissions.
      await dbAdapter.crud.count("system_content_structure", {});
    } catch (probeErr: any) {
      logger.warn(`⚠️ Auth probe warning: ${probeErr.message} (code: ${probeErr.code})`, {
        correlationId,
      });

      // MongoDB numeric codes: 18 = AuthenticationFailed, 13 = Unauthorized
      if (probeErr.code === 18 || probeErr.code === 13) {
        throw new Error("Authentication failed: Please check your MongoDB user credentials.");
      }

      const msg = probeErr.message.toLowerCase();
      if (msg.includes("auth") || msg.includes("unauthorized") || msg.includes("credentials")) {
        throw new Error(`Authentication failed: ${probeErr.message}`);
      }
      // If it's another error (like table not found), we are connected and authenticated.
    }

    return dbAdapter;
  } catch (err: any) {
    logger.error(`MongoDB setup failed: ${err.message}`, { correlationId });
    throw err;
  }
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
    throw new Error(connectResult.error?.message || "Failed to connect to MariaDB");
  }

  try {
    await dbAdapter.crud.count("system_content_structure", {});
    return dbAdapter;
  } catch (probeErr: any) {
    // MariaDB/MySQL numeric code 1045 = ER_ACCESS_DENIED_ERROR
    if (probeErr.code === "ER_ACCESS_DENIED_ERROR" || probeErr.errno === 1045) {
      throw new Error("Authentication failed: Please check your MariaDB credentials.");
    }
    return dbAdapter; // Ignore other errors for now (e.g. table not found)
  }
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
    throw new Error(connectResult.error?.message || "Failed to connect to PostgreSQL");
  }

  try {
    await dbAdapter.crud.count("system_content_structure", {});
    return dbAdapter;
  } catch (probeErr: any) {
    // Postgres standard SQLSTATE codes: 28P01 = invalid_password, 28000 = invalid_authorization_specification
    if (probeErr.code === "28P01" || probeErr.code === "28000") {
      throw new Error("Authentication failed: Please check your PostgreSQL username and password.");
    }
    return dbAdapter;
  }
}

// Strategy: setup SQLite adapter
async function setupSQLite(
  _config: DatabaseConfig,
  connectionString: string,
  options: { createIfMissing?: boolean },
  correlationId: string,
): Promise<IDBAdapter> {
  try {
    const { existsSync, writeFileSync } = await import("node:fs");
    if (!existsSync(connectionString)) {
      if (options.createIfMissing) {
        logger.info(`[setupSQLite] Creating missing SQLite database file: ${connectionString}`, {
          correlationId,
        });
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
      throw new Error(connectResult.error?.message || "Failed to connect to SQLite");
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
