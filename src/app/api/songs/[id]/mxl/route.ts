// app/api/songs/[id]/mxl/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { Buffer } from 'node:buffer';

/** Make a brand-new ArrayBuffer (no SharedArrayBuffer union) */
function toArrayBufferExact(u8: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out.buffer; // <- typed as ArrayBuffer
}

/** Normalize Supabase bytea to a fresh ArrayBuffer */
function normalizeToArrayBuffer(raw: unknown): ArrayBuffer {
  if (raw == null) throw new Error('song_mxl is null');

  // Most common: "\x..." hex string from Postgres bytea
  if (typeof raw === 'string') {
    if (raw.startsWith('\\x')) {
      const hex = raw.slice(2);
      const buf = Buffer.from(hex, 'hex');          // Node Buffer
      return toArrayBufferExact(new Uint8Array(buf));
    }
    // Fallback: base64 string (if you ever stored it that way)
    const buf = Buffer.from(raw, 'base64');
    return toArrayBufferExact(new Uint8Array(buf));
  }

  // Already a typed array from some driver layers
  if (raw instanceof Uint8Array) {
    return toArrayBufferExact(raw);
  }

  // Array<number> (rare)
  if (Array.isArray(raw)) {
    return toArrayBufferExact(Uint8Array.from(raw as number[]));
  }

  throw new Error(`Unsupported song_mxl type: ${typeof raw}`);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;                     // Next 15+: await params
    const songId = Number(id);
    if (!Number.isFinite(songId)) return new Response('Bad id', { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('song')                                      // snake_case table
      .select('song_mxl, song_title')                    // snake_case columns
      .eq('song_id', songId)
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ message: error.message, details: error.details, hint: error.hint, code: error.code }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!data) return new Response('Not found', { status: 404 });

    const ab = normalizeToArrayBuffer((data as any).song_mxl);
    const title = (data as any).song_title as string | undefined;

    // Optional debug: /api/songs/123/mxl?debug=1
    if (req.nextUrl.searchParams.get('debug')) {
      return new Response(
        JSON.stringify({ ok: true, byteLength: ab.byteLength }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(ab, {
      headers: {
        'Content-Type': 'application/vnd.recordare.musicxml', // .mxl
        'Content-Disposition': `inline; filename="${encodeURIComponent((title ?? 'score') + '.mxl')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
