/**
 * @file src/routes/api/importData/+server.ts
 * @description API endpoint for importing collection data
 */

import { dbAdapter } from "@src/databases/db";
import { jobQueue } from "@src/services/jobs/job-queue-service";
import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";

export const POST = apiHandler(async ({ request, locals }) => {
  const { user, tenantId } = locals;

  // Require authentication
  if (!user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  if (!dbAdapter) {
    throw new AppError("Database adapter not initialized", 500, "DB_ADAPTER_MISSING");
  }

  const body = await request.json();
  const { collectionName, data, mode = "merge", duplicateStrategy = "skip", async = false } = body;

  // Validate required parameters
  if (!collectionName) {
    throw new AppError("Collection name is required", 400, "MISSING_COLLECTION_NAME");
  }

  if (!(data && Array.isArray(data))) {
    throw new AppError("Data must be an array", 422, "INVALID_DATA_FORMAT");
  }

  // Determine if we should process in background
  // Default to background for more than 50 items to prevent timeouts
  const shouldProcessInBackground = async || data.length > 50;

  if (shouldProcessInBackground) {
    const jobId = await jobQueue.dispatch(
      "import-data",
      {
        collectionName,
        data,
        mode,
        duplicateStrategy,
        tenantId,
      },
      tenantId || undefined,
    );

    if (jobId) {
      return json({
        success: true,
        message: "Import started in background",
        jobId,
        total: data.length,
        status: "pending",
      });
    } else {
      throw new AppError("Failed to dispatch background import job", 500, "JOB_DISPATCH_FAILED");
    }
  }

  // Synchronous Processing (only for small batches)
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  // Handle replace mode
  if (mode === "replace") {
    // Delete all existing documents
    const deleteResult = await dbAdapter.crud.deleteMany(collectionName, {}, { tenantId });
    if (!deleteResult.success) {
      logger.warn(`Failed to clear collection ${collectionName} for replace mode`);
    }
  }

  // Import each document
  for (const doc of data) {
    try {
      // Check for duplicates if strategy is skip
      if (duplicateStrategy === "skip" && doc._id) {
        const existing = await dbAdapter.crud.findOne(
          collectionName,
          { _id: doc._id },
          { tenantId },
        );
        if (existing.success && existing.data) {
          skipped++;
          continue;
        }
      }

      // Insert or update document
      const result = doc._id
        ? await dbAdapter.crud.upsert(collectionName, { _id: doc._id }, doc, tenantId)
        : await dbAdapter.crud.insert(collectionName, doc, tenantId);

      if (result.success) {
        imported++;
      } else {
        errors++;
      }
    } catch (error: any) {
      errors++;
    }
  }

  return json({
    success: true,
    imported,
    skipped,
    errors,
    total: data.length,
    status: "completed",
  });
});
