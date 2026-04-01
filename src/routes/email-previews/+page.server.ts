/**
 * @file src/routes/email-previews/+page.server.ts
 * @description Server-side logic for the email preview page.
 *
 * ### Props
 * - `user`: The authenticated user data.
 *
 * ### Features
 * - User authentication and authorization (now tenant-aware)
 * - Proper typing for user data
 *
 */

// Auth
import type { User } from "@src/databases/auth/types";
import { error } from "@sveltejs/kit";

// System Logger
import { logger } from "@utils/logger.server";
import { createEmail, emailList, sendEmail } from "better-svelte-email/preview";

// Create a global variable to store the fetch function for actions
let eventFetch: typeof globalThis.fetch;

// Define the return type for the load function.
// `emailList` from `better-svelte-email/preview` exposes:
// - `path: string`
// - `files: string[] | null`
// - `emails`, `components`, etc. as helper metadata.
// We mirror that shape here so `PageData` and `EmailPreview` agree.
interface PreviewData {
  components?: Record<string, unknown>;
  emails?: { name: string; path: string }[];
  files: string[] | null;
  path?: string | null;
  user?: User | null;
  [key: string]: unknown;
}

export async function load({
  locals,
  fetch,
}: {
  locals: App.Locals;
  fetch: typeof globalThis.fetch;
}): Promise<PreviewData> {
  const { user: userData, isAdmin } = locals;

  // Store the fetch function for use in actions
  eventFetch = fetch;

  // Permission check: only allow admins to view email previews
  if (!userData) {
    logger.warn("Unauthenticated attempt to access email previews");
    throw error(401, "Authentication required");
  }

  if (!isAdmin) {
    logger.warn(`Unauthorized attempt to access email previews by user: ${userData._id}`);
    throw error(403, "Insufficient permissions - admin access required");
  }

  const emailListData = await emailList({ path: "/src/components/emails" });

  return {
    user: userData,
    ...emailListData,
  };
}

// Core SveltyCMS services
import { LocalCMS } from "@src/routes/api/cms";

// ... (rest of imports)

export const actions = {
  ...createEmail,
  ...sendEmail({
    customSendEmailFunction: async ({ /* from, */ to, subject /* html */ }, event) => {
      // Extract template name from subject or use default
      const templateName = subject?.includes("Preview:")
        ? subject.replace("Preview:", "").trim()
        : "welcomeUser";

      logger.info("Email preview sending via Local API:", {
        recipientEmail: to,
        subject,
        templateName,
      });

      const previewProps = {
        username: "Preview User",
        email: to,
        sitename: "SveltyCMS (Preview)",
        hostLink: "http://localhost:5173",
      };

      try {
        const { locals } = event;
        const adapter = locals.dbAdapter || (await import("@src/databases/db")).dbAdapter;
        if (!adapter) throw new Error("Database adapter not available");

        const cms = new LocalCMS(adapter);
        const result = await cms.system.sendMail({
          recipientEmail: to,
          subject: subject || `Preview: ${templateName}`,
          templateName,
          props: previewProps,
          languageTag: "en",
        });

        if (result.success) {
          logger.info("Email preview sent successfully via Local API.");
        } else {
          logger.warn("Email preview Local API call reported not successful:", {
            message: result.message,
          });
        }
        return result;
      } catch (error) {
        logger.error("Failed to send email via Local API during preview", {
          error,
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  }),
};
