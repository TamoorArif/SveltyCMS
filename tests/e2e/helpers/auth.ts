/**
 * @file tests/playwright/helpers/auth.ts
 * @description Shared authentication helper for Playwright tests
 * Uses the same credentials as setup-wizard to ensure consistency
 */

import { expect, type Page } from "@playwright/test";

/**
 * Login credentials that match the setup wizard defaults
 */
export const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL || "admin@example.com",
  password: process.env.ADMIN_PASS || "Admin123!",
};

/**
 * Login as admin user
 * @param page - Playwright page object
 * @param waitForUrl - URL pattern to wait for after login (default: Collections/Names page)
 */
export async function loginAsAdmin(page: Page, waitForUrl?: string | RegExp) {
  // Atomic Auth: Clear all previous session state to prevent session bleed
  console.log("[Auth] Clearing cookies and localStorage for atomic login...");
  await page.context().clearCookies();
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {
    // localStorage may be inaccessible on about:blank or cross-origin pages
    console.log("[Auth] localStorage not accessible, skipping clear (likely on about:blank)");
  }

  // Inject session storage to bypass the welcome modal and cookie consent before navigation
  await page.addInitScript(() => {
    window.sessionStorage.setItem("sveltycms_welcome_modal_shown", "true");
    window.localStorage.setItem(
      "sveltycms_consent",
      JSON.stringify({
        responded: true,
        necessary: true,
        analytics: false,
        marketing: false,
      }),
    );
  });

  // --- Strategy 1: Submit login form directly via Playwright ---
  // Navigate to login first
  console.log("[Auth] Navigating to /login...");
  await page.goto("/login", { waitUntil: "networkidle", timeout: 30_000 });

  if (page.url().includes("/setup")) {
    throw new Error(`Setup is not complete. Cannot login - redirected to: ${page.url()}`);
  }

  // Reload to force fresh SSR (ensures firstUserExists is up-to-date)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Check if data-testid selectors exist (preferred)
  const signinEmail = page.getByTestId("signin-email");
  const hasDataTestIds = await signinEmail.isVisible({ timeout: 2000 }).catch(() => false);

  if (hasDataTestIds) {
    console.log("[Auth] Using data-testid selectors.");
    await signinEmail.fill(ADMIN_CREDENTIALS.email);
    await page.getByTestId("signin-password").fill(ADMIN_CREDENTIALS.password);
    await page.getByTestId("signin-submit").click();

    console.log("[Auth] Waiting for redirect...");
    if (waitForUrl) {
      await page.waitForURL(waitForUrl, { timeout: 15_000 });
    } else {
      await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    }
    console.log(`[Auth] Login successful, redirected to: ${page.url()}`);
    return;
  }

  // --- Strategy 2: UI navigation (handle SIGN IN / SIGN UP toggle) ---
  // The login page has two forms: SIGN IN and SIGN UP.
  // "Go to Sign In" button only works when `firstUserExists` is true (server-rendered).
  // If firstUserExists is false (stale cache), clicking it does nothing.
  // Workaround: use addInitScript to set active=0 (SIGN IN form) after page load.

  // Check if we see "Go to Sign In" button (means we're on SIGN UP form)
  const goToSignInBtn = page.locator('button:has-text("Go to Sign In")').first();
  const isOnSignUp = await goToSignInBtn.isVisible({ timeout: 3000 }).catch(() => false);

  if (isOnSignUp) {
    console.log("[Auth] On SIGN UP form. Attempting to switch to SIGN IN...");

    // Try clicking "Go to Sign In" first
    await goToSignInBtn.click();
    await page.waitForTimeout(2000);

    // Check if the form switched (look for sign-in specific elements)
    const stillOnSignUp = await page.locator('input[name="confirm_password"], input[name="token"]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (stillOnSignUp) {
      console.log("[Auth] 'Go to Sign In' didn't work (firstUserExists=false). Forcing SIGN IN form via JS...");

      // Force the component state to show SIGN IN form
      await page.evaluate(() => {
        // Try to find and trigger the handleSignInClick function via DOM events
        // The component uses Svelte 5 runes, so we need to dispatch a custom event
        // or directly manipulate the DOM to show the SIGN IN form

        // Method 1: Find the sign-in card and make it visible
        const cards = document.querySelectorAll('[class*="card"]');
        cards.forEach((card) => {
          // Look for the sign-in form card
          const emailInput = card.querySelector('input[name="email"]');
          const confirmInput = card.querySelector('input[name="confirm_password"]');
          if (emailInput && !confirmInput) {
            // This might be the sign-in form - make it visible
            (card as HTMLElement).style.display = '';
            (card as HTMLElement).style.transform = 'rotateY(0deg)';
          }
        });

        // Method 2: Try clicking the sign-in tab/indicator directly
        const signInTab = document.querySelector('[data-tab="0"], [data-active="0"]');
        if (signInTab) {
          (signInTab as HTMLElement).click();
        }
      });

      await page.waitForTimeout(1000);

      // Method 3: If still on SIGN UP, try navigating with a URL parameter
      const stillOnSignUp2 = await page.locator('input[name="confirm_password"]')
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (stillOnSignUp2) {
        console.log("[Auth] JS manipulation didn't work. Using form data approach...");

        // Last resort: submit the SIGN UP form with just email+password and isToken=false
        // The server should reject the sign-up (user exists) but we can check error message
        // Actually, let's try: set the form's active state by modifying the URL
        await page.goto("/login?mode=signin", { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
      }
    }
  }

  // --- Strategy 2: UI-based login ---

  // First, try to logout if already logged in
  await logout(page);

  // Navigate to login page
  console.log("[Auth] Navigating to /login...");
  await page.goto("/login", { waitUntil: "networkidle", timeout: 30_000 });

  // Check if we got redirected to setup (config incomplete)
  if (page.url().includes("/setup")) {
    throw new Error(`Setup is not complete. Cannot login - redirected to: ${page.url()}`);
  }

  // Reload the page to force fresh SSR (ensures firstUserExists is up-to-date)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Check if we're on the login selection page (SIGN IN / SIGN UP buttons)
  // Try data-testid first, then text-based fallback
  const signInIcon = page.getByTestId("signin-icon");
  const signInButton = page
    .locator('div[role="button"]:has-text("SIGN IN"), p:has-text("Sign In"), button:has-text("Go to Sign In"), button:has-text("Sign In")')
    .first();

  const signInIconVisible = await signInIcon.isVisible({ timeout: 2000 }).catch(() => false);
  const signInButtonVisible =
    !signInIconVisible && (await signInButton.isVisible({ timeout: 2000 }).catch(() => false));

  if (signInIconVisible) {
    console.log("[Auth] Clicking SIGN IN icon...");
    await signInIcon.click();
    await page.waitForTimeout(2000);
  } else if (signInButtonVisible) {
    console.log("[Auth] Clicking SIGN IN button (fallback)...");
    await signInButton.click();
    await page.waitForTimeout(2000);
  } else {
    // Provide debug info about available inputs
    const inputs = await page.locator("input").all();
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const name = await input.getAttribute("name");
      const testId = await input.getAttribute("data-testid");
      console.error(`[Auth]   Input ${i}: name=${name}, data-testid=${testId}`);
    }
    throw new Error("[Auth] No login form found on page.");
  }

  console.log("[Auth] Submitting login form...");

  // Wait for login form to be visible - use data-testid, fallback to name attributes
  console.log("[Auth] Waiting for signin-email field...");
  const signinEmail = page.getByTestId("signin-email");
  const emailByName = page.locator('input[name="email"]').first();

  if (await signinEmail.isVisible({ timeout: 5_000 }).catch(() => false)) {
    console.log("[Auth] Using data-testid selectors.");
    await signinEmail.fill(ADMIN_CREDENTIALS.email);
    await page.getByTestId("signin-password").fill(ADMIN_CREDENTIALS.password);
    await page.getByTestId("signin-submit").click();
  } else if (await emailByName.isVisible({ timeout: 5_000 }).catch(() => false)) {
    console.log("[Auth] Using name attribute selectors (fallback).");
    await emailByName.fill(ADMIN_CREDENTIALS.email);
    await page.locator('input[name="password"]').first().fill(ADMIN_CREDENTIALS.password);
    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click();
  } else {
    // Provide debug info about available inputs
    const inputs = await page.locator("input").all();
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const name = await input.getAttribute("name");
      const testId = await input.getAttribute("data-testid");
      console.error(`[Auth]   Input ${i}: name=${name}, data-testid=${testId}`);
    }
    throw new Error("[Auth] No login form found on page.");
  }

  console.log("[Auth] Submitting login form...");

  // Wait for redirect after successful login
  console.log("[Auth] Waiting for redirect...");
  if (waitForUrl) {
    await page.waitForURL(waitForUrl, { timeout: 15_000 });
  } else {
    // Wait until we're no longer on the login page
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  }
  console.log(`[Auth] Login successful, redirected to: ${page.url()}`);
}

