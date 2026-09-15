import { subscribe } from "@/lib/events";
import { reconcile } from "@/lib/orchestrator";
import { api, requireRun, requireUser } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = api(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireUser();
    const { id } = await params;
    const { run } = requireRun(ctx, id);
    // A client reconnecting to a run orphaned by a server restart should learn
    // that immediately rather than sit on an open stream that will never emit.
    reconcile(run);

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const send = (data: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            open = false;
          }
        };

        const unsubscribe = subscribe(id, send);
        const heartbeat = setInterval(() => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            open = false;
          }
        }, 15000);

        const close = () => {
          if (!open) return;
          open = false;
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        };

        request.signal.addEventListener("abort", close);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);
