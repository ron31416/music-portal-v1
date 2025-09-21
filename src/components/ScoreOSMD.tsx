// src/components/ScoreOSMD.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

/* ---------- Props & Types ---------- */

interface Props {
  src: string;
  fillParent?: boolean; // default: true
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  topGutterPx?: number; // default: 3 (small white space at very top)
  debugShowAllMeasureNumbers?: boolean; // default: false (dev aid)
}

interface Band { top: number; bottom: number; height: number }

// Await OSMD.load(...) whether it returns void or a Promise.
// (No "maybe" checks needed.)
async function awaitLoad(
  osmd: OpenSheetMusicDisplay,
  input: string | Document | ArrayBuffer | Uint8Array
): Promise<void> {
  type LoadInput = string | Document | ArrayBuffer | Uint8Array;
  type OSMDHasLoad = { load: (i: LoadInput) => void | Promise<unknown> };

  const o = osmd as unknown as OSMDHasLoad;
  await Promise.resolve(o.load(input));
}

// --- Instance-scoped afterPaint factory (safe for multiple components) ---
function makeAfterPaint(outer: HTMLDivElement) {
  return function afterPaintLocal(label?: string, timeoutMs = 300): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const t0 =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      function finish(why: "raf" | "timeout" | "hidden" | "message" | "ceiling"): void {
        if (done) { return; }
        done = true;
        try {
          outer.dataset.osmdAfterpaint = `${label ?? ""}:${why}`;
          const now =
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          const ms = Math.round(now - t0);
          outer.dataset.osmdAfterpaintMs = String(ms);
          const box = document.querySelector<HTMLPreElement>('pre[data-osmd-log="1"]');
          if (box) {
            box.textContent += `[ap] ${label ?? ""} -> ${why} (${ms}ms)\n`;
            box.scrollTop = box.scrollHeight;
          }
        } catch {}
        resolve();
      }

      if (document.visibilityState !== "visible") {
        setTimeout(() => finish("hidden"), 0);
        return;
      }

      try {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => finish("raf"));
        });
      } catch {}

      setTimeout(() => finish("timeout"), timeoutMs);

      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => {
          ch.port1.onmessage = null;
          finish("message");
        };
        ch.port2.postMessage(1);
      } catch {}

      setTimeout(() => finish("ceiling"), Math.max(timeoutMs * 4, 1200));
    });
  };
}

function getSvg(outer: HTMLDivElement): SVGSVGElement | null {
  return outer.querySelector("svg");
}

function withUntransformedSvg<T>(outer: HTMLDivElement, fn: (svg: SVGSVGElement) => T): T | null {
  const svg = getSvg(outer);
  if (!svg) {
    return null;
  }
  const prev = svg.style.transform;
  const prevOrigin = svg.style.transformOrigin;
  svg.style.transform = "none";
  svg.style.transformOrigin = "top left";
  try {
    return fn(svg);
  } finally {
    svg.style.transform = prev;
    svg.style.transformOrigin = prevOrigin;
  }
}

/** Very small debug HUD + data-* breadcrumbs (shows even when console is stripped) */
function hud(outer: HTMLDivElement, text: string) {
  let el = outer.querySelector<HTMLDivElement>('[data-osmd-hud]');
  if (!el) {
    el = document.createElement('div');
    el.dataset.osmdHud = '1';
    Object.assign(el.style, {
      position: 'absolute',
      top: '6px',
      right: '6px',
      zIndex: '99999',
      font: '12px/1.2 monospace',
      color: '#0f0',
      background: 'rgba(0,0,0,0.6)',
      padding: '4px 6px',
      borderRadius: '6px',
      pointerEvents: 'none',
        } as CSSStyleDeclaration);
    outer.appendChild(el);
  }
  el.textContent = text;
}

/** Append a line into a fixed on-page console (no DevTools required) */
function tapLog(outer: HTMLDivElement, line: string) {
  let box = document.querySelector<HTMLPreElement>('pre[data-osmd-log="1"]');
  if (!box) {
    box = document.createElement('pre');
    box.dataset.osmdLog = '1';
    Object.assign(box.style, {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '100001',
      maxWidth: '80vw', maxHeight: '42vh', overflow: 'auto',
      background: 'rgba(0,0,0,0.75)', color: '#0f0', padding: '6px 8px',
      borderRadius: '8px', font: '11px/1.35 monospace', whiteSpace: 'pre-wrap'
    } as CSSStyleDeclaration);
    document.body.appendChild(box);
  }
  const ts = new Date().toISOString().split('T')[1]?.split('.')[0] ?? '';
  box.textContent += `[${ts}] ${line}\n`;
  box.scrollTop = box.scrollHeight;
}

/** Wait for web fonts to be ready (bounded; prevents rare long hangs) */
async function waitForFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      await Promise.race([
        fonts.ready,
        new Promise<void>(resolve => setTimeout(resolve, 1500)),
      ]);
    }
  } catch {
    /* no-op */
  }
}

