import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type CleanupRow = {
  cleanup_id: number;
  bucket_id: string;
  object_path: string;
};

Deno.serve(async (request: Request) => {
  const secret = request.headers.get("x-taggi-retention-secret") ?? "";
  if (!secret) return new Response("Unauthorized", { status: 401 });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response("Server configuration missing", { status: 500 });

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const retention = await client.rpc("taggi_run_chat_retention", { p_secret: secret });
  if (retention.error) return new Response("Unauthorized", { status: 401 });

  const batch = await client.rpc("taggi_chat_cleanup_batch", {
    p_secret: secret,
    p_limit: 100,
  });
  if (batch.error) return new Response(JSON.stringify({ error: batch.error.message }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

  let removed = 0;
  let failed = 0;
  for (const item of (batch.data ?? []) as CleanupRow[]) {
    const result = await client.storage.from(item.bucket_id).remove([item.object_path]);
    const success = !result.error;
    await client.rpc("taggi_chat_cleanup_complete", {
      p_secret: secret,
      p_cleanup_id: item.cleanup_id,
      p_success: success,
      p_error: result.error?.message ?? null,
    });
    if (success) removed += 1;
    else failed += 1;
  }

  return new Response(JSON.stringify({
    expiredMessages: retention.data ?? 0,
    removedFiles: removed,
    failedFiles: failed,
  }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
