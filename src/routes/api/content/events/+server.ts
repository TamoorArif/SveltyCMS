/**
 * @file src/routes/api/content/events/+server.ts
 * @description
 * Server-Sent Events (SSE) endpoint for real-time content structure updates.
 * Replaces client-side polling with push-based synchronization.
 */
import { eventBus, SystemEvents } from "@utils/event-bus";
import { logger } from "@utils/logger";

export const GET = async ({ request }: any) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Helper to send data
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          logger.debug("[SSE] Stream already closed, removing listener.");
          cleanup();
        }
      };

      // Listener for content updates
      const onContentUpdate = (data: any) => {
        logger.debug("[SSE] Pushing content update to client");
        send("message", data);
      };

      // Subscribe to central event bus
      eventBus.on(SystemEvents.CONTENT_UPDATE, onContentUpdate);

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        send("heartbeat", { t: Date.now() });
      }, 30000);

      const cleanup = () => {
        clearInterval(heartbeat);
        eventBus.off(SystemEvents.CONTENT_UPDATE, onContentUpdate);
        try {
          controller.close();
        } catch {}
      };

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        logger.debug("[SSE] Client disconnected");
        cleanup();
      });

      // Initial connection message
      send("connected", { status: "active", timestamp: Date.now() });
    },
    cancel() {
      logger.debug("[SSE] Stream cancelled");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
