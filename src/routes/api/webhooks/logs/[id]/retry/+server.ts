/**
 * @file src/routes/api/webhooks/logs/[id]/retry/+server.ts
 * @description API endpoint for manually retrying a failed webhook delivery.
 */

import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";

export const POST = apiHandler(async ({ locals, params }) => {
  const { user, dbAdapter } = locals;
  if (!user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  if (!dbAdapter) throw new AppError("Database service unavailable", 503, "SERVICE_UNAVAILABLE");

  const jobId = params.id as import("@src/databases/db-interface").DatabaseId;
  if (!jobId) throw new AppError("Job ID is required", 400, "BAD_REQUEST");

  // 1. Fetch the failed job
  const jobResult = await dbAdapter.system.jobs.getById(jobId);
  if (!jobResult.success || !jobResult.data) {
    throw new AppError("Webhook log entry not found", 404, "NOT_FOUND");
  }

  const job = jobResult.data;
  if (job.taskType !== "webhook-delivery") {
    throw new AppError("Invalid task type", 400, "BAD_REQUEST");
  }

  // 2. Reset the job status to pending
  // This will make it eligible for the background worker to pick it up again
  const updateResult = await dbAdapter.system.jobs.update(jobId, {
    status: "pending",
    attempts: 0,
    lastError: `Manual retry initiated by ${user.email}`,
    nextRunAt: new Date(),
  });

  if (!updateResult.success) {
    throw new AppError("Failed to queue retry", 500, "RETRY_ERROR");
  }

  return json({
    success: true,
    message: "Webhook delivery queued for retry",
  });
});
