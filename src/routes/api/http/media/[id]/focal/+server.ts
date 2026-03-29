/**
 * @file src/routes/api/http/media/[id]/focal/+server.ts
 * @description Quick focal point update API endpoint
 * Refactored to use MediaService directly for efficiency and security.
 */

import { error, json } from "@sveltejs/kit";
import { logger } from "@utils/logger.server";
import { apiHandler } from "@utils/api-handler";
import { dbAdapter } from "@src/databases/db";
import { MediaService } from "@src/utils/media/media-service.server";
import type { RequestHandler } from "./$types";

export const PATCH: RequestHandler = apiHandler(async ({ params, request, locals }) => {
  const { user, tenantId } = locals;
  if (!user) {
    throw error(401, "Unauthorized");
  }

  const { id } = params;
  if (!id) {
    throw error(400, "Media ID is required");
  }

  if (!dbAdapter) {
    throw new Error("Database adapter not initialized");
  }

  const body = await request.json();
  const { x, y } = body;

  // Validate coordinates
  if (typeof x !== "number" || typeof y !== "number") {
    throw error(400, "x and y must be numbers");
  }
  if (x < 0 || x > 100 || y < 0 || y > 100) {
    throw error(400, "x and y must be between 0 and 100");
  }

  const mediaService = new MediaService(dbAdapter);

  try {
    // Update only metadata.focalPoint directly via MediaService
    await mediaService.updateMedia(
      id,
      {
        metadata: {
          focalPoint: { x, y },
        },
      },
      tenantId,
    );

    logger.info("Focal point updated", {
      mediaId: id,
      focalPoint: { x, y },
      userId: user._id.toString(),
      tenantId,
    });

    return json({
      success: true,
      data: { focalPoint: { x, y } },
    });
  } catch (err) {
    logger.error("Error updating focal point", {
      error: err,
      mediaId: id,
      tenantId,
    });
    throw error(
      err instanceof Error && "status" in err ? (err as any).status : 500,
      (err as Error).message,
    );
  }
}) as any;
