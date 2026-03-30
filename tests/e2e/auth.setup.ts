import { test as setup, expect } from "@playwright/test";
import { loginAsAdmin, ADMIN_CREDENTIALS } from "./helpers/auth";
import { readFileSync } from "node:fs";

const ADMIN_AUTH_FILE = "tests/e2e/.auth/admin.json";
const EDITOR_AUTH_FILE = "tests/e2e/.auth/editor.json";
const AUTHOR_AUTH_FILE = "tests/e2e/.auth/author.json";

setup.describe("E2E Role-Based Setup", () => {
  setup("authenticate as admin", async ({ page }) => {
    // After the wizard project completes setup, the system is already configured.
    // Just seed the admin user (idempotent — won't fail if user already exists).
    // We skip reset because it clears the config and puts the system back in
    // "first user" mode, which is hard to recover from without a server restart.
    console.log("[Setup] Seeding admin user (system already configured by wizard)...");
    const seedResponse = await page.request.post("/api/testing", {
      data: {
        action: "seed",
        email: ADMIN_CREDENTIALS.email,
        password: ADMIN_CREDENTIALS.password,
      },
    });
    // Seed may return various status codes — as long as the user exists, we're fine
    console.log(`[Setup] Seed returned ${seedResponse.status()}`);
    if (seedResponse.status() === 503) {
      // DB not initialized — try reset + seed as fallback
      console.log("[Setup] DB not initialized, attempting reset + seed...");
      const resetResponse = await page.request.post("/api/testing", {
        data: { action: "reset" },
      });
      if (resetResponse.ok()) {
        const seedRetry = await page.request.post("/api/testing", {
          data: {
            action: "seed",
            email: ADMIN_CREDENTIALS.email,
            password: ADMIN_CREDENTIALS.password,
          },
        });
        console.log(`[Setup] Seed retry returned ${seedRetry.status()}`);
        if (seedRetry.ok()) {
          const setupRetry = await page.request.post("/api/testing", {
            data: { action: "setup" },
          });
          console.log(`[Setup] Setup retry returned ${setupRetry.status()}`);
        }
      }
    }

    // Wait for the server to re-evaluate firstUserExists after seed
    console.log("[Setup] Waiting for server state to settle...");
    await page.waitForTimeout(3000);

    // Perform login
    await loginAsAdmin(page);

    // Save admin storage state
    await page.context().storageState({ path: ADMIN_AUTH_FILE });
  });

  setup("provision editor and author via invite flow", async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    // This depends on the admin.json created in the previous setup test
    const adminState = JSON.parse(readFileSync(ADMIN_AUTH_FILE, "utf-8"));
    await page.context().addCookies(adminState.cookies);

    const roles = ["Editor", "Author"];
    for (const role of roles) {
      console.log(`[Setup] Inviting ${role}...`);
      const signupResponse = await page.request.post("/api/testing", {
        data: {
          action: "create-user",
          email: `${role.toLowerCase()}@example.com`,
          password: "Password123!",
          role: role,
        },
      });

      if (!signupResponse.ok()) {
        const errorBody = await signupResponse.text();
        console.error(
          `[Setup] Create user failed with status ${signupResponse.status()}: ${errorBody}`,
        );
      }
      expect(signupResponse.ok()).toBeTruthy();

      // Login as the new user to capture their state
      await page.goto("/login");
      await page.waitForLoadState("domcontentloaded");

      // Use the same selector strategy as loginAsAdmin helper
      const emailInput = page.locator('input[name="email"]').first();
      const passwordInput = page.locator('input[name="password"]').first();
      await emailInput.fill(`${role.toLowerCase()}@example.com`);
      await passwordInput.fill("Password123!");
      await page.locator('button[type="submit"]').first().click();

      await page.waitForURL("**/config/**", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const targetFile = role === "Editor" ? EDITOR_AUTH_FILE : AUTHOR_AUTH_FILE;
      await page.context().storageState({ path: targetFile });
      console.log(`[Setup] Saved ${role} state to ${targetFile}`);
    }
  });
});
