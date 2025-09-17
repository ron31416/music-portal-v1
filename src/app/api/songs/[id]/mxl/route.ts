// app/api/songs/[id]/mxl/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { Buffer } from 'node:buffer';

// Row shape for this endpoint
type SongRow = {
  song_mxl: string | Uint8Array | number[] | null;
  song_title: string | null;
};

/** Make a brand-new ArrayBuffer (no SharedArrayBuffer union) */
function toArrayBufferExact(u8: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out.buffer;
}

/** Normalize Supabase bytea-like values to a fresh ArrayBuffer */
function normalizeToArrayBuffer(raw: unknown): ArrayBuffer {
  if (raw == null) throw new Error('song_mxl is null');

  // Most common: "\x..." hex string from Postgres bytea
  if (typeof raw === 'string') {
    if (raw.startsWith('\\x')) {
      const hex = raw.slice(2);
      const buf = Buffer.from(hex, 'hex');
      return toArrayBufferExact(new Uint8Array(buf));
    }
    // Fallback: base64 string
    const buf = Buffer.from(raw, 'base64');
    return toArrayBufferExact(new Uint8Array(buf));
  }

  // Already a typed array
  if (raw instanceof Uint8Array) {
    return toArrayBufferExact(raw);
  }

  // Array<number>
  if (Array.isArray(raw)) {
    return toArrayBufferExact(Uint8Array.from(raw));
  }

  throw new Error(`Unsupported song_mxl type: ${typeof raw}`);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params; // Next 15+
    const songId = Number(id);
    if (!Number.isFinite(songId)) {
      return new Response('Bad id', { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('song')
      .select('song_mxl, song_title')
      .eq('song_id', songId)
      .single();

    if (error) {
      return new Response(
        JSON.stringify({
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!data) {
      return new Response('Not found', { status: 404 });
    }

    const row = data as SongRow;
    const ab = normalizeToArrayBuffer(row.song_mxl);
    const title = row.song_title ?? undefined;

    // Optional debug: /api/songs/:id/mxl?debug=1
    if (req.nextUrl.searchParams.get('debug')) {
      return new Response(
        JSON.stringify({ ok: true, byteLength: ab.byteLength }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(ab, {
      headers: {
        'Content-Type': 'application/vnd.recordare.musicxml', // .mxl bytes
        'Content-Disposition': `inline; filename="${encodeURIComponent(
          (title ?? 'score') + '.mxl'
        )}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
