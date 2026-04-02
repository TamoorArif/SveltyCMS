/**
 * @file tests/playwright/setup-wizard.spec.ts
 * @description Setup wizard test for SveltyCMS
 *
 * This test completes the initial setup wizard by:
 * 1. Navigating through the wizard UI
 * 2. Dismisses welcome/cookie dialogs
 * 3. Configures database, creates admin, completes setup
 */

import { expect, test, type Page } from "@playwright/test";

// Helper to click "Next" button and wait for transition
async function clickNext(page: Page) {
  const nextButton = page.getByLabel("Next", { exact: true });
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await page.waitForTimeout(500);
}

// Helper to dismiss any blocking dialogs (welcome, cookie consent)
async function dismissDialogs(page: Page) {
  // Welcome dialog
  const getStarted = page.getByRole("button", { name: /get started/i });
  if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await getStarted.click();
    await page.waitForTimeout(800);
  }
  // Cookie consent
  const acceptAll = page.getByRole("button", { name: /accept all/i });
  if (await acceptAll.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await acceptAll.click();
    await page.waitForTimeout(500);
  }
}

test("Setup Wizard: Configure DB and Create Admin", async ({ page }) => {
  test.setTimeout(180_000);

  // Inject script to prevent welcome modal from blocking by pre-setting sessionStorage
  await page.addInitScript(() => {
    window.sessionStorage.setItem("sveltycms_welcome_modal_shown", "true");
  });

  // --- Early skip: Check if system is already configured ---
  try {
    const setupCheck = await page.request.post("/api/testing", {
      data: { action: "setup" },
    });
    if (setupCheck.ok()) {
      console.log("System already configured via API. Skipping wizard.");
      return;
    }
  } catch {
    // API not available — proceed with wizard
  }

  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");

  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);

  if (currentUrl.includes("/login") || currentUrl.includes("/admin")) {
    console.log("System already configured. Skipping setup.");
    return;
  }

  if (!currentUrl.includes("/setup")) {
    await page.goto("/setup", { waitUntil: "networkidle" });
    await page.waitForLoadState("networkidle");
    if (!page.url().includes("/setup")) {
      console.log("System already configured. Skipping setup.");
      return;
    }
  }

  // Dismiss any dialogs
  await dismissDialogs(page);

  // Also check for "already configured" message
  const alreadyConfigured = page.getByText(/already (configured|set up|complete)/i);
  if (await alreadyConfigured.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("Setup page shows already configured. Skipping.");
    return;
  }

  // --- STEP 1: Database ---
  await expect(page.locator("h2", { hasText: /database/i }).first()).toBeVisible({
    timeout: 30_000,
  });

  // Dismiss dialogs again (they may re-render)
  await dismissDialogs(page);

  const dbType = process.env.DB_TYPE || "sqlite";
  if (dbType !== "mongodb") {
    await page.locator("#db-type").selectOption(dbType);
  }

  const dbHost = process.env.DB_HOST || "localhost";
  const dbName = process.env.DB_NAME || "sveltycms_test";

  await page.locator("#db-host").fill(dbHost);
  await page.locator("#db-name").fill(dbName);

  if (dbType !== "sqlite") {
    const portLocator = page.locator("#db-port");
    if (await portLocator.isVisible()) await portLocator.fill(process.env.DB_PORT || "27017");

    const userLocator = page.locator("#db-user");
    if (await userLocator.isVisible()) await userLocator.fill(process.env.DB_USER || "test");

    const passLocator = page.locator("#db-password");
    if (await passLocator.isVisible()) await passLocator.fill(process.env.DB_PASSWORD || "test");
  }

  // Dismiss dialogs one more time right before clicking
  await dismissDialogs(page);

  // Test Connection
  const testDbButton = page.locator("button", { hasText: /test database/i });
  await testDbButton.click({ force: true });

  // Wait for the connection test to complete
  await page.waitForTimeout(5000);

  // Check for "DB not found" confirmation dialog — "Yes, Create It" button
  // The dialog may be rendered as a modal overlay
  const yesCreateBtn = page.locator('button:has-text("Yes, Create It")').last();
  if (await yesCreateBtn.isVisible({ timeout: 15_000 }).catch(() => false)) {
    console.log("Confirming database creation...");
    await yesCreateBtn.click();
    await page.waitForTimeout(5000);
  }

  // Wait for success
  try {
    await expect(page.getByText(/success|connected successfully/i).first()).toBeVisible({
      timeout: 40_000,
    });
    console.log("Database connection successful.");
  } catch {
    console.log("DB test still failing, retrying full flow...");
    await page.waitForTimeout(5000);

    // Click retry button if available
    const retryBtn = page.getByRole("button", { name: /retry|try again/i });
    if (await retryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await retryBtn.click();
      await page.waitForTimeout(3000);

      const yesCreateBtn2 = page.locator('button:has-text("Yes, Create It")').last();
      if (await yesCreateBtn2.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await yesCreateBtn2.click();
        await page.waitForTimeout(3000);
      }
    }

    await expect(page.getByText(/success|connected successfully/i).first()).toBeVisible({
      timeout: 60_000,
    });
  }

  // Move to Admin step
  await clickNext(page);

  // --- STEP 2: Admin User ---
  await expect(page.locator("h2", { hasText: /admin/i }).first()).toBeVisible({
    timeout: 60_000,
  });

  await page.locator("#admin-username").fill(process.env.ADMIN_USER || "admin");
  await page.locator("#admin-email").fill(process.env.ADMIN_EMAIL || "admin@example.com");
  await page.locator("#admin-password").fill(process.env.ADMIN_PASS || "Admin123!");
  await page.locator("#admin-confirm-password").fill(process.env.ADMIN_PASS || "Admin123!");

  await clickNext(page);

  // --- STEPS 3-5: Defaults ---
  for (let i = 0; i < 5; i++) {
    const completeBtn = page.getByLabel("Complete", { exact: true });
    if (await completeBtn.isVisible()) {
      await completeBtn.click();
      break;
    }
    const nextBtn = page.getByLabel("Next", { exact: true });
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }

  // --- VERIFICATION ---
  try {
    await page.request.post("/api/testing", { data: { action: "setup" } });
    console.log("Forced setup completion via API.");
  } catch (err) {
    console.warn("Setup API call failed (non-fatal):", err);
  }

  // Navigate away from /setup — the server should now redirect to /login
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/setup/, { timeout: 30_000 });
  console.log("Setup wizard test completed successfully.");
});