/** Track the *visible* viewport height (accounts for mobile URL/tool bars) */
function useVisibleViewportHeight() {
  const vpRef = useRef<number>(0);
  const [, force] = React.useReducer((x: number) => x + 1, 0);


  useEffect(() => {
    const update = () => {
      // prefer visualViewport when available, otherwise fall back to doc height
      const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
      const vvH = vv ? Math.floor(vv.height) : 0;
      const docH = Math.floor(document.documentElement?.clientHeight || 0);
      const h = (vvH && vvH > 0) ? vvH : docH;
      if (h && h !== vpRef.current) {
        vpRef.current = h;
        force();
      }
    };
    update();

    // visualViewport when present
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    // always also listen to window.resize (desktop / Safari / VV quirks)
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return vpRef; // latest visible height in px
}

// Heuristics to improve first-page layout and prevent system splitting on phones
function dynamicBandGapPx(outer: HTMLDivElement): number {
  const h = outer.clientHeight || 0;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  let gap = 18;            // base
  if (h <= 750) {
    gap += 6;
  }  // small visible height => merge more
  if (dpr >= 2) {
    gap += 4;
  }  // high-DPR rounding safety
  return gap;
}

function isTitleLike(first: Band | undefined, rest: Band[]): boolean {
  if (!first || rest.length === 0) {
    return false;
  }
  const sample = rest
    .slice(0, Math.min(5, rest.length))
    .map((b) => b.height)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (sample.length === 0) {
    return false;
  }
  const idx = Math.floor(sample.length / 2);
  const median = sample[idx];
  if (median === undefined) {
    return false;
  } // handles strict noUncheckedIndexedAccess
  return first.height < Math.max(36, 0.6 * median);
}

/** Cluster OSMD <g> to “systems” and measure them relative to wrapper */
function measureSystemsPx(outer: HTMLDivElement, svgRoot: SVGSVGElement): Band[] {
  const pageRoots = Array.from(
    svgRoot.querySelectorAll<SVGGElement>(
      'g[id^="osmdCanvasPage"], g[id^="Page"], g[class*="Page"], g[class*="page"]'
    )
  );
  const roots: Array<SVGGElement | SVGSVGElement> = pageRoots.length ? pageRoots : [svgRoot];

  const hostTop = outer.getBoundingClientRect().top;
  interface Box { top: number; bottom: number; height: number; width: number }
  const boxes: Box[] = [];

  for (const root of roots) {
    for (const g of Array.from(root.querySelectorAll<SVGGElement>("g"))) {
      const r = g.getBoundingClientRect();
      if (!Number.isFinite(r.top) || !Number.isFinite(r.height) || !Number.isFinite(r.width)) {
        continue;
      }
      // Looser thresholds so very narrow measures on phones are still captured
      const MIN_H = 2;   // was 8 → 4 → 2 (capture ultra-thin groups)
      const MIN_W = 8;   // was 40 → 16 → 8
      if (r.height < MIN_H || r.width < MIN_W) {
        continue;
      }
      boxes.push({
        top: r.top - hostTop,
        bottom: r.bottom - hostTop,
        height: r.height,
        width: r.width,
      });
    }
  }

  boxes.sort((a, b) => a.top - b.top);

  const GAP = dynamicBandGapPx(outer);
  const bands: Band[] = [];
  for (const b of boxes) {
    const last = bands.length ? bands[bands.length - 1] : undefined;
    if (!last || b.top - last.bottom > GAP) {
      bands.push({ top: b.top, bottom: b.bottom, height: b.height });
    } else {
      last.top = Math.min(last.top, b.top);
      last.bottom = Math.max(last.bottom, b.bottom);
      last.height = last.bottom - last.top;
    }
  }
  return bands;
}

/** Compute page start *indices* so each page shows only full systems */
function computePageStartIndices(bands: Band[], viewportH: number): number[] {
  if (bands.length === 0 || viewportH <= 0) {
    return [0];
  }

  const starts: number[] = [];
  let i = 0;
  const fuseTitle = isTitleLike(bands[0], bands.slice(1));

  while (i < bands.length) {
    const current = bands[i];
    if (!current) {
      break;
    }

    const startTop = current.top;
    let last = i;

    while (last + 1 < bands.length) {
      const next = bands[last + 1];
      if (!next) { break; }

      const isFirstPage = starts.length === 0 && i === 0;
      const slack = isFirstPage && fuseTitle
        ? Math.max(12, Math.round(viewportH * 0.06))
        : 0;

      // Optional tweak: on first page, try to fit title + two full systems
      if (isFirstPage) {
        const systemsToTry = 2;        // title + 2 systems
        const endIdx = i + systemsToTry;
        const endBand = bands[endIdx];
        if (endBand && (endBand.bottom - startTop) <= (viewportH + slack)) {
          last = endIdx;
          continue; // keep scanning from the new 'last'
        }
      }

      if (next.bottom - startTop <= viewportH + slack) {
        last++;
      } else {
        break;
      }
    }

    starts.push(i);
    i = last + 1;
  }

  return starts.length ? starts : [0];
}

/* ---------- Component ---------- */

export default function ScoreOSMD({
  src,
  fillParent = true,
  height = 600,
  className = "",
  style,
  topGutterPx = 3, // small white strip at the very top
  debugShowAllMeasureNumbers = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  
  const bandsRef = useRef<Band[]>([]);
  const pageStartsRef = useRef<number[]>([0]);
  const pageIdxRef = useRef<number>(0);
  const readyRef = useRef<boolean>(false);

  const DEFAULT_BUSY = "Please wait…";

  // Busy lock (blocks input while OSMD works)
  const [busy, setBusy] = useState<boolean>(false);
  const [busyMsg, setBusyMsg] = useState<string>(DEFAULT_BUSY);

  // Debounce + reentry guards for resize/viewport changes
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const resizeTimerRef = useRef<number | null>(null); // ResizeObserver debounce
  const vvTimerRef = useRef<number | null>(null);     // visualViewport debounce

  const handledWRef = useRef<number>(-1);
  const handledHRef = useRef<number>(-1);

  // add near handledWRef/handledHRef
  const reflowRunningRef = useRef(false);   // guards width reflow
  const reflowAgainRef = useRef<"none" | "width" | "height">("none");
  const repagRunningRef = useRef(false);    // guards height-only repagination

  // --- spinner ownership to prevent "stuck overlay" across overlapping calls ---
  const spinnerOwnerRef = useRef<symbol | null>(null);

  const spinnerFailSafeRef = useRef<number | null>(null);


    // Track browser zoom relative to mount
  const baseScaleRef = useRef<number>(1);
  const zoomFactorRef = useRef<number>(1);

  const computeZoomFactor = useCallback((): number => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const scaleNow = (vv && typeof vv.scale === "number") ? vv.scale : (window.devicePixelRatio || 1);
    const base = baseScaleRef.current || 1;
    const raw = scaleNow / base;
    if (!Number.isFinite(raw) || raw <= 0) { return 1; }
    // Clamp to a sane range so weird browser values don’t explode layout
    return Math.max(0.5, Math.min(3, raw));
  }, []);

  // Apply current browser-derived zoom to OSMD (used right before render)
  const applyZoomFromRef = useCallback((): void => {
    const osmd = osmdRef.current;
    if (!osmd) { return; }

    const z = zoomFactorRef.current;
    if (typeof z !== "number" || !Number.isFinite(z)) { return; }

    const clamped = Math.max(0.5, Math.min(3, z));

    // Thanks to the module augmentation, this is fully typed.
    const current = osmd.Zoom;
    if (current === undefined || Math.abs(current - clamped) > 0.001) {
      osmd.Zoom = clamped;
    }
  }, []);


  // convenience logger that writes into the page (not DevTools)
  const log = useCallback((msg: string) => {
    const outer = wrapRef.current;
    if (outer) { tapLog(outer, msg); }
  }, []);

  const mark = useCallback((msg: string) => {
    const outer = wrapRef.current;
    if (!outer) { return; }
    tapLog(outer, msg);  // bottom-left on-page console
    hud(outer, msg);     // tiny HUD top-right
  }, []);

  const hideBusy = useCallback(() => {
    setBusy(false);
    setBusyMsg(DEFAULT_BUSY);
    const outer = wrapRef.current;
    if (outer) { tapLog(outer, "busy:off"); }
  }, [DEFAULT_BUSY]);

  // ---- callback ref proxies (used by queued setTimeouts) ----
  const reflowFnRef = useRef<
    (resetToFirst?: boolean, showBusy?: boolean) => void | Promise<void>
  >(() => {});
  const repagFnRef = useRef<
    (resetToFirst?: boolean, showBusy?: boolean) => void
  >(() => {});

  const vpHRef = useVisibleViewportHeight();

  const getViewportH = useCallback((outer: HTMLDivElement): number => {
    const v = vpHRef.current || 0;                              // visualViewport
    const outerH = outer.clientHeight || 0;                     // wrapper height
    const docH = Math.floor(document.documentElement?.clientHeight || 0); // fallback

    // Prefer wrapper height; fall back to visualViewport; then to document
    const base = outerH > 0 ? outerH : (v > 0 ? v : docH);

    // Always return a positive, integer px height minus the gutter
    return Math.max(1, Math.floor(base) - Math.max(0, topGutterPx));
  }, [vpHRef, topGutterPx]);

  const bottomPeekPad = useCallback(
    () => ((window.devicePixelRatio || 1) >= 2 ? 6 : 5), // same pad everywhere
    []
  );

  const pageHeight = useCallback(
    (outer: HTMLDivElement) => Math.max(1, getViewportH(outer) - bottomPeekPad()),
    [getViewportH, bottomPeekPad]
  );

  // --- Unify pagination height (memoized so identity is stable) ---
  const FILL_SLOP_PX = 8; // keep your existing slop
  const getPAGE_H = React.useCallback(
    (outer: HTMLDivElement) => pageHeight(outer) + FILL_SLOP_PX,
    [pageHeight]
  );

  const renderWithEffectiveWidth = useCallback((
    outer: HTMLDivElement,
    osmd: OpenSheetMusicDisplay
  ): void => {
    const host = hostRef.current;
    if (!host || !outer) { return; }

    // Use the zoom that was computed by the caller just before render.
    applyZoomFromRef();
    const zf = Math.min(3, Math.max(0.5, zoomFactorRef.current || 1));

    // Compute the layout width in *unzoomed* CSS px.
    const hostW = Math.max(1, Math.floor(outer.clientWidth));
    const layoutW = Math.max(1, Math.floor(hostW / zf));

    // Breadcrumbs for debugging/HUD
    outer.dataset.osmdZf = String(zf);
    outer.dataset.osmdLayoutW = String(layoutW);

    // Temporarily let width control layout: release the right edge,
    // apply a fixed width, force a layout read, render, then restore.
    const prevLeft  = host.style.left;
    const prevRight = host.style.right;
    const prevWidth = host.style.width;

    host.style.left = "0";
    host.style.right = "auto";
    host.style.width = `${layoutW}px`;

    // Ensure the new width is observed this frame.
    void host.getBoundingClientRect();

    try {
      osmd.render();
    } finally {
      host.style.left  = prevLeft;
      host.style.right = prevRight;
      host.style.width = prevWidth;
    }

    // Do NOT force responsive width; let OSMD’s intrinsic width/height + Zoom rule.
    // We only ensure a stable transform origin for paging.
    const svg = getSvg(outer);
    if (svg) {
      svg.style.transformOrigin = "top left";
    }
  }, [applyZoomFromRef]);

  /** Apply a page index */
  const applyPage = useCallback(
    (pageIdx: number, depth: number = 0): void => {
      if (depth > 3) {           // hard stop if anything oscillates
        console.warn("[applyPage] bailout at depth>3");
        return;
      }
      const outer = wrapRef.current;
      if (!outer) {
        return;
      }

      const svg = getSvg(outer);
      if (!svg) {
        return;
      }

      const bands = bandsRef.current;
      const starts = pageStartsRef.current;
      if (bands.length === 0 || starts.length === 0) {
        return;
      }

      const pages = starts.length;
      const clampedPage = Math.max(0, Math.min(pageIdx, pages - 1));
      pageIdxRef.current = clampedPage;

      const startIndex = starts[clampedPage] ?? 0;
      const startBand = bands[startIndex];
      if (!startBand) {
        return;
      }

      const ySnap = Math.ceil(startBand.top);

      svg.style.transform = `translateY(${-ySnap + Math.max(0, topGutterPx)}px)`;
      svg.style.transformOrigin = "top left";
      svg.style.willChange = "transform";

      const nextStartIndex = clampedPage + 1 < starts.length ? (starts[clampedPage + 1] ?? -1) : -1;

      const BOTTOM_PEEK_PAD = bottomPeekPad();
      const hVisible = pageHeight(outer);

      // NEW: unify all repagination to one height
      const TOL = (window.devicePixelRatio || 1) >= 2 ? 2 : 1; // tiny tolerance
      const PAGE_H = getPAGE_H(outer);                         // unified height

      // If the top of the next system is already inside the window...
      if (nextStartIndex >= 0) {
        const nextBand = bands[nextStartIndex];
        if (nextBand) {
          const nextTopRel = nextBand.top - startBand.top;

          if (nextTopRel <= hVisible - TOL) {
            const fresh = computePageStartIndices(bands, PAGE_H);
            if (fresh.length) {
              // lower bound: first start >= startIndex
              let lb = fresh.length - 1;
              for (let i = 0; i < fresh.length; i++) {
                const s = fresh[i] ?? 0;
                if (s >= startIndex) { lb = i; break; }
              }

              const noChange =
                fresh.length === starts.length &&
                fresh.every((v, i) => v === (starts[i] ?? -1)) &&
                lb === clampedPage;

              if (!noChange) {
                pageStartsRef.current = fresh;
                applyPage(lb, depth + 1); // ← pass recursion depth
                return;
              }
            }
          }
        }
      }

      // --- last-page margin rule: push final system to a new page if too close ---
      const LAST_PAGE_BOTTOM_PAD_PX = 12; // try 10–14

      if (nextStartIndex < 0) { // we are on the last page
        let cutIdx = -1;

        for (let i = startIndex; i < bands.length; i++) {
          const b = bands[i];
          if (!b) { continue; }                        // TS guard: b is Band
          const relBottom = b.bottom - startBand.top; // bottom within current page

          if (relBottom > hVisible - LAST_PAGE_BOTTOM_PAD_PX) {
            cutIdx = i;
            break;
          }
        }

        if (cutIdx !== -1 && cutIdx > startIndex) {
          const freshStarts = starts.slice(0, clampedPage + 1);
          if (freshStarts[freshStarts.length - 1] !== cutIdx) {
            freshStarts.push(cutIdx);
            pageStartsRef.current = freshStarts;
          }
          applyPage(clampedPage, depth + 1);                    // ← depth+1
          return;
        }
        // If cutIdx === startIndex, the single system is taller than the page; do nothing.
      }


      // ---- stale page-starts guard: recompute if last-included doesn't fit ----

      const SAFETY = (window.devicePixelRatio || 1) >= 2 ? 12 : 10;  // roughly MASK_BOTTOM_SAFETY_PX + (PEEK_GUARD - 2), avoids edge-shave on Hi-DPR
      const assumedLastIdx = (clampedPage + 1 < starts.length)
        ? Math.max(startIndex, (starts[clampedPage + 1] ?? startIndex) - 1)
        : Math.max(startIndex, bands.length - 1);

      const assumedLast = bands[assumedLastIdx];
      const lastBottomRel = assumedLast ? (assumedLast.bottom - startBand.top) : 0;

      if (assumedLast && lastBottomRel > hVisible - SAFETY) {
        const freshStarts = computePageStartIndices(bands, PAGE_H); // ← PAGE_H
        if (freshStarts.length) {
          let nearest = 0, best = Number.POSITIVE_INFINITY;
          for (let i = 0; i < freshStarts.length; i++) {
            const s = freshStarts[i] ?? 0;
            const d = Math.abs(s - startIndex);
            if (d < best) { best = d; nearest = i; }
          }
          const noChange =
            freshStarts.length === starts.length &&
            freshStarts.every((v, i) => v === (starts[i] ?? -1)) &&
            nearest === clampedPage;

          if (!noChange) {
            pageStartsRef.current = freshStarts;
            applyPage(nearest, depth + 1);                     // ← depth+1
            return;
          }
        }
      }

      // ---- masking: hide anything that belongs to the next page ----
      const MASK_BOTTOM_SAFETY_PX = 12;
      const PEEK_GUARD = (window.devicePixelRatio || 1) >= 2 ? 7 : 5; // was 4/3

      const maskTopWithinMusicPx = (() => {
        // Last page → never mask; show full height
        if (nextStartIndex < 0) { return hVisible; }

        const lastIncludedIdx = Math.max(startIndex, nextStartIndex - 1);
        const lastBand = bands[lastIncludedIdx];
        const nextBand = bands[nextStartIndex];
        if (!lastBand || !nextBand) { return hVisible; }

        const relBottom  = lastBand.bottom - startBand.top;
        const nextTopRel = nextBand.top    - startBand.top;

        // If nothing from the next page peeks into the viewport, don't mask at all.
        if (nextTopRel >= hVisible - PEEK_GUARD - 1) { return hVisible; }

        // Otherwise, hide just the peeking sliver.
        const nudge = (window.devicePixelRatio || 1) >= 2 ? 3 : 2;
        const low  = Math.ceil(relBottom) + MASK_BOTTOM_SAFETY_PX - nudge;
        const high = Math.floor(nextTopRel) - PEEK_GUARD;

        if (low > high) {
          const fresh = computePageStartIndices(bands, PAGE_H);
          if (fresh.length) {
            let nearest = 0, best = Number.POSITIVE_INFINITY;
            for (let i = 0; i < fresh.length; i++) {
              const s = fresh[i] ?? 0;
              const d = Math.abs(s - startIndex);
              if (d < best) { best = d; nearest = i; }
            }
            const same =
              fresh.length === starts.length &&
              fresh.every((v, i) => v === (starts[i] ?? -1)) &&
              nearest === clampedPage;
            if (!same) {
              pageStartsRef.current = fresh;
              applyPage(nearest, depth + 1);
              return hVisible;
            }
          }
        }

        const m = Math.min(hVisible, Math.max(0, Math.max(low, Math.min(high, hVisible))));
        return Math.floor(m);
      })();


      // Breadcrumbs + HUD (no console needed)
      outer.dataset.osmdLastApply = String(Date.now());
      outer.dataset.osmdPage = String(pageIdxRef.current);
      outer.dataset.osmdMaskTop = String(maskTopWithinMusicPx);
      outer.dataset.osmdPages  = String(pages);
      outer.dataset.osmdStarts = starts.slice(0, 12).join(',');
      outer.dataset.osmdTy     = String(-ySnap + Math.max(0, topGutterPx));
      outer.dataset.osmdH      = String(hVisible);
      hud(outer, `apply • page:${outer.dataset.osmdPage} • bands:${bands.length} • pages:${pageStartsRef.current.length} • maskTop:${maskTopWithinMusicPx}`);

      tapLog(
        outer,
        `apply page:${clampedPage+1}/${pages} start:${startIndex} nextStart:${nextStartIndex} h:${hVisible} maskTop:${maskTopWithinMusicPx}`
      );
      
      // eslint-disable-next-line no-console
      console.log("[ScoreOSMD/applyPage]", {
        pageIdx: pageIdxRef.current,
        startIndex,
        nextStartIndex,
        hVisible,
        ySnap,
        maskTopWithinMusicPx,
        lastIncludedIdx: nextStartIndex >= 0 ? Math.max(startIndex, nextStartIndex - 1) : null,
        relBottom: (nextStartIndex >= 0 && bands[Math.max(startIndex, nextStartIndex - 1)])
          ? (bands[Math.max(startIndex, nextStartIndex - 1)]!.bottom - startBand.top)
          : null,
        nextTopRel: (nextStartIndex >= 0 && bands[nextStartIndex])
          ? (bands[nextStartIndex]!.top - startBand.top)
          : null,
      });


      let mask = outer.querySelector<HTMLDivElement>("[data-osmd-mask='1']");
      if (!mask) {
        mask = document.createElement("div");
        mask.dataset.osmdMask = "1";
        mask.style.position = "absolute";
        mask.style.left = "0";
        mask.style.right = "0";
        mask.style.top = "0";
        mask.style.bottom = "0";
        mask.style.background = "#fff";
        mask.style.pointerEvents = "none";
        mask.style.zIndex = "10";
        outer.appendChild(mask);
      }
      mask.style.top = `${Math.max(0, topGutterPx) + maskTopWithinMusicPx}px`;

      let bottomCutter = outer.querySelector<HTMLDivElement>("[data-osmd-bottomcutter='1']");
      if (!bottomCutter) {
        bottomCutter = document.createElement("div");
        bottomCutter.dataset.osmdBottomcutter = "1";
        Object.assign(bottomCutter.style, {
          position: "absolute",
          left: "0",
          right: "0",
          bottom: "0",
          height: `${BOTTOM_PEEK_PAD}px`,
          background: "#fff",
          pointerEvents: "none",
          zIndex: "6",
        } as CSSStyleDeclaration);
        outer.appendChild(bottomCutter);
      } else {
        bottomCutter.style.height = `${BOTTOM_PEEK_PAD}px`;
      }

      let topCutter = outer.querySelector<HTMLDivElement>("[data-osmd-topcutter='1']");
      if (!topCutter) {
        topCutter = document.createElement("div");
        topCutter.dataset.osmdTopcutter = "1";
        topCutter.style.position = "absolute";
        topCutter.style.left = "0";
        topCutter.style.right = "0";
        topCutter.style.top = "0";
        topCutter.style.height = `${Math.max(0, topGutterPx)}px`;
        topCutter.style.background = "#fff";
        topCutter.style.pointerEvents = "none";
        topCutter.style.zIndex = "6";
        outer.appendChild(topCutter);
      } else {
        topCutter.style.height = `${Math.max(0, topGutterPx)}px`;
      }
    },
    [pageHeight, topGutterPx, bottomPeekPad, getPAGE_H]
  );

  // --- HEIGHT-ONLY REPAGINATION (no OSMD re-init) ---
  const recomputePaginationHeightOnly = useCallback(
    (resetToFirst: boolean = false, withSpinner: boolean = false): void => {
      const outer = wrapRef.current;
      if (!outer) { return; }

      const ap = makeAfterPaint(outer);

      if (repagRunningRef.current) { return; }   // prevent overlap
      repagRunningRef.current = true;

      outer.dataset.osmdRecompute = String(Date.now());
      const bands = bandsRef.current;
      if (bands.length === 0) { repagRunningRef.current = false; return; }

      try {
        if (withSpinner) {
          setBusyMsg(DEFAULT_BUSY);
          setBusy(true);
        }

        const H = getPAGE_H(outer);
        const starts = computePageStartIndices(bands, H);
        const oldStarts = pageStartsRef.current;

        hud(outer, `recompute • h:${H} • bands:${bands.length} • old:${oldStarts.join(',')} • new:${starts.join(',')} • page:${pageIdxRef.current}`);

        pageStartsRef.current = starts;
        outer.dataset.osmdPages = String(starts.length);

        if (resetToFirst) {
          applyPage(0);
          ap('repag:first').then(() => applyPage(0));
          hud(outer, `recompute • applied page 1 • pages:${starts.length}`);
          return;
        }

        const oldPage = pageIdxRef.current;
        const oldStartIdx = oldStarts.length
          ? (oldStarts[Math.max(0, Math.min(oldPage, oldStarts.length - 1))] ?? 0)
          : 0;

        let nearest = 0, best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < starts.length; i++) {
          const s = starts[i]; if (s === undefined) { continue; }
          const d = Math.abs(s - oldStartIdx);
          if (d < best) { best = d; nearest = i; }
        }
        applyPage(nearest);
      } finally {
        if (withSpinner) {
          hideBusy(); // clear overlay + any pending fail-safe
        }
        // If a width change arrived while we were repaginating, honor it once,
        // but do it *without* a spinner to avoid perceived "stuck" overlay loops.
        if (reflowAgainRef.current === "width") {
          reflowAgainRef.current = "none";
          setTimeout(() => { reflowFnRef.current(true, false); }, 0);
        }
        repagRunningRef.current = false; // release the guard
      }
    },
    [applyPage, getPAGE_H, hideBusy]
  );

  // keep ref pointing to latest repagination callback
  useEffect(() => {
    repagFnRef.current = recomputePaginationHeightOnly;
  }, [recomputePaginationHeightOnly]);

  // --- WIDTH REFLOW (OSMD render at new width) ---
  const reflowOnWidthChange = useCallback(
    async (resetToFirst: boolean = false, withSpinner: boolean = false): Promise<void> => {
      const outer = wrapRef.current;
      const osmd  = osmdRef.current;
      if (!outer || !osmd) { return; }

      const ap = makeAfterPaint(outer);

      // If a width reflow is in progress, queue exactly one follow-up and bail.
      if (reflowRunningRef.current) {
        reflowAgainRef.current = "width";
        log(`reflow: queued while running (reset=${resetToFirst}, spin=${withSpinner})`);
        return;
      }
      reflowRunningRef.current = true;

      // If caller didn’t request spinner but something else has us busy, queue and bail.
      if (busyRef.current && !withSpinner) {
        reflowRunningRef.current = false;
        reflowAgainRef.current = "width";
        setTimeout(() => reflowFnRef.current(true, false), 0);
        log(`reflow: deferred because busy (no spinner)`);
        return;
      }

      const token = Symbol('spin');

      outer.dataset.osmdPhase = 'start';
      const run = (Number(outer.dataset.osmdRun || '0') + 1);
      outer.dataset.osmdRun = String(run);
      mark(`reflow:start#${run} reset=${resetToFirst} spin=${withSpinner}`);

      // Watchdog: log current phase every 2s while this run is active
      const wd = window.setInterval(() => {
        if (outer) { tapLog(outer, `watchdog: phase=${outer.dataset.osmdPhase ?? 'unset'}`); }
      }, 2000);
      // ================================================
      try {
        log(`reflow:start reset=${resetToFirst} spin=${withSpinner} dpr=${window.devicePixelRatio} w=${outer.clientWidth} h=${outer.clientHeight}`);
        outer.dataset.osmdPhase = 'pre-spinner';

        if (withSpinner) {
          // mark who owns the spinner
          spinnerOwnerRef.current = token;

          setBusyMsg(DEFAULT_BUSY);
          setBusy(true);

          outer.dataset.osmdPhase = "spinner-requested";
          mark("spinner-requested");

          await Promise.race([
            // two rAFs → one full frame where the overlay can actually paint
            new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
            // microtask bounce (fast path on some browsers)
            new Promise<void>(r => {
              try {
                const ch = new MessageChannel();
                ch.port1.onmessage = () => r();
                ch.port2.postMessage(1);
              } catch { r(); }
            }),
            // absolute fallback so we never stall if rAF is throttled
            new Promise<void>(r => setTimeout(r, 160)),
          ]);

          outer.dataset.osmdPhase = "spinner-on";
          mark("spinner-on");

          // fail-safe in case we never reach finally/hideBusy
          if (spinnerFailSafeRef.current) {
            window.clearTimeout(spinnerFailSafeRef.current);
          }
          spinnerFailSafeRef.current = window.setTimeout(() => {
            if (spinnerOwnerRef.current === token) {
              spinnerOwnerRef.current = null;
              hideBusy();
              mark("spinner:failsafe-clear");
            }
          }, 5000);
        }

        outer.dataset.osmdPhase = 'render';
        mark('render:starting');

        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        zoomFactorRef.current = computeZoomFactor();      // ← keep this
        renderWithEffectiveWidth(outer, osmd);

        const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const renderMs = Math.round(t1 - t0);
        outer.dataset.osmdRenderMs = String(renderMs);
        mark(`render:finished (${renderMs}ms)`);

        outer.dataset.osmdPhase = 'post-render-continue';
        mark('afterPaint:nonblocking');
        ap('post-render').then(() => {
          outer.dataset.osmdPhase = 'render:painted';
          mark('render:painted');
        });

        outer.dataset.osmdPhase = 'measure';

        // Re-measure bands without any SVG transform applied
        const newBands = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
        outer.dataset.osmdPhase = `measure:${newBands.length}`;
        mark(`measured:${newBands.length}`);
        if (newBands.length === 0) {
          outer.dataset.osmdPhase = 'measure:0:abort';
          log('reflow: measured 0 bands — abort');
          return;
        }

        // Save current reading position BEFORE replacing starts
        const prevStarts = pageStartsRef.current.slice();
        const prevPage   = pageIdxRef.current;
        const oldTopIdx  = prevStarts.length
          ? (prevStarts[Math.max(0, Math.min(prevPage, prevStarts.length - 1))] ?? 0)
          : 0;

        bandsRef.current = newBands;

        // Compute page starts using the unified pagination height
        const newStarts = computePageStartIndices(newBands, getPAGE_H(outer));
        pageStartsRef.current = newStarts;
        outer.dataset.osmdPhase = `starts:${newStarts.length}`;
        mark(`starts:${newStarts.length}`);

        if (newStarts.length === 0) {
          outer.dataset.osmdPhase = 'reset:first:empty-starts';
          applyPage(0);
          await ap('apply:first-empty');
          applyPage(0);
          outer.dataset.osmdPhase = 'reset:first:done';
          mark('reset:first:done');
          return;
        }

        if (resetToFirst) {
          outer.dataset.osmdPhase = 'reset:first';
          mark('reset:first');
          applyPage(0);
          await ap('apply:first');
          applyPage(0);
          outer.dataset.osmdPhase = 'reset:first:done';
          mark('reset:first:done');
          return;
        }

        // Keep user near the same music
        let nearest = 0, best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < newStarts.length; i++) {
          const s = newStarts[i];
          if (s === undefined) { continue; }
          const d = Math.abs(s - oldTopIdx);
          if (d < best) { best = d; nearest = i; }
        }
        
        // --- phase + marker BEFORE first apply ---
        outer.dataset.osmdPhase = `apply-page:${nearest}`;
        mark(`apply-page:${nearest}`);

        applyPage(nearest);
        // Never let AP stall us if rAF is throttled
        await Promise.race([
          ap('apply:nearest'),
          new Promise<void>(res => setTimeout(res, 700)),
        ]);
        applyPage(nearest);

        outer.dataset.osmdPhase = `applied:${nearest}`;
        mark(`applied:${nearest}`);

        log(`reflow:done page=${nearest+1}/${newStarts.length} bands=${newBands.length}`);
      } finally {
        outer.dataset.osmdPhase = 'finally';
        mark('finally');
        window.clearInterval(wd);

        // only the call that showed the spinner is allowed to hide it
        if (withSpinner && spinnerOwnerRef.current === token) {
          spinnerOwnerRef.current = null;
          hideBusy();
        }

        reflowRunningRef.current = false;

        // drain a single queued pass, if any — run it *without* spinner
        const queued = reflowAgainRef.current;
        reflowAgainRef.current = "none";
        if (queued === "width") {
          log(`reflow:drain queued width pass`);
          setTimeout(() => { reflowFnRef.current(true, false); }, 0);
        } else if (queued === "height") {
          log(`reflow:drain queued height pass`);
          setTimeout(() => { repagFnRef.current(true, false); }, 0);
        }

        if (spinnerFailSafeRef.current) {
          window.clearTimeout(spinnerFailSafeRef.current);
          spinnerFailSafeRef.current = null;
        }
      }
    },
    [applyPage, getPAGE_H, hideBusy, log, mark, renderWithEffectiveWidth, computeZoomFactor]
  );

  useEffect(() => {
    return () => {
      if (spinnerFailSafeRef.current) {
        window.clearTimeout(spinnerFailSafeRef.current);
        spinnerFailSafeRef.current = null;
      }
    };
  }, []);

  // keep ref pointing to latest width-reflow callback
  useEffect(() => {
    reflowFnRef.current = reflowOnWidthChange;
  }, [reflowOnWidthChange]);

  // WebGL purge
  function purgeWebGL(node: HTMLElement): void {
    for (const c of Array.from(node.querySelectorAll("canvas"))) {
      try {
        const gl =
          (c.getContext("webgl") as WebGLRenderingContext | null) ||
          (c.getContext("experimental-webgl") as WebGLRenderingContext | null) ||
          (c.getContext("webgl2") as WebGL2RenderingContext | null);
        if (gl?.getExtension("WEBGL_lose_context")) {
          (gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void }).loseContext?.();
        }
        c.remove();
      } catch {
        // noop
      }
    }
  }


  // Super-early mount probe (before OSMD init)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) { return; }

    // breadcrumbs
    el.dataset.osmdProbeMounted = "true";

    // small HUD ping on the wrapper itself
    hud(el, "mounted");

    // your existing fixed yellow banner (keep this)
    const tag = document.createElement("div");
    tag.dataset.osmdProbeBanner = "1";
    tag.textContent = "ScoreOSMD v9 mounted";
    Object.assign(tag.style, {
      position: "fixed",
      top: "6px",
      left: "6px",
      zIndex: "100000",
      background: "#ff0",
      color: "#000",
      padding: "2px 6px",
      font: "bold 12px/1 sans-serif",
      border: "1px solid #000",
      borderRadius: "4px",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    document.body.appendChild(tag);

    return () => { tag.remove(); };
  }, []);

  // Record baseline zoom/scale at mount (used to compute relative zoom later)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const initial = (vv && typeof vv.scale === "number") ? vv.scale : (window.devicePixelRatio || 1);
    baseScaleRef.current = initial || 1;
    zoomFactorRef.current = 1;
  }, []);

  // Record page visibility so HUD/logs can explain any afterPaint:*:hidden cases
  useEffect(() => {
    const onVis = () => {
      const outer = wrapRef.current;
      if (outer) {
        outer.dataset.osmdVisibility = document.visibilityState;
        tapLog(outer, `visibility:${document.visibilityState}`);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    onVis(); // set initial state
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Reflow when the *browser* zoom level changes (DPR/viewport scale)
  useEffect(() => {
    let lastDpr = window.devicePixelRatio || 1;
    let lastIW  = window.innerWidth;
    let lastIH  = window.innerHeight;

    const kick = () => {
      if (reflowRunningRef.current || repagRunningRef.current) {
        reflowAgainRef.current = "width";
        log('zoom: queued width reflow (already running)');
        return;
      }
      log('zoom: width reflow with spinner');
      zoomFactorRef.current = computeZoomFactor();
      tapLog(wrapRef.current!, `zoomFactor:${zoomFactorRef.current.toFixed(3)}`);
      reflowFnRef.current(true /* resetToFirst */, true /* withSpinner */);

      if (wrapRef.current) {
        handledWRef.current = wrapRef.current.clientWidth;
        handledHRef.current = wrapRef.current.clientHeight;
      }
    };

    const onWindowResize = () => {
      const nowDpr = window.devicePixelRatio || 1;
      const iw = window.innerWidth;
      const ih = window.innerHeight;

      const dprChanged = Math.abs(nowDpr - lastDpr) > 0.001;
      const sizeChanged = iw !== lastIW || ih !== lastIH;

      if (dprChanged || sizeChanged) {
        lastDpr = nowDpr; lastIW = iw; lastIH = ih;
        kick();
      }
    };

    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    let lastScale = vv?.scale ?? 1;
    const onVV = () => {
      if (!vv) { return; }
      if (Math.abs(vv.scale - lastScale) > 0.001) {
        lastScale = vv.scale;
        kick();
      }
    };

    window.addEventListener('resize', onWindowResize);
    vv?.addEventListener('resize', onVV);
    vv?.addEventListener('scroll', onVV);

    return () => {
      window.removeEventListener('resize', onWindowResize);
      vv?.removeEventListener('resize', onVV);
      vv?.removeEventListener('scroll', onVV);
    };
  }, [log, computeZoomFactor]);

  /** Init OSMD */
  useEffect(() => {
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      const host = hostRef.current;
      const outer = wrapRef.current;
      if (!host || !outer) {
        return;
      }

      outer.dataset.osmdStep = "mount";
      hud(outer, "boot • mount");


      const { OpenSheetMusicDisplay } =
        (await import("opensheetmusicdisplay")) as typeof import("opensheetmusicdisplay");

      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
      const osmd = new OpenSheetMusicDisplay(host, {
        backend: "svg" as const,
        autoResize: false,
        drawTitle: true,
        drawSubtitle: true,
        drawComposer: true,
        drawLyricist: true,
        // Dev aid: render numbers each measure if requested to verify continuity
        drawMeasureNumbers: true,
        measureNumberInterval: debugShowAllMeasureNumbers ? 1 : undefined,
      }) as OpenSheetMusicDisplay;
      osmdRef.current = osmd;

      // Pin the boot spinner; we will hide it explicitly at the end.
      setBusyMsg(DEFAULT_BUSY);
      setBusy(true);
      const ap = makeAfterPaint(outer); ap('boot');

      // Load score:
      // - If src starts with /api/, fetch bytes and hand OSMD a File/Uint8Array.
      // - Otherwise keep the original URL-based path (static file names etc.).
      if (src.startsWith("/api/")) {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const ab = await res.arrayBuffer();

        // Unzip .mxl and resolve the primary score via META-INF/container.xml
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(ab);

        // 1) Try to read META-INF/container.xml to locate the main score
        let entryName: string | undefined = undefined;
        const containerEntry = zip.file("META-INF/container.xml");

        if (containerEntry) {
          const containerXml = await containerEntry.async("string");
          const cdoc = new DOMParser().parseFromString(containerXml, "application/xml");
          const rootfile =
            cdoc.querySelector('rootfile[full-path]') ||
            cdoc.querySelector("rootfile");

          const fullPath =
            rootfile?.getAttribute("full-path") ||
            rootfile?.getAttribute("path") ||
            rootfile?.getAttribute("href") ||
            undefined;

          if (fullPath && zip.file(fullPath)) {
            entryName = fullPath;
          }
        }

        // 2) Fallback: pick the best-looking .musicxml/.xml (ignore META-INF)
        if (!entryName) {
          const candidates: string[] = [];
          zip.forEach((relPath, file) => {
            if (file.dir) {
              return;
            }
            const p = relPath.toLowerCase();
            if (p.startsWith("meta-inf/")) {
              return;
            }
            if (p.endsWith(".musicxml") || p.endsWith(".xml")) {
              candidates.push(relPath);
            }
          });
          candidates.sort((a, b) => {
            const aa = a.toLowerCase();
            const bb = b.toLowerCase();
            const scoreA = /score|partwise|timewise/.test(aa) ? 0 : 1;
            const scoreB = /score|partwise|timewise/.test(bb) ? 0 : 1;
            if (scoreA !== scoreB) { return scoreA - scoreB }
            const extA = aa.endsWith(".musicxml") ? 0 : 1;
            const extB = bb.endsWith(".musicxml") ? 0 : 1;
            if (extA !== extB) { return extA - extB }
            return aa.length - bb.length; // shorter path first
          });
          entryName = candidates[0];
        }

        if (!entryName) {
          throw new Error("No MusicXML file found in .mxl archive");
        }

        // 3) Load selected entry as text, parse XML, hand Document to OSMD
        const xmlText = await zip.file(entryName)!.async("string");
        const doc = new DOMParser().parseFromString(xmlText, "application/xml");

        const hasPartwise = doc.getElementsByTagName("score-partwise").length > 0;
        const hasTimewise = doc.getElementsByTagName("score-timewise").length > 0;
        if (!hasPartwise && !hasTimewise) {
          // Surface a helpful snippet for debugging if needed
          throw new Error("MusicXML parse error: no score-partwise/score-timewise");
        }

        const xmlString = new XMLSerializer().serializeToString(doc);
        await awaitLoad(osmd, xmlString);     
      } else {
        await awaitLoad(osmd, src);
      }

      await waitForFonts();

      outer.dataset.osmdPhase = 'render';
      mark('render:starting');

      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      zoomFactorRef.current = computeZoomFactor();      // ← keep this
      renderWithEffectiveWidth(outer, osmd);

      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const renderMs = Math.round(t1 - t0);
      outer.dataset.osmdRenderMs = String(renderMs);
      mark(`render:finished (${renderMs}ms)`);

      outer.dataset.osmdPhase = 'post-render-continue';
      mark('afterPaint:nonblocking');
      ap('post-render').then(() => {
        outer.dataset.osmdPhase = 'render:painted';
        mark('render:painted');
      });

      purgeWebGL(outer);

      const bands = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
      bandsRef.current = bands;

      outer.dataset.osmdSvg = String(!!getSvg(outer));
      outer.dataset.osmdBands = String(bands.length);

      pageStartsRef.current = computePageStartIndices(bands, getPAGE_H(outer));
      outer.dataset.osmdPages = String(pageStartsRef.current.length);

      pageIdxRef.current = 0;
      applyPage(0);

      // show a first HUD snapshot
      hud(outer, `init • svg:${outer.dataset.osmdSvg} • bands:${outer.dataset.osmdBands} • pages:${outer.dataset.osmdPages}`);

      recomputePaginationHeightOnly(true /* resetToFirst */, false /* no spinner on boot */);

      // record the dimensions this layout corresponds to
      handledWRef.current = outer.clientWidth;
      handledHRef.current = outer.clientHeight;

      readyRef.current = true;

      hideBusy();

      resizeObs = new ResizeObserver(() => {
        if (!readyRef.current) { return; }

        // debounce bursts
        if (resizeTimerRef.current) {
          window.clearTimeout(resizeTimerRef.current);
        }
        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;

          const outerNow = wrapRef.current;
          if (!outerNow) { return; }

          const currW = outerNow.clientWidth;
          const currH = outerNow.clientHeight;

          const widthChangedSinceHandled =
            handledWRef.current === -1 || Math.abs(currW - handledWRef.current) >= 1;
          const heightChangedSinceHandled =
            handledHRef.current === -1 || Math.abs(currH - handledHRef.current) >= 1;

          // If a width reflow is already running, queue exactly one follow-up and bail.
          if (reflowRunningRef.current) {
            if (widthChangedSinceHandled) {
              reflowAgainRef.current = "width";   // width wins over height
            } else if (heightChangedSinceHandled) {
              reflowAgainRef.current = "height";
            }
            return;
          }

          // If a repagination is already running, queue appropriately and bail.
          if (repagRunningRef.current) {
            if (widthChangedSinceHandled) {
              reflowAgainRef.current = "width";   // escalate to width
            } else if (heightChangedSinceHandled) {
              reflowAgainRef.current = "height";
            }
            return;
          }

          (async () => {
              if (widthChangedSinceHandled) {
                // HORIZONTAL change → full OSMD reflow + reset to page 1
                await reflowFnRef.current(true /* resetToFirst */, true /* withSpinner */);
                handledWRef.current = currW;
                handledHRef.current = currH;
              } else if (heightChangedSinceHandled) {
              // VERTICAL-only change → cheap repagination (no spinner) + reset to page 1
              repagFnRef.current(true /* resetToFirst */, false /* no spinner */);
              handledHRef.current = currH;
            } else {
              // no material size change
              return;
            }
          })();
        }, 200);
      });
      
      resizeObs.observe(outer);
      const hostE1 = hostRef.current;
      if (hostE1) { resizeObs.observe(hostE1); }
      
     })().catch((err: unknown) => {
      hideBusy();

      const outerNow = wrapRef.current;
      console.error("[ScoreOSMD init crash]", err);

      if (outerNow) {
        const msg =
          err instanceof Error ? err.message :
          typeof err === "string" ? err :
          JSON.stringify(err);
        outerNow.setAttribute("data-osmd-step", "init-crash");
        outerNow.dataset.osmdErr = String(msg).slice(0, 180);
        hud(outerNow, `crash • ${outerNow.dataset.osmdErr}`);
      }
    });


    const cleanupOuter = wrapRef.current;
    const cleanupHost  = hostRef.current; 

    return () => {
      if (resizeObs) {
        if (cleanupOuter) { resizeObs.unobserve(cleanupOuter); }
        if (cleanupHost)  { resizeObs.unobserve(cleanupHost); }
        resizeObs.disconnect();                               // optional, but tidy
      }
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
    };
    // Intentionally only re-init when the score source or measure-number mode changes.
    // Width/height changes are handled by ResizeObserver + visualViewport effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, debugShowAllMeasureNumbers]
);


  /** Paging helpers */
  // --- Stuck-page guard: ensure forward/back actually lands on the next/prev start ---
  const tryAdvance = useCallback((dir: 1 | -1) => {
    if (busyRef.current) { return; }

    const starts = pageStartsRef.current;
    const pages  = starts.length;
    if (!pages) { return; }

    const beforePage = pageIdxRef.current;
    const targetPage = Math.max(0, Math.min(beforePage + dir, pages - 1));
    if (targetPage === beforePage) { return; }

    // The start index we want to land on after any recompute
    const desiredStart = starts[targetPage] ?? starts[beforePage] ?? 0;

    applyPage(targetPage);

    // If we didn't actually move, rebuild page starts and retry *toward* desiredStart.
    requestAnimationFrame(() => {
      if (pageIdxRef.current !== beforePage) { return; } // we moved – all good

      const outer = wrapRef.current;
      if (!outer) { return; }

      const fresh = computePageStartIndices(bandsRef.current, getPAGE_H(outer));
      if (!fresh.length) { return; }

      pageStartsRef.current = fresh;

      // pick first start >= desiredStart (forward) or last start <= desiredStart (backward)
      let idx: number;
      if (dir === 1) {
        idx = fresh.findIndex(s => s >= desiredStart);
        if (idx < 0) { idx = fresh.length - 1; }
      } else {
        let firstGreater = fresh.findIndex(s => s > desiredStart);
        if (firstGreater < 0) { firstGreater = fresh.length; }
        idx = Math.max(0, firstGreater - 1);
      }

      if (idx !== beforePage) { applyPage(idx); }
    });
  }, [applyPage, getPAGE_H]
);

  const goNext = useCallback(() => tryAdvance(1),  [tryAdvance]);
  const goPrev = useCallback(() => tryAdvance(-1), [tryAdvance]);


  // Wheel & keyboard paging (disabled while busy)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!readyRef.current || busyRef.current) {
        return;
      }
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) {
        return;
      }
      e.preventDefault();
      if (e.deltaY > 0) {
        goNext();
      } else {
        goPrev();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!readyRef.current || busyRef.current) {
        return;
      }
      if (["PageDown", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
        goNext();
      } else if (["PageUp", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Home") {
        e.preventDefault();
        applyPage(0);
      } else if (e.key === "End") {
        e.preventDefault();
        const last = Math.max(0, pageStartsRef.current.length - 1);
        applyPage(last);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [applyPage, goNext, goPrev]);

  // Touch swipe paging (disabled while busy)
  useEffect(() => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    let startY = 0;
    let startX = 0;
    let startT = 0; // ← add
    let active = false;

    // Tunables for what counts as a "tap"
    const TAP_MAX_MS = 250;       // quick touch
    const TAP_MAX_MOVE_PX = 12;   // little to no movement

    const onTouchStart = (e: TouchEvent) => {
      if (!readyRef.current ||  busyRef.current || e.touches.length === 0) {
        return;
      }
      active = true;
      startY = e.touches[0]?.clientY ?? 0;
      startX = e.touches[0]?.clientX ?? 0;
      startT = performance.now();          // ← add
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active || !readyRef.current || busyRef.current) {
        return;
      }
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) {
        return;
      }
      active = false;
      if (busyRef.current) {
        return;
      }
      const t = e.changedTouches[0];
      if (!t) { return; }

      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      const dt = performance.now() - startT;  // ← add

      // 1) Tap-to-advance (quick + tiny movement)
      if (Math.abs(dx) <= TAP_MAX_MOVE_PX && Math.abs(dy) <= TAP_MAX_MOVE_PX && dt <= TAP_MAX_MS) {
        goNext();
        return;
      }

      // 2) Your existing swipe logic
      const THRESH = 40;
      const H_RATIO = 0.6;
      if (Math.abs(dy) >= THRESH && Math.abs(dx) <= Math.abs(dy) * H_RATIO) {
        if (dy < 0) {
          goNext();
        } else {
          goPrev();
        }
      }
    };

    outer.addEventListener("touchstart", onTouchStart, { passive: true });
    outer.addEventListener("touchmove", onTouchMove,  { passive: false });
    outer.addEventListener("touchend",  onTouchEnd,   { passive: true });

    outer.style.overscrollBehavior = "contain";

    const cleanupOuter = outer;
    return () => {
      cleanupOuter.removeEventListener("touchstart", onTouchStart);
      cleanupOuter.removeEventListener("touchmove", onTouchMove);
      cleanupOuter.removeEventListener("touchend", onTouchEnd);
    };
  }, [goNext, goPrev]);

  // Recompute pagination when the visual viewport height changes (mobile URL/tool bars)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!vv) { return; }

    const onChange = () => {
      if (!readyRef.current) { return; }

      // debounce vv events
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
      }
      vvTimerRef.current = window.setTimeout(async () => {
        vvTimerRef.current = null;

        const outerNow = wrapRef.current;
        if (!outerNow) { return; }

        const currW = outerNow.clientWidth;
        const currH = outerNow.clientHeight;

        const widthChanged =
          handledWRef.current === -1 || Math.abs(currW - handledWRef.current) >= 1;
        const heightChanged =
          handledHRef.current === -1 || Math.abs(currH - handledHRef.current) >= 1;

        // If a width reflow is already running, queue one follow-up and bail.
        if (reflowRunningRef.current) {
          if (widthChanged) {
            reflowAgainRef.current = "width";
          } else if (heightChanged) {
            reflowAgainRef.current = "height";
          }
          return;
        }

        // If a repagination is already running, queue appropriately and bail.
        if (repagRunningRef.current) {
          if (widthChanged) {
            reflowAgainRef.current = "width";  // escalate if width changed
          } else if (heightChanged) {
            reflowAgainRef.current = "height";
          }
          return;
        }

        if (widthChanged) {
          // HORIZONTAL change → full OSMD reflow (with spinner) + reset to page 1
          await reflowFnRef.current(true /* resetToFirst */, true /* withSpinner */);
          handledWRef.current = currW;
          handledHRef.current = currH;
        } else if (heightChanged) {
          // VERTICAL-only change → cheap repagination (no spinner) + reset to page 1
          repagFnRef.current(true /* resetToFirst */, false /* no spinner */);
          handledHRef.current = currH;
        }
      }, 200);
    };

    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      // clear the *vv* debounce timer here
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
        vvTimerRef.current = null;
      }
    };
  }, [recomputePaginationHeightOnly, reflowOnWidthChange, log]);

  // right below the other useEffects, anywhere inside the component:
  useEffect(() => {
    const outer = wrapRef.current;
    if (outer) {
      outer.dataset.osmdBusy = busy ? "1" : "0";
      tapLog(outer, busy ? "busy:true" : "busy:false");
    }
  }, [busy]);

  /* ---------- Styles ---------- */

  const isFill = fillParent;
  const outerStyle: React.CSSProperties = isFill
    ? {
        width: "100%",
        height: vpHRef.current > 0 ? vpHRef.current : "100vh", // ← was "100%"
        minHeight: 320,                                        // ← was 0
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2px)",
        boxSizing: "border-box",
        isolation: "isolate",
      }
    : {
        width: "100%",
        height: height ?? 600,
        minHeight: height ?? 600,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        paddingBottom: "2px",
        boxSizing: "border-box",
        isolation: "isolate",
      };

  const hostStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    minWidth: 0,
  };

  /* ---------- Busy overlay ---------- */
  const blockerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 9999,
    display: busy ? "grid" : "none",
    placeItems: "center",
    background: "rgba(0,0,0,0.45)",
    backdropFilter: "blur(2px)",
    cursor: "wait",
  };

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
      <div
        ref={wrapRef}
        data-osmd-wrapper="1"
        data-osmd-probe="v9"
        style={{ /*outline: "4px solid fuchsia",*/ ...outerStyle, ...style }}
        className={className}
      >
      <div
        ref={hostRef}
        style={hostStyle} />
      {/* Input-blocking overlay while busy */}
      <div
        aria-busy={busy}
        role="status"
        aria-live="polite"   // screen readers announce “Please wait…”
        aria-atomic="true"   // read the whole message when it changes
        style={blockerStyle}
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onTouchStart={stop}
        onTouchMove={stop}
        onWheel={stop}
        onScroll={stop}
        onMouseDown={stop}
        onContextMenu={stop}
        onKeyDown={stop}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.92)",
            borderRadius: 12,
            padding: "10px 14px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
            fontSize: 14,
            color: "#111",
            textAlign: "center",
            minWidth: 140,
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: "2px solid rgba(0,0,0,0.4)",
              borderTopColor: "transparent",
              margin: "0 auto 8px",
              animation: "osmd-spin 0.9s linear infinite",
            }}
          />
          <div>{busyMsg || DEFAULT_BUSY}</div>
        </div>
      </div>

      <style>{`@keyframes osmd-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
