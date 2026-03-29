import { test as setup, expect } from "@playwright/test";
import { loginAsAdmin, ADMIN_CREDENTIALS } from "./helpers/auth";
import { readFileSync } from "node:fs";

const ADMIN_AUTH_FILE = "tests/e2e/.auth/admin.json";
const EDITOR_AUTH_FILE = "tests/e2e/.auth/editor.json";
const AUTHOR_AUTH_FILE = "tests/e2e/.auth/author.json";

setup.describe("E2E Role-Based Setup", () => {
  setup("authenticate as admin", async ({ page }) => {
    // Check if system is already configured (CI runs setup-system.ts before tests)
    // In CI, we only need to ensure admin user exists — don't wipe config
    const healthResponse = await page.request.get("/api/system/health");
    const healthData = await healthResponse.json();
    const isConfigured = healthData.overallStatus !== "IDLE";

    if (isConfigured) {
      // System already configured by setup-system.ts — just ensure admin exists via seed
      console.log(`[Setup] System already configured, seeding admin user...`);
      const seedResponse = await page.request.post("/api/testing", {
        data: {
          action: "seed",
          email: ADMIN_CREDENTIALS.email,
          password: ADMIN_CREDENTIALS.password,
        },
      });
      // Seed may fail if user already exists — that's fine
      if (!seedResponse.ok()) {
        console.log(`[Setup] Seed returned ${seedResponse.status()} (user may already exist)`);
      }
    } else {
      // Local testing — need full reset + seed + setup
      console.log("[Setup] System not configured, performing full reset...");
      const resetResponse = await page.request.post("/api/testing", {
        data: { action: "reset" },
      });
      expect(resetResponse.ok()).toBeTruthy();

      const seedResponse = await page.request.post("/api/testing", {
        data: {
          action: "seed",
          email: ADMIN_CREDENTIALS.email,
          password: ADMIN_CREDENTIALS.password,
        },
      });
      expect(seedResponse.ok()).toBeTruthy();

      const setupResponse = await page.request.post("/api/testing", {
        data: { action: "setup" },
      });
      expect(setupResponse.ok()).toBeTruthy();
    }

    // Perform login
    await loginAsAdmin(page);

    // Save admin storage state
    await page.context().storageState({ path: ADMIN_AUTH_FILE });
  });

  setup("provision editor and author via invite flow", async ({ page }) => {
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
      await page.getByPlaceholder(/email/i).fill(`${role.toLowerCase()}@example.com`);
      await page.getByPlaceholder(/password/i).fill("Password123!");
      await page.getByRole("button", { name: /sign in/i }).click();

      const targetFile = role === "Editor" ? EDITOR_AUTH_FILE : AUTHOR_AUTH_FILE;
      await page.context().storageState({ path: targetFile });
      console.log(`[Setup] Saved ${role} state to ${targetFile}`);
    }
  });
});
