/**
 * @file src/content/content-polling.svelte.ts
 * @description
 * Client-side polling service for content versioning.
 * Synchronizes local state with server-side changes.
 */
import { browser } from "$app/environment";
import { logger } from "@utils/logger";
import { contentManager } from "@src/content";

let pollingInterval: NodeJS.Timeout | null = null;
let currentVersion = $state(0);

/**
 * Polling logic for content updates.
 */
export const contentPolling = {
  get version() {
    return currentVersion;
  },

  set version(value: number) {
    currentVersion = value;
  },

  /**
   * Starts the background polling for content version changes.
   * Only executes in the browser.
   */
  start(intervalMs = 10000) {
    if (pollingInterval || !browser) return;

    // Skip polling on setup or login routes
    if (
      window.location.pathname.startsWith("/setup") ||
      window.location.pathname.startsWith("/login")
    ) {
      return;
    }

    logger.info("📡 Starting content version polling");

    // Initial version sync
    this._checkVersion();

    pollingInterval = setInterval(() => this._checkVersion(), intervalMs);
  },

  /**
   * Stops the polling interval.
   */
  stop() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },

  /**
   * Performs a single version check against the API.
   */
  async _checkVersion() {
    try {
      const response = await fetch("/api/content/version");
      if (!response.ok) throw new Error("Version check failed");

      const data = await response.json();
      const serverVersion = data.version;

      if (currentVersion === 0) {
        currentVersion = serverVersion;
        return;
      }

      if (serverVersion > currentVersion) {
        logger.info(
          `🆕 New content version detected: ${serverVersion} (current: ${currentVersion})`,
        );
        currentVersion = serverVersion;

        // Trigger reactive refresh
        await contentManager.refresh(null);
      }
    } catch (error) {
      logger.warn("Failed to poll content version", error);
    }
  },
};