/**
 * Logout current user
 * @param page - Playwright page object
 */
export async function logout(page: Page) {
  try {
    // Try to navigate to home/dashboard first to check if logged in
    await page.goto("/", { timeout: 10_000, waitUntil: "domcontentloaded" });

    // If we're on setup or login page, we're not logged in
    if (page.url().includes("/setup") || page.url().includes("/login")) {
      console.log("[Auth] Not logged in, skipping logout");
      return;
    }

    // Look for logout button or menu - try multiple selectors
    const logoutSelectors = [
      '[data-testid="sign-out-button"]',
      'button:has-text("Logout")',
      'button:has-text("Sign out")',
      'button:has-text("Log out")',
      'a:has-text("Logout")',
      'a:has-text("Sign out")',
      '[aria-label*="logout" i]',
      '[aria-label*="sign out" i]',
    ];

    for (const selector of logoutSelectors) {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`[Auth] Logging out using selector: ${selector}`);
        await button.click();
        await page.waitForURL(/\/(login|signup)/, { timeout: 5000 }).catch(() => {});
        return;
      }
    }

    console.log("[Auth] No logout button found, clearing cookies and localStorage");
    // If no logout button found, clear session manually
    await page.context().clearCookies();
    try {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch {
      // localStorage may be inaccessible on certain pages
    }
  } catch (error) {
    console.log("[Auth] Error during logout, continuing anyway:", error);
  }
}

/**
 * Ensure sidebar is visible on mobile viewports
 * On mobile (<768px), the sidebar is hidden by default
 * @param page - Playwright page object
 */
export async function ensureSidebarVisible(page: Page) {
  const viewport = page.viewportSize();
  const isMobile = viewport && viewport.width < 768;

  if (isMobile) {
    // Try to find and click the menu/hamburger button to open sidebar
    const menuButton = page
      .locator(
        'button[aria-label*="menu" i], button[aria-label*="sidebar" i], button[aria-label="Open Sidebar"]',
      )
      .first();
    const menuVisible = await menuButton.isVisible().catch(() => false);

    if (menuVisible) {
      await menuButton.click();
      await page.waitForTimeout(500);
      console.log("✓ Opened sidebar on mobile viewport");
      return true;
    }
  }
  return false;
}
