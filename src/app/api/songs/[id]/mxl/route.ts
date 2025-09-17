// src/app/api/songs/[id]/mxl/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { Buffer } from 'node:buffer';

type SongRow = {
  song_mxl: string | Uint8Array | number[] | null;
  song_title: string | null;
};

function toArrayBufferExact(u8: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out.buffer;
}

function normalizeToArrayBuffer(raw: SongRow['song_mxl']): ArrayBuffer {
  if (raw === null || raw === undefined) {
    throw new Error('song_mxl is null');
  }
  if (typeof raw === 'string') {
    if (raw.startsWith('\\x')) {
      const hex = raw.slice(2);
      return toArrayBufferExact(new Uint8Array(Buffer.from(hex, 'hex')));
    }
    return toArrayBufferExact(new Uint8Array(Buffer.from(raw, 'base64')));
  }
  if (raw instanceof Uint8Array) {
    return toArrayBufferExact(raw);
  }
  if (Array.isArray(raw)) {
    return toArrayBufferExact(Uint8Array.from(raw));
  }
  throw new Error('Unsupported song_mxl type');
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const songId = Number(id);
    if (!Number.isFinite(songId)) {
      return new Response('Bad id', { status: 400 });
    }

    const resp = (await supabaseAdmin
      .from('song')
      .select('song_mxl, song_title')
      .eq('song_id', songId)
      .single()) as unknown as {
      data: SongRow | null;
      error: { message?: string; details?: string; hint?: string; code?: string } | null;
    };

    if (resp.error) {
      return new Response(
        JSON.stringify({
          message: resp.error.message ?? 'Query error',
          details: resp.error.details ?? null,
          hint: resp.error.hint ?? null,
          code: resp.error.code ?? null,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!resp.data) {
      return new Response('Not found', { status: 404 });
    }

    const bytes = normalizeToArrayBuffer(resp.data.song_mxl);
    const filename = `${resp.data.song_title ?? 'score'}.mxl`;

    // Dev-only debugger
    if (process.env.NODE_ENV !== 'production' && req.nextUrl.searchParams.get('debug')) {
      return new Response(
        JSON.stringify({ ok: true, byteLength: bytes.byteLength }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.recordare.musicxml',
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
