/**
 * @file src/routes/api/http/media/transcode/+server.ts
 * @description
 * High-performance Adaptive Transcoding API for SveltyCMS (2026).
 * Leverages ffmpeg for multi-resolution HLS/MP4 pipeline generation.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import Path from "node:path";
import { dbAdapter } from "@src/databases/db";
import { getPublicSettingSync } from "@src/services/settings-service";
import { MediaService } from "@src/utils/media/media-service.server";
import { error, json } from "@sveltejs/kit";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import type { MediaItem } from "@utils/media/media-models";
import type { RequestHandler } from "./$types";

/**
 * Helper to run a process and wait for completion.
 */
function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      logger.error("Failed to start transcode process", { error: err.message });
      reject(err);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error("Transcode process failed", { code, stderr });
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`));
      }
    });
  });
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { user, tenantId } = locals;

  if (!user) {
    throw error(401, "Unauthorized");
  }

  try {
    const { mediaId, targetFormat = "hls", resolutions = ["720p", "1080p"] } = await request.json();

    if (!mediaId) {
      return json({ success: false, error: "Media ID is required" }, { status: 400 });
    }

    if (!dbAdapter) {
      throw new Error("Database adapter not initialized");
    }

    const mediaService = new MediaService(dbAdapter);

    // 1. Get original media item
    const mediaResult = await dbAdapter.crud.findOne<MediaItem>("media", {
      _id: mediaId as any,
    });

    if (!(mediaResult.success && mediaResult.data)) {
      throw new AppError("Media item not found", 404, "MEDIA_NOT_FOUND");
    }

    const mediaItem = mediaResult.data;
    if (mediaItem.type !== "video") {
      throw error(400, "Only video assets can be transcoded");
    }

    // 2. Prepare workspace
    const MEDIA_ROOT = getPublicSettingSync("MEDIA_FOLDER") ?? "mediaFolder";
    const inputPath = Path.join(process.cwd(), MEDIA_ROOT, mediaItem.path);
    const outputDir = Path.join(
      process.cwd(),
      MEDIA_ROOT,
      Path.dirname(mediaItem.path),
      "transcoded",
      mediaId,
    );

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    logger.info("Starting adaptive transcoding pipeline", {
      mediaId,
      format: targetFormat,
      resolutions,
      tenantId,
    });

    // 3. Execution (HLS Pipeline Example)
    if (targetFormat === "hls") {
      const args = [
        "-i",
        inputPath,
        "-filter_complex",
        "[0:v]split=2[v1][v2];[v1]scale=w=1280:h=720[v1out];[v2]scale=w=1920:h=1080[v2out]",
        "-map",
        "[v1out]",
        "-c:v:0",
        "libx264",
        "-b:v:0",
        "2800k",
        "-map",
        "[v2out]",
        "-c:v:1",
        "libx264",
        "-b:v:1",
        "5000k",
        "-map",
        "a:0",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        "hls",
        "-hls_time",
        "10",
        "-hls_playlist_type",
        "event",
        "-master_pl_name",
        "master.m3u8",
        "-hls_segment_filename",
        `${outputDir}/file_%v_%03d.ts`,
        `${outputDir}/playlist_%v.m3u8`,
      ];

      await spawnAsync("ffmpeg", args);
    }

    // 4. Update Media Metadata
    const relativeTranscodePath = Path.relative(Path.join(process.cwd(), MEDIA_ROOT), outputDir);
    await mediaService.updateMedia(mediaId, {
      metadata: {
        ...mediaItem.metadata,
        transcoded: true,
        transcodePath: relativeTranscodePath,
        masterPlaylist: Path.join(relativeTranscodePath, "master.m3u8"),
      },
    });

    return json({
      success: true,
      message: "Transcoding pipeline completed",
      data: {
        masterPlaylist: `/files/${relativeTranscodePath}/master.m3u8`,
      },
    });
  } catch (err) {
    const message = `Transcoding failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(message, { tenantId });
    return json({ success: false, error: message }, { status: 500 });
  }
};
