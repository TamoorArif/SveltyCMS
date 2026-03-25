/**
 * @file src/services/jobs/import-jobs.ts
 * @description Background job handler for large-scale data imports.
 */

import { dbAdapter } from "@src/databases/db";
import { logger } from "@utils/logger.server";
import type { JobHandler } from "./job-queue-service";

export const importDataHandler: JobHandler = async (payload: {
  collectionName: string;
  data: any[];
  mode: "merge" | "replace";
  duplicateStrategy: "skip" | "overwrite";
  tenantId?: string;
}) => {
  const { collectionName, data, mode, duplicateStrategy, tenantId } = payload;

  if (!dbAdapter) {
    throw new Error("PERMANENT_FAILURE: Database adapter not initialized");
  }

  logger.info(
    `[ImportJob] Starting background import for ${collectionName} (${data.length} items)`,
    {
      tenantId,
    },
  );

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Handle replace mode
    if (mode === "replace") {
      const deleteResult = await dbAdapter.crud.deleteMany(collectionName, {}, { tenantId });
      if (!deleteResult.success) {
        logger.warn(`[ImportJob] Failed to clear collection ${collectionName} for replace mode`);
      }
    }

    // Process in chunks to avoid memory pressure and allow progress tracking (future)
    const chunkSize = 100;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);

      for (const doc of chunk) {
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
            logger.warn(`[ImportJob] Failed to import document in ${collectionName}`, {
              error: result.error,
              tenantId,
            });
          }
        } catch (innerError: any) {
          errors++;
          logger.error(`[ImportJob] Unexpected error importing document`, {
            error: innerError.message,
            tenantId,
          });
        }
      }
    }

    logger.info(
      `[ImportJob] Completed: ${imported} imported, ${skipped} skipped, ${errors} errors`,
      {
        collection: collectionName,
        tenantId,
      },
    );
  } catch (error: any) {
    logger.error(`[ImportJob] Critical failure during import: ${error.message}`, {
      collection: collectionName,
      tenantId,
    });
    throw error; // Re-throw to allow job queue to handle retries if applicable
  }
};
