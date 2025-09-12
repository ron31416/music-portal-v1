// src/app/api/health/route.ts
export const dynamic = "force-static"; // fast + cacheable

export async function GET() {
  return new Response(
    JSON.stringify({ ok: true, ts: new Date().toISOString() }),
    { headers: { "content-type": "application/json" } }
  );
}
