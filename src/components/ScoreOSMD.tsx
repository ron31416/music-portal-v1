/* eslint curly: ["error", "all"] */
// src/components/ScoreViewer.tsx
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
  /** show HUD/guide overlays (default: false) */
  debugOverlays?: boolean;
}

interface Band { top: number; bottom: number; height: number }

// Type: function stored in a ref
type ReflowCallback = () => Promise<void>;

// Central pagination/masking knobs (tuned for Hi/Lo DPR). Change here, not inline.
const REFLOW = {
  // Width used for OSMD's layout (computed from container width / zoom, then clamped)
  MIN_LAYOUT_W: 320,
  MAX_LAYOUT_W: 1600,
  WIDTH_NUDGE: -1,           // small bias to avoid edge-case layouts

  // Pagination height slop: lets us fill the page slightly past the visible height
  PAGE_FILL_SLOP_PX: 8,

  // “Last page” spacing: if a system is too close to the bottom, push it to a new page
  LAST_PAGE_BOTTOM_PAD_PX: 12,

  // Masking/peek guards between pages (don’t usually need to touch)
  MASK_BOTTOM_SAFETY_PX: 12,
  PEEK_GUARD_LO_DPR: 5,
  PEEK_GUARD_HI_DPR: 7,

  // Fixed bottom cutter padding
  BOTTOM_PEEK_PAD_LO_DPR: 5,
  BOTTOM_PEEK_PAD_HI_DPR: 6,
} as const;

// Allow up to 3 recursive passes of applyPage to settle layout.
// Bail on the 4th to prevent oscillation.
const APPLY_MAX_PASSES = 3 as const;

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(tag)), ms);
    p.then(v => { window.clearTimeout(t); resolve(v); },
      e => { window.clearTimeout(t); reject(e); });
  });
}

// Await osmd.load(...) whether it returns void or a Promise.
// (No "maybe" checks needed.)
async function loadOSMD(
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

      function finish(
        why: "raf" | "timeout" | "hidden" | "message" | "safety-tick" | "ceiling"
      ): void {
        if (done) { return; }
        done = true;
        try {
          // Keep lightweight breadcrumbs for debugging
          outer.dataset.viewerAfterpaint = `${label ?? ""}:${why}`;
          const now =
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          const ms = Math.round(now - t0);
          outer.dataset.viewerAfterpaintMs = String(ms);

          void logStep(`${label ?? ""} -> ${why} (${ms}ms)`, { outer });
        } catch { }
        resolve();
      }
      try {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => finish("raf"));
        });
      } catch { }

      // Primary watchdog: if rendering takes longer than timeoutMs, force-finish
      window.setTimeout(() => finish("timeout"), timeoutMs);

      // Ceiling guard: absolute upper bound (4× timeout or 1200ms minimum)
      // prevents spinner from hanging forever in edge cases
      window.setTimeout(() => finish("ceiling"), Math.max(timeoutMs * 4, 1200));
    });
  };
}

function getSvg(outer: HTMLDivElement): SVGSVGElement | null {
  return outer.querySelector("svg");
}

function withSvgAtUnitScale<T>(outer: HTMLDivElement, fn: (svg: SVGSVGElement) => T): T | null {
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

/** Best-effort "wait until the browser can paint" (bounded) */
async function waitForPaint(timeoutMs = 450): Promise<void> {
  try {
    await new Promise<void>(r => window.setTimeout(r, 0)); // macrotask
    if (document.visibilityState === 'visible') {
      await Promise.race([
        new Promise<void>(r =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => r())
          )
        ),
        new Promise<void>(r => window.setTimeout(r, timeoutMs)),
      ]);
    }
  } catch { }
}

// Flip this to disable all on-page logging in one place.
const DEBUG_LOG = true;

export async function logStep(
  message: string,
  opts: { paint?: boolean; outer?: HTMLDivElement | null } = {}
): Promise<void> {
  if (!DEBUG_LOG) { return; }

  const { paint = false, outer = null } = opts;

  // Fixed DevTools console column widths (tweak as needed) 
  const FN_COL = 20;
  const PHASE_COL = 10;

  // Local helper: truncate to the column width and pad to that width.
  const pad = (s: string, w: number): string =>
    (s.length > w ? s.slice(0, w) : s).padEnd(w, " ");

  try {
    // Prefer provided wrapper; otherwise find our wrapper element by data attribute.
    let fn = "(none)";
    let phase = "(none)";
    const wrap: HTMLElement | null =
      outer ??
      (typeof document !== "undefined"
        ? document.querySelector<HTMLElement>('[data-viewer-wrapper="1"]')
        : null);

    if (wrap) {
      const df = wrap.dataset?.viewerFunc;
      const dp = wrap.dataset?.viewerPhase;
      if (typeof df === "string" && df.length > 0) { fn = df; }
      if (typeof dp === "string" && dp.length > 0) { phase = dp; }
    }

    // Always render both columns with fixed widths.
    const fnChunk = `[${pad(fn === "(none)" ? "" : fn, FN_COL)}]`;
    const phaseChunk = `[${pad(phase === "(none)" ? "" : phase, PHASE_COL)}]`;

    const composed = `${fnChunk} ${phaseChunk} ${message}`;

    // eslint-disable-next-line no-console
    console.log(composed);

    if (wrap) {
      wrap.dataset.viewerLastLog = `${Date.now()}:${composed.slice(0, 80)}`;
    }

    if (paint) {
      await waitForPaint();
    }
  } catch { }
}

// ---------- DEBUG OVERLAY (visualize bands & starts) ----------
let DEBUG_BANDS = false; // set true to show guides; false to hide

type DebugOpts = {
  tag?: string;
  starts?: number[];
  startIndex?: number;       // current page's start band index
  nextStartIndex?: number;   // next page's start band index
  ySnap?: number;            // REQUIRED for page-local lines: ceil(startBand.top)
  visibleAbsY?: number;
  pageAbsY?: number;
  maskAbsY?: number;
  topGutter?: number;
  drawPageLocal?: boolean;   // NEW: draw per-system top/bottom in page space
};

function debugDrawBands(
  outer: HTMLDivElement,
  bands: Band[],
  opts: DebugOpts = {}
): void {
  if (!DEBUG_BANDS || !outer) { return; }

  let layer = outer.querySelector<HTMLDivElement>("[data-viewer-debug='1']");
  if (!layer) {
    layer = document.createElement("div");
    layer.dataset.viewerDebug = "1";
    Object.assign(layer.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "999",
      fontFamily: "system-ui, sans-serif",
      fontSize: "11px",
      lineHeight: "1",
    } as CSSStyleDeclaration);
    outer.appendChild(layer);
  }
  layer.innerHTML = "";

  const badge = document.createElement("div");
  badge.textContent = opts.tag ?? "debug";
  Object.assign(badge.style, {
    position: "absolute",
    top: "2px",
    left: "2px",
    background: "rgba(0,0,0,0.65)",
    color: "#fff",
    padding: "2px 6px",
    borderRadius: "6px",
  } as CSSStyleDeclaration);
  layer.appendChild(badge);

  // Absolute (unshifted) band blocks — keep as-is for reference
  bands.forEach((b, i) => {
    const block = document.createElement("div");
    Object.assign(block.style, {
      position: "absolute",
      left: "0",
      right: "0",
      top: `${Math.round(b.top)}px`,
      height: `${Math.round(b.height)}px`,
      background: "rgba(255,0,0,0.06)",
      outline: "1px solid rgba(255,0,0,0.35)",
    } as CSSStyleDeclaration);
    layer.appendChild(block);

    const label = document.createElement("div");
    label.textContent = `#${i}  h=${Math.round(b.height)}  top=${Math.round(b.top)}  bot=${Math.round(b.bottom)}`;
    Object.assign(label.style, {
      position: "absolute",
      left: "6px",
      top: `${Math.max(0, Math.round(b.top) - 13)}px`,
      color: "#a00",
      textShadow: "0 1px 0 #fff",
      fontWeight: i === opts.startIndex ? "700" as const : "600" as const,
    } as CSSStyleDeclaration);
    layer.appendChild(label);

    if (i === opts.startIndex) {
      block.style.outline = "2px solid rgba(0,128,255,0.8)";
    }
    if (i === opts.nextStartIndex) {
      const mark = document.createElement("div");
      mark.textContent = "▶ next-start";
      Object.assign(mark.style, {
        position: "absolute",
        right: "6px",
        top: `${Math.max(0, Math.round(b.top) - 13)}px`,
        color: "#084",
        fontWeight: "700",
        textShadow: "0 1px 0 #fff",
      } as CSSStyleDeclaration);
      layer.appendChild(mark);
    }
  });

  // Page-local top/bottom lines (THIS is what you asked for)
  const haveYSnap = typeof opts.ySnap === "number" && Number.isFinite(opts.ySnap);
  if (opts.drawPageLocal && haveYSnap) {
    const ySnap = Math.floor(opts.ySnap ?? 0);
    const gutter = Math.max(0, opts.topGutter ?? 0);
    const first = Math.max(0, opts.startIndex ?? 0);
    const lastExclusive = (opts.nextStartIndex !== undefined && opts.nextStartIndex !== null && opts.nextStartIndex >= 0)
      ? opts.nextStartIndex
      : bands.length;

    for (let i = first; i < lastExclusive; i++) {
      const b = bands[i]!;
      const pageTop = Math.round(b.top - ySnap + gutter);
      const pageBottom = Math.round(b.bottom - ySnap + gutter);

      const topLine = document.createElement("div");
      Object.assign(topLine.style, {
        position: "absolute",
        left: "0",
        right: "0",
        top: `${pageTop}px`,
        borderTop: "2px solid #1976d2", // blue = system TOP (page-local)
        zIndex: "1000",
      } as CSSStyleDeclaration);
      layer.appendChild(topLine);

      const botLine = document.createElement("div");
      Object.assign(botLine.style, {
        position: "absolute",
        left: "0",
        right: "0",
        top: `${pageBottom}px`,
        borderTop: "2px solid #2e7d32", // green = system BOTTOM (page-local)
        zIndex: "1000",
      } as CSSStyleDeclaration);
      layer.appendChild(botLine);
    }
  }

  // Horizontal guides: visible height, unified pagination height, and mask top
  const addHGuide = (y: number, label: string, color: string, dash = false) => {
    if (!Number.isFinite(y)) { return; }
    const line = document.createElement("div");
    Object.assign(line.style, {
      position: "absolute",
      left: "0",
      right: "0",
      top: `${Math.round(y)}px`,
      borderTop: `2px ${dash ? "dashed" : "solid"} ${color}`,
    } as CSSStyleDeclaration);
    layer.appendChild(line);

    const tag = document.createElement("div");
    tag.textContent = label;
    Object.assign(tag.style, {
      position: "absolute",
      right: "4px",
      top: `${Math.max(0, Math.round(y) - 12)}px`,
      background: color,
      color: "#fff",
      padding: "1px 6px",
      borderRadius: "4px",
    } as CSSStyleDeclaration);
    layer.appendChild(tag);
  };

  if (Number.isFinite(opts.visibleAbsY!)) { addHGuide(opts.visibleAbsY!, "visibleH", "#007acc"); }
  if (Number.isFinite(opts.pageAbsY!)) { addHGuide(opts.pageAbsY!, "paginationH", "#9c27b0", true); }
  if (Number.isFinite(opts.maskAbsY!)) { addHGuide(opts.maskAbsY!, "maskTop", "#e53935"); }
}

// === HUD & edge-lines (helpers)
type HudSnapshot = {
  pageIdx: number;
  pages: number;
  startIndex: number;
  nextStartIndex: number;
  ySnap: number;
  translateY: number;
  visibleH: number;
  paginationH: number;
  maskTop: number;
  startTop?: number;
  startBottom?: number;
  nextTop?: number;
  nextBottom?: number;
};

function drawHud(outer: HTMLDivElement, snap: HudSnapshot): void {
  let hud = outer.querySelector<HTMLDivElement>("[data-viewer-hud='1']");
  if (!hud) {
    hud = document.createElement("div");
    hud.dataset.viewerHud = "1";
    Object.assign(hud.style, {
      position: "absolute",
      top: "6px",
      right: "6px",
      zIndex: "1000",
      font: "11px system-ui, sans-serif",
      whiteSpace: "pre",
      background: "rgba(0,0,0,0.65)",
      color: "#fff",
      padding: "6px 8px",
      borderRadius: "8px",
      pointerEvents: "auto",
      maxWidth: "52vw",
    } as CSSStyleDeclaration);
    outer.appendChild(hud);
  }

  const lines: string[] = [
    `p ${snap.pageIdx + 1}/${snap.pages}  start#=${snap.startIndex} next#=${snap.nextStartIndex}`,
    `ySnap=${snap.ySnap}  translateY=${snap.translateY}`,
    `visibleH=${snap.visibleH}  pagH=${snap.paginationH}  maskTop=${snap.maskTop}`,
  ];

  if (Number.isFinite(snap.startTop ?? NaN)) {
    lines.push(`start: top=${Math.round(snap.startTop!)}  bot=${Math.round(snap.startBottom!)} `);
  }
  if (Number.isFinite(snap.nextTop ?? NaN)) {
    lines.push(`next : top=${Math.round(snap.nextTop!)}  bot=${Math.round(snap.nextBottom!)} `);
  }

  hud.textContent = lines.join("\n");
}

type EdgeLineMode = "raw" | "applied";

/** Draw thin lines for each system's top & bottom. */
function drawSystemEdgeLines(
  outer: HTMLDivElement,
  bands: Band[],
  idxs: number[],
  mode: EdgeLineMode,
  ySnap: number,
  topGutter: number
): void {
  const old = outer.querySelectorAll("[data-viewer-edgelines='1']");
  old.forEach((el) => el.remove());

  const layer = document.createElement("div");
  layer.dataset.viewerEdgelines = "1";
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "998",
  } as CSSStyleDeclaration);
  outer.appendChild(layer);

  const makeY = (y: number): number => mode === "raw"
    ? Math.round(y)
    : Math.round(y - ySnap + topGutter);

  const colorTop = mode === "raw" ? "#1976d2" : "#2e7d32";   // top: blue vs green
  const colorBot = mode === "raw" ? "#64b5f6" : "#81c784";   // bottom: dashed

  for (const idx of idxs) {
    const b = bands[idx];
    if (!b) { continue; }

    const topLine = document.createElement("div");
    Object.assign(topLine.style, {
      position: "absolute",
      left: "0",
      right: "0",
      top: `${makeY(b.top)}px`,
      borderTop: `2px solid ${colorTop}`,
    } as CSSStyleDeclaration);
    layer.appendChild(topLine);

    const botLine = document.createElement("div");
    Object.assign(botLine.style, {
      position: "absolute",
      left: "0",
      right: "0",
      top: `${makeY(b.bottom)}px`,
      borderTop: `2px dashed ${colorBot}`,
    } as CSSStyleDeclaration);
    layer.appendChild(botLine);
  }
}

/** Remove any debug layers if they exist. */
function clearDebugLayers(outer: HTMLDivElement): void {
  if (!outer) { return; }
  const sels = [
    "[data-viewer-debug='1']",
    "[data-viewer-hud='1']",
    "[data-viewer-edgelines='1']",
  ];
  for (const sel of sels) {
    outer.querySelectorAll(sel).forEach((n) => n.remove());
  }
}


/** Wait for web fonts to be ready (bounded; prevents rare long hangs) */
async function waitForFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      await Promise.race([
        fonts.ready,
        new Promise<void>(resolve => window.setTimeout(resolve, 1500)),
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

function dprRoundingJitterPx(): number {
  const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
  if (dpr >= 3) { return 3; }  // very high DPR: allow more wobble
  if (dpr >= 2) { return 2; }  // common Hi-DPR screens
  return 1;                    // low/normal DPR
}

function dynamicBandGapPx(outer: HTMLDivElement): number {
  // The gap we *pack to* when we reposition systems.
  const packGap = interSystemPackGapPx(outer);

  // Rounding / subpixel safety so merge-threshold stays clearly below packGap.
  const jitter = dprRoundingJitterPx();

  // Enforce a strict separation of at least 1px below packGap after jitter.
  const strictness = 1;

  // Never let the merge threshold reach the packing gap; also keep a sane floor.
  return Math.max(6, packGap - jitter - strictness);
}

function scanSystemsPx(outer: HTMLDivElement, svgRoot: SVGSVGElement): Band[] {
  const prevFuncTag = outer.dataset.viewerFunc ?? "";
  outer.dataset.viewerFunc = "scanSystemsPx";
  try {
    const pageRoots = getPageRoots(svgRoot);
    const roots: Array<SVGGElement | SVGSVGElement> = pageRoots.length ? pageRoots : [svgRoot];

    const hostTop = outer.getBoundingClientRect().top;

    interface Box { top: number; bottom: number; height: number; width: number }
    const boxes: Box[] = [];

    // Include very thin graphics so text/hairlines extend each band.
    const MIN_H = 1;
    const MIN_W = 6;

    for (const root of roots) {
      // Groups + primitive graphics → dynamics/pedals/slurs count
      const SELECTORS = "g,path,rect,line,polyline,polygon,text";
      const graphics = Array.from(root.querySelectorAll<SVGGraphicsElement>(SELECTORS));

      // Detect the top of the first real system on this page, if the DOM exposes system groups.
      // We’ll drop any elements fully above that line (i.e., titles/credits).
      const SYS_SEL = "g[id*='system' i], g[class*='system' i]";
      let pageContentTop = Number.NEGATIVE_INFINITY;
      try {
        const sysRects = Array
          .from(root.querySelectorAll<SVGGElement>(SYS_SEL))
          .map(g => g.getBoundingClientRect())
          .filter(r => Number.isFinite(r.top) && Number.isFinite(r.height) && r.height > 0);

        if (sysRects.length) {
          const minSysTop = Math.min(...sysRects.map(r => r.top));
          const HEADER_GUARD_PX = 12; // allow hairpins/dynamics just above the staff
          pageContentTop = Math.floor(minSysTop - hostTop) - HEADER_GUARD_PX;
        }
      } catch { }

      for (const el of graphics) {
        try {
          const r = el.getBoundingClientRect();
          if (!Number.isFinite(r.top) || !Number.isFinite(r.height) || !Number.isFinite(r.width)) { continue; }
          if (r.height < MIN_H) { continue; }
          if (r.width < MIN_W) { continue; }

          const top = r.top - hostTop;
          const bottom = r.bottom - hostTop;

          // If we detected a system top, ignore pure title/credit elements above it
          if (Number.isFinite(pageContentTop) && bottom < pageContentTop) { continue; }

          boxes.push({ top, bottom, height: r.height, width: r.width });
        } catch { }
      }
    }

    boxes.sort((a, b) => a.top - b.top);

    // IMPORTANT: merge threshold is derived from the *packing* gap,
    // minus DPR jitter and a 1px strictness margin (done inside dynamicBandGapPx).
    const THRESH = dynamicBandGapPx(outer);

    const bands: Band[] = [];
    for (const b of boxes) {
      const last = bands.length ? bands[bands.length - 1] : undefined;
      if (!last) {
        bands.push({ top: b.top, bottom: b.bottom, height: b.height });
        continue;
      }

      // Integerize to kill sub-px wobbles, then make the test inclusive.
      const gapPx = Math.floor(b.top) - Math.ceil(last.bottom);
      if (gapPx >= THRESH) {
        bands.push({ top: b.top, bottom: b.bottom, height: b.height });
      } else {
        last.top = Math.min(last.top, b.top);
        last.bottom = Math.max(last.bottom, b.bottom);
        last.height = last.bottom - last.top;
      }
    }

    // Tiny safety expansion so 1-px hairlines aren’t shaved at page edges
    const HAIRLINE_PAD = (window.devicePixelRatio || 1) >= 2 ? 2 : 1;
    for (const band of bands) {
      band.bottom += HAIRLINE_PAD;
      band.height = band.bottom - band.top;
    }

    void logStep(`bands: ${bands.length}`, { outer });
    return bands;
  } finally {
    try { outer.dataset.viewerFunc = prevFuncTag; } catch { }
  }
}

// --- System packing helpers (insert after scanSystemsPx) ---

function interSystemPackGapPx(outer: HTMLDivElement): number {
  const h = outer.clientHeight || 0;
  const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
  let gap = 10;                 // nominal inter-system gap (keeps 2nd line close)
  if (h <= 750) { gap += 1; }   // small visible height → a touch more
  if (dpr >= 2) { gap += 1; }   // Hi-DPR safety
  return gap;
}

function getPageRoots(svgRoot: SVGSVGElement): SVGGElement[] {
  const selector = [
    'g[id^="osmdSvgPage"]',
    'g[id^="osmdCanvasPage"]',
    'g[id^="Page"]',
    'g[class*="osmdSvgPage"]',
    'g[class*="osmdCanvasPage"]',
    'g[class*="Page"]',
    'g[class*="page"]',
  ].join(',');
  const all = Array.from(svgRoot.querySelectorAll<SVGGElement>(selector));
  const roots = all.filter(g => g.ownerSVGElement === svgRoot);
  return roots.length ? roots : [];
}

/** Hard-fail if the SVG has no per-system groups at all. */
function assertHasSystemGroups(outer: HTMLDivElement, svgRoot: SVGSVGElement): void {
  const systems = Array.from(
    svgRoot.querySelectorAll<SVGGElement>("g[id*='system' i], g[class*='system' i]")
  ).filter(g => g.ownerSVGElement === svgRoot);

  if (systems.length === 0) {
    // breadcrumbs for quick diagnosis
    outer.dataset.viewerFatal = "no-system-groups";
    outer.dataset.viewerErr = "OSMD SVG missing per-system groups";
    // hard fail (you asked for this behavior)
    throw new Error("OSMD SVG missing per-system groups (no id/class contains 'system').");
  }
}

/** Collapse big gaps *between* OSMD’s engraved pages to our nominal gap. */
function flattenEngravedSeams(
  outer: HTMLDivElement,
  svgRoot: SVGSVGElement,
  preBands: Band[]
): void {
  const pages = getPageRoots(svgRoot);
  if (pages.length <= 1 || preBands.length === 0) { return; }

  const hostTop = outer.getBoundingClientRect().top;

  pages.forEach(p => p.removeAttribute("transform"));

  const pageRects = pages.map(p => {
    const r = p.getBoundingClientRect();
    return { top: r.top - hostTop, bottom: r.bottom - hostTop };
  });

  const bandToPage: number[] = preBands.map((b) => {
    const mid = (b.top + b.bottom) / 2;
    const idx = pageRects.findIndex(pr => mid >= pr.top && mid < pr.bottom);
    return idx >= 0 ? idx : (pageRects.length - 1);
  });

  type Ends = { firstTop: number; lastBottom: number };
  const ends: Array<Ends | null> = pages.map(() => null);
  preBands.forEach((b, i) => {
    const p = bandToPage[i]!;
    const e = ends[p];
    if (!e) {
      ends[p] = { firstTop: b.top, lastBottom: b.bottom };
    } else {
      e.firstTop = Math.min(e.firstTop, b.top);
      e.lastBottom = Math.max(e.lastBottom, b.bottom);
    }
  });

  const desiredGap = interSystemPackGapPx(outer);
  let accDelta = 0;

  const appendTranslateAttr = (g: SVGGElement, dy: number) => {
    const prevAttr = g.getAttribute("transform") || "";
    g.setAttribute("transform", `${prevAttr} translate(0 ${Math.round(dy)})`);
  };

  for (let i = 1; i < pages.length; i++) {
    const prev = ends[i - 1];
    const curr = ends[i];
    if (!prev || !curr) { continue; }
    const originalGap = curr.firstTop - prev.lastBottom;
    if (originalGap <= desiredGap + 1) { continue; }
    const deltaY = desiredGap - originalGap; // negative moves up
    accDelta += deltaY;
    appendTranslateAttr(pages[i]!, accDelta);
  }
}

/** Repack systems *inside* each engraved page to the nominal gap. */
function packSystemsWithinPages(
  outer: HTMLDivElement,
  svgRoot: SVGSVGElement
): void {
  const GAP = interSystemPackGapPx(outer);
  const pages = getPageRoots(svgRoot);
  const pageGroups: Array<SVGGElement | SVGSVGElement> = pages.length ? pages : [svgRoot];

  const hostTop = outer.getBoundingClientRect().top;

  for (const page of pageGroups) {
    const systems = Array.from(
      page.querySelectorAll<SVGGElement>("g[id*='system' i], g[class*='system' i]")
    );

    if (systems.length === 0) {
      const n = Number(outer.dataset.viewerWarnEmptyPage || "0") + 1;
      outer.dataset.viewerWarnEmptyPage = String(n);
      continue;
    }

    systems.forEach(g => { g.style.transform = ""; });

    const boxes = systems
      .map((g) => {
        try {
          const r = g.getBoundingClientRect();
          return { g, top: r.top - hostTop, bottom: r.bottom - hostTop, height: r.height };
        } catch { return null; }
      })
      .filter((v): v is { g: SVGGElement; top: number; bottom: number; height: number } =>
        !!v && Number.isFinite(v.top) && v.height > 0
      )
      .sort((a, b) => a.top - b.top);

    if (boxes.length === 0) { continue; }

    let y = boxes[0]!.top;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      const desiredTop = Math.round(y);
      const delta = Math.round(desiredTop - b.top);

      if (Math.abs(delta) >= 1) {
        b.g.style.transform = `translateY(${delta}px)`;
      } else {
        b.g.style.transform = ""; // keep it clean if no move
      }

      y = desiredTop + b.height + (i < boxes.length - 1 ? GAP : 0);
    }
  }
}

/** Compute page starts by PACKING system heights + a fixed inter-system gap. */
function computePageStarts(outer: HTMLDivElement, bands: Band[], viewportH: number): number[] {
  const prevFuncTag = outer.dataset.viewerFunc ?? "";
  outer.dataset.viewerFunc = "computePageStarts";
  try {
    if (bands.length === 0 || viewportH <= 0) {
      void logStep("starts: 1 (fallback [0])", { outer });
      return [0];
    }

    const TOL = (window.devicePixelRatio || 1) >= 2 ? 2 : 1;
    const PAGE_H = Math.max(1, Math.floor(viewportH) - TOL);

    const GAP = interSystemPackGapPx(outer); // fixed virtual gap between systems

    const starts: number[] = [];
    let i = 0;

    while (i < bands.length) {
      starts.push(i);

      let used = bands[i]!.height; // first system height
      let j = i;

      // Keep packing next systems while the packed height fits into PAGE_H
      while (j + 1 < bands.length) {
        const nextUsed = used + GAP + bands[j + 1]!.height;
        if (nextUsed <= PAGE_H) {
          used = nextUsed;
          j += 1;
        } else {
          break;
        }
      }

      i = j + 1; // advance to the next page start
    }

    void logStep(`starts(packed): ${starts.length} PAGE_H=${PAGE_H} gap=${GAP}`, { outer });
    return starts.length ? starts : [0];
  } finally {
    try { outer.dataset.viewerFunc = prevFuncTag; } catch { /* no-op */ }
  }
}

function hasZoomProp(o: unknown): o is { Zoom: number } {
  if (typeof o !== "object" || o === null) { return false; }
  const maybe = o as { Zoom?: unknown };
  return typeof maybe.Zoom === "number";
}

function perfMark(n: string) { try { performance.mark(n); } catch { } }

function perfMeasure(n: string, a: string, b: string) {
  try { performance.measure(n, { start: a, end: b }); } catch { }
}

function perfLastMs(name: string) {
  const e = performance.getEntriesByName(name);
  return Math.round(e[e.length - 1]?.duration || 0);
}

// --------- Perf blocks (module-scope; reusable) ---------
function perfBlock<T>(
  uid: string,
  work: () => T,
  after?: (ms: number) => void
): T {
  const start = `${uid} start`;
  const end = `${uid} end`;
  const runtime = `${uid} runtime`;
  perfMark(start);
  try {
    return work();
  } finally {
    perfMark(end);
    perfMeasure(runtime, start, end);
    const ms = perfLastMs(runtime);
    try { after?.(ms); } catch { }
    try {
      performance.clearMarks(start);
      performance.clearMarks(end);
      performance.clearMeasures(runtime);
    } catch { }
  }
}

async function perfBlockAsync<T>(
  uid: string,
  work: () => Promise<T>,
  after?: (ms: number) => void
): Promise<T> {
  const start = `${uid} start`;
  const end = `${uid} end`;
  const runtime = `${uid} runtime`;
  perfMark(start);
  try {
    return await work();
  } finally {
    perfMark(end);
    perfMeasure(runtime, start, end);
    const ms = perfLastMs(runtime);
    try { after?.(ms); } catch { }
    try {
      performance.clearMarks(start);
      performance.clearMarks(end);
      performance.clearMeasures(runtime);
    } catch { }
  }
}

/* ---------- Component ---------- */

export default function ScoreViewer({
  src,
  fillParent = true,
  height = 600,
  className = "",
  style,
  topGutterPx = 3,
  debugShowAllMeasureNumbers = false,
  debugOverlays = false,
}: Props) {
  // turn overlays on/off per prop (off by default)
  DEBUG_BANDS = !!debugOverlays;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);

  const systemBandsRef = useRef<Band[]>([]);
  const pageStartIdxsRef = useRef<number[]>([0]);
  const pageIdxRef = useRef<number>(0);
  const readyRef = useRef<boolean>(false);

  // Packed/virtual Y positions for each band (what their Y would be if we stacked them)
  const flowMapRef = useRef<{ top: number[]; bottom: number[] }>({ top: [], bottom: [] });

  function rebuildFlowMap(outer: HTMLDivElement, bands: Band[]): void {
    const gap = interSystemPackGapPx(outer); // you already call this in computePageStarts
    const top: number[] = [];
    const bottom: number[] = [];

    // Anchor the virtual flow to the *physical* top of the first band,
    // so translateY(-flowTop[i] + gutter) still pins the band correctly.
    let y = bands[0]?.top ?? 0;

    for (let i = 0; i < bands.length; i++) {
      const b = bands[i]!;
      top[i] = Math.round(y);
      y += b.height;
      bottom[i] = Math.round(y);
      if (i < bands.length - 1) {
        y += gap;
      }
    }

    flowMapRef.current = { top, bottom };
  }


  const DEFAULT_BUSY_MSG = "Please wait…";

  // Busy lock (blocks input while OSMD works)
  const [busy, setBusy] = useState<boolean>(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [busyMsg, setBusyMsg] = useState<string>(DEFAULT_BUSY_MSG);

  // Spinner ownership + fail-safe timer (used by zoom reflow)
  const spinnerOwnerRef = useRef<symbol | null>(null);
  const spinnerFailSafeRef = useRef<number | null>(null);

  // Debounce + reentry guards for resize/viewport changes
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Stable per-instance ID (for perf marks), plus a monotonic per-run sequence elsewhere
  const instanceIdRef = useRef<string>(`viewer-${Math.random().toString(36).slice(2, 8)}`);
  const perfSeqRef = useRef(0);
  const nextPerfUID = useCallback((run: string | number | undefined) => {
    perfSeqRef.current += 1;
    return `${instanceIdRef.current}#${run ?? "?"}@${perfSeqRef.current}`;
  }, []);

  // --- Init watchdog guards ---
  const initEpochRef = useRef(0);
  const initFinalizeTimerRef = useRef<number | null>(null);

  const vvTimerRef = useRef<number | null>(null);     // visualViewport debounce

  const handledWRef = useRef<number>(-1);
  const handledHRef = useRef<number>(-1);

  // add near handledWRef/handledHRef
  const reflowRunningRef = useRef(false);   // guards width reflow
  const reflowAgainRef = useRef<"none" | "width" | "height">("none");
  const reflowQueuedCauseRef = useRef<string>("");   // ← remember why a reflow was queued
  const repaginationRunningRef = useRef(false);    // guards height-only repagination

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

  const applyZoomFromRef = useCallback((): void => {
    const inst = osmdRef.current;
    if (!inst) { return; }

    const z = zoomFactorRef.current;
    if (typeof z !== "number" || !Number.isFinite(z)) { return; }

    const clamped = Math.max(0.5, Math.min(3, z));

    // Only touch Zoom if the instance actually exposes it
    if (hasZoomProp(inst)) {
      const curr = inst.Zoom;
      if (!Number.isFinite(curr) || Math.abs(curr - clamped) > 0.001) {
        try { inst.Zoom = clamped; } catch { }
      }
    }
  }, []);


  // --- WIDTH-SANDBOXED RENDER (safe) ---
  // Render OSMD at a computed “layout width” derived from wrapper width and current zoom.
  // We temporarily pin the inner host <div> to that width (the “sandbox”), invoke osmd.render(),
  // then restore the host’s styles in finally. No persistent DOM/CSS changes.
  // Safe to call from both init and reflow paths.
  const renderViewer = useCallback(
    async (
      outer: HTMLDivElement,
      osmd: OpenSheetMusicDisplay
    ): Promise<void> => {
      const host = svgHostRef.current;
      if (!host || !outer) { return; }

      const prevFuncTag = outer.dataset.viewerFunc ?? "";
      outer.dataset.viewerFunc = "renderViewer";

      // Use our zoom source of truth
      applyZoomFromRef();
      const zf = Math.min(3, Math.max(0.5, zoomFactorRef.current || 1));

      const hostW = Math.max(1, Math.floor(outer.clientWidth));
      const rawLayoutW = Math.max(1, Math.floor(hostW / zf));

      const widthNudge = REFLOW.WIDTH_NUDGE;
      const MAX_LAYOUT_W = REFLOW.MAX_LAYOUT_W;
      const MIN_LAYOUT_W = REFLOW.MIN_LAYOUT_W;
      const layoutW = Math.max(MIN_LAYOUT_W, Math.min(rawLayoutW + widthNudge, MAX_LAYOUT_W));

      outer.dataset.viewerZf = String(zf);
      outer.dataset.viewerLayoutW = String(layoutW);

      // Capture prior inline styles (so we can restore them exactly)
      const svg = getSvg(outer);
      const prevLeft = host.style.left;
      const prevRight = host.style.right;
      const prevWidth = host.style.width;
      const prevSvgTO = svg?.style.transformOrigin ?? "";

      try {
        // Style sandbox: let width drive layout just for this call
        host.style.left = "0";
        host.style.right = "auto";
        host.style.width = `${layoutW}px`;
        void host.getBoundingClientRect(); // ensure style applies this frame

        // Let spinner/host paint before the heavy render
        await waitForPaint(300);

        await logStep(`layoutW: ${layoutW} hostW: ${hostW} zf: ${zf.toFixed(3)} osmd.Zoom: ${osmd.Zoom ?? "n/a"}`, { outer });

        // Timed core render (isolates synchronous OSMD work)
        perfBlock(
          nextPerfUID(outer.dataset.viewerRun),
          () => { osmd.render(); },
          (ms) => { void logStep(`osmd.render() runtime: ${ms}ms`, { outer }); }
        );
      } catch (e) {
        void logStep(`render:error ${(e as Error)?.message ?? e}`, { outer });
        throw e;
      } finally {
        try { outer.dataset.viewerFunc = prevFuncTag; } catch { }

        // Restore EXACT previous inline styles
        host.style.left = prevLeft;
        host.style.right = prevRight;
        host.style.width = prevWidth;

        // Restore prior transform anchor exactly (or remove if you prefer to let applyPage() set it)
        if (svg) { svg.style.transformOrigin = prevSvgTO; }
      }
    },
    [applyZoomFromRef, nextPerfUID]
  );

  const hideBusy = useCallback(() => {
    setBusy(false);
    setBusyMsg(DEFAULT_BUSY_MSG);
  }, []);


  // Spinner helpers config (used by both init + reflow)
  const SPINNER_FAILSAFE_MS = 9000 as const;

  const startSpinner = useCallback(
    async (
      opts?: string | { message?: string; gatePaint?: boolean }
    ): Promise<void> => {
      const msg =
        typeof opts === "string" || opts === undefined
          ? (opts ?? DEFAULT_BUSY_MSG)
          : (opts.message ?? DEFAULT_BUSY_MSG);

      const gatePaint =
        typeof opts === "object" && opts !== null
          ? Boolean(opts.gatePaint)
          : true;

      const token = Symbol("spin");
      spinnerOwnerRef.current = token;

      setBusyMsg(msg);
      setBusy(true);

      // Let overlay mount/paint (best-effort)
      if (gatePaint) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (document.visibilityState === "visible") {
          await Promise.race([
            new Promise<void>((r) => requestAnimationFrame(() => r())),
            new Promise<void>((r) => setTimeout(r, 120)),
          ]);
        }
      }

      // (Re)arm fail-safe — silent on fire (per your request)
      if (spinnerFailSafeRef.current) {
        window.clearTimeout(spinnerFailSafeRef.current);
      }
      spinnerFailSafeRef.current = window.setTimeout(() => {
        spinnerOwnerRef.current = null;
        hideBusy();
      }, SPINNER_FAILSAFE_MS);
    },
    [hideBusy]
  );

  const stopSpinner = useCallback(
    async (): Promise<void> => {
      spinnerOwnerRef.current = null;
      if (spinnerFailSafeRef.current) {
        window.clearTimeout(spinnerFailSafeRef.current);
        spinnerFailSafeRef.current = null;
      }

      hideBusy();

      // Give the UI a beat to commit the un-busy frame
      await new Promise<void>((r) => setTimeout(r, 0));
      if (document.visibilityState === "visible") {
        await Promise.race([
          new Promise<void>((r) => requestAnimationFrame(() => r())),
          new Promise<void>((r) => setTimeout(r, 180)),
        ]);
      }
    },
    [hideBusy]
  );

  // Log snapshot (lean)
  const formatRunSnapshot = useCallback((): string => {
    const pages = Math.max(1, pageStartIdxsRef.current.length);
    const page = Math.max(1, Math.min(pageIdxRef.current + 1, pages));
    const queued = reflowAgainRef.current; // "none" | "width" | "height"
    const zf = (zoomFactorRef.current ?? 1).toFixed(3);

    const parts = [`page=${page}/${pages}`, `zf=${zf}`];
    if (queued !== "none") { parts.push(`queued=${queued}`); }
    return parts.join(" ");
  }, []);

  // ---- callback ref proxies (used by queued window.setTimeouts) ----
  const reflowFnRef = useRef<ReflowCallback>(async () => { });

  const repagFnRef = useRef<() => void>(() => { });

  const vpHRef = useVisibleViewportHeight();

  const getViewportH = useCallback((outer: HTMLDivElement): number => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const vvH = vv ? Math.floor(vv.height) : 0;
    const outerH = outer.clientHeight || 0;
    const docH = Math.floor(document.documentElement?.clientHeight || 0);

    // If VV and wrapper disagree a lot (URL/tool bars mid-animation),
    // be conservative and take the smaller so we never overfill page 1.
    let base: number;
    if (vvH && outerH && Math.abs(vvH - outerH) > 24) {
      base = Math.min(vvH, outerH);
    } else {
      base = outerH || vvH || docH;
    }

    return Math.max(1, Math.floor(base) - Math.max(0, topGutterPx));
  }, [topGutterPx]
  );

  const bottomPeekPad = useCallback(
    () => ((window.devicePixelRatio || 1) >= 2
      ? REFLOW.BOTTOM_PEEK_PAD_HI_DPR
      : REFLOW.BOTTOM_PEEK_PAD_LO_DPR),
    []
  );

  const visiblePageHeight = useCallback(
    (outer: HTMLDivElement) => Math.max(1, getViewportH(outer) - bottomPeekPad()),
    [getViewportH, bottomPeekPad]
  );

  // --- Unify pagination height (memoized so identity is stable) ---
  const paginationHeight = useCallback(
    (outer: HTMLDivElement) => visiblePageHeight(outer) + REFLOW.PAGE_FILL_SLOP_PX,
    [visiblePageHeight]
  );


  // Apply the chosen page to the viewport: translate the SVG to its start and mask/cut to hide any next-page peek.
  // May recompute page starts and re-apply to preserve whole systems; bounded recursion prevents oscillation.
  const applyPage = useCallback(
    (pageIdx: number, depth: number = 0): void => {
      const outer = wrapRef.current;
      if (!outer) { return; }

      const prevFuncTag = outer.dataset.viewerFunc ?? "";
      outer.dataset.viewerFunc = "applyPage";

      try {
        // Bail if recursion depth exceeds APPLY_MAX_PASSES (prevents oscillation).
        // This allows up to 3 recursive passes; the 4th would bail.
        if (depth > APPLY_MAX_PASSES) {
          outer.dataset.viewerPhase = "applyPage:bailout";
          void logStep(`bail: recursion depth>${APPLY_MAX_PASSES} at pageIdx=${pageIdx}`, { outer });
          return;
        }

        void logStep(`pageIdx: ${pageIdx} depth: ${depth}`, { outer });
        const svg = getSvg(outer);
        if (!svg) {
          return;
        }

        const bands = systemBandsRef.current;
        const starts = pageStartIdxsRef.current;
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

        // Snap *at or below* the measured top to avoid shaving the first staff by a px.
        const ySnap = Math.floor(startBand.top);

        svg.style.transform = `translateY(${-ySnap + Math.max(0, topGutterPx)}px)`;
        svg.style.transformOrigin = "top left";
        svg.style.willChange = "transform";

        const nextStartIndex = clampedPage + 1 < starts.length ? (starts[clampedPage + 1] ?? -1) : -1;

        const hVisible = visiblePageHeight(outer);

        // Use the *same* height for starts and masking to avoid shaving bottoms.
        const TOL = (window.devicePixelRatio || 1) >= 2 ? 2 : 1;
        const PAGE_H = hVisible;

        // If the top of the next system is already inside the window...
        // Only repaginate when the *entire* next system would not fit.
        if (nextStartIndex >= 0) {
          const nextBand = bands[nextStartIndex];
          if (nextBand) {
            const nextBottomRel = nextBand.bottom - ySnap;

            if (nextBottomRel > hVisible - TOL) {
              const fresh = computePageStarts(outer, bands, PAGE_H);
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
                  pageStartIdxsRef.current = fresh;
                  applyPage(lb, depth + 1);
                  return;
                }
              }
            }
          }
        }

        // --- last-page margin rule: push final system to a new page if too close ---
        const LAST_PAGE_BOTTOM_PAD_PX = REFLOW.LAST_PAGE_BOTTOM_PAD_PX;

        if (nextStartIndex < 0) { // we are on the last page
          let cutIdx = -1;

          for (let i = startIndex; i < bands.length; i++) {
            const b = bands[i];
            if (!b) { continue; }
            const relBottom = b.bottom - ySnap;

            if (relBottom > hVisible - LAST_PAGE_BOTTOM_PAD_PX) {
              cutIdx = i;
              break;
            }
          }

          if (cutIdx !== -1 && cutIdx > startIndex) {
            const freshStarts = starts.slice(0, clampedPage + 1);
            if (freshStarts[freshStarts.length - 1] !== cutIdx) {
              freshStarts.push(cutIdx);
              pageStartIdxsRef.current = freshStarts;
            }
            applyPage(clampedPage, depth + 1);
            return;
          }
          // If cutIdx === startIndex, the single system is taller than the page; do nothing.
        }


        // stale page-starts guard: recompute if last-included doesn't fit
        // roughly MASK_BOTTOM_SAFETY_PX + (PEEK_GUARD - 2), avoids edge-shave on Hi-DPR
        const SAFETY = (window.devicePixelRatio || 1) >= 2 ? 12 : 10;
        const assumedLastIdx = (clampedPage + 1 < starts.length)
          ? Math.max(startIndex, (starts[clampedPage + 1] ?? startIndex) - 1)
          : Math.max(startIndex, bands.length - 1);

        const assumedLast = bands[assumedLastIdx];
        const lastBottomRel = assumedLast ? (assumedLast.bottom - ySnap) : 0;

        if (assumedLast && lastBottomRel > hVisible - SAFETY) {
          const freshStarts = computePageStarts(outer, bands, PAGE_H);
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
              pageStartIdxsRef.current = freshStarts;
              applyPage(nearest, depth + 1);
              return;
            }
          }
        }

        // --- compute mask top in page-local space (music coords relative to ySnap) ---
        const MASK_BOTTOM_SAFETY_PX = REFLOW.MASK_BOTTOM_SAFETY_PX;
        const PEEK_GUARD = (window.devicePixelRatio || 1) >= 2
          ? REFLOW.PEEK_GUARD_HI_DPR
          : REFLOW.PEEK_GUARD_LO_DPR;

        const lastIncludedIdx = (nextStartIndex >= 0)
          ? Math.max(startIndex, nextStartIndex - 1)
          : Math.max(startIndex, bands.length - 1);

        const lastBand = bands[lastIncludedIdx]!;
        const relBottom = lastBand.bottom - ySnap;
        const nextTopRel = (nextStartIndex >= 0 ? bands[nextStartIndex]!.top - ySnap : Number.POSITIVE_INFINITY);

        // Always cut right under the last included system.
        // If the next system is near, also respect a guard below its top.
        const LOW_NUDGE = (window.devicePixelRatio || 1) >= 2 ? 2 : 1;
        const low = Math.ceil(relBottom) + Math.max(0, MASK_BOTTOM_SAFETY_PX - LOW_NUDGE);
        const high = Math.min(hVisible, Math.floor(nextTopRel) - PEEK_GUARD);

        // Prefer the low edge; if bounds invert by rounding, clamp to visible height.
        // (This removes the need for a "peeks" boolean so the mask never leaves a large gulf.)
        const maskTopWithinMusicPx =
          (low <= high) ? Math.max(0, low) : Math.min(Math.max(0, low), hVisible);

        // Breadcrumbs
        outer.dataset.viewerLastApply = String(Date.now());
        outer.dataset.viewerPage = String(pageIdxRef.current);
        outer.dataset.viewerMaskTop = String(maskTopWithinMusicPx);
        outer.dataset.viewerPages = String(pages);
        outer.dataset.viewerStarts = starts.slice(0, 12).join(',');
        outer.dataset.viewerTy = String(-ySnap + Math.max(0, topGutterPx));
        outer.dataset.viewerH = String(hVisible);

        logStep(`apply page: ${clampedPage + 1}/${pages} startIndex: ${startIndex} nextStartIndex: ${nextStartIndex} ` +
          `hVisible: ${hVisible} maskTopWithinMusicPx: ${maskTopWithinMusicPx}`, { outer }
        );

        if (debugOverlays) {
          debugDrawBands(outer, bands, {
            tag: `apply p${clampedPage + 1}`,
            starts,
            startIndex,
            nextStartIndex,
            ySnap,                       // ceil(startBand.top)
            drawPageLocal: true,
            visibleAbsY: Math.max(0, topGutterPx) + hVisible,
            pageAbsY: Math.max(0, topGutterPx) + paginationHeight(outer),
            maskAbsY: Math.max(0, topGutterPx) + maskTopWithinMusicPx,
            topGutter: Math.max(0, topGutterPx),
          });
        } else {
          clearDebugLayers(outer);
        }

        let mask = outer.querySelector<HTMLDivElement>("[data-viewer-mask='1']");
        if (!mask) {
          mask = document.createElement("div");
          mask.dataset.viewerMask = "1";
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

        // --- bottom cutter (only when there is actual peek) ---
        let bottomCutter = outer.querySelector<HTMLDivElement>("[data-viewer-bottomcutter='1']");
        const needsMask = maskTopWithinMusicPx < hVisible;
        // Keep the cutter minimal; its only job is to hide sub-pixel slivers at the very bottom edge
        const CUTTER_PX = needsMask ? 1 : 0;

        if (!bottomCutter) {
          bottomCutter = document.createElement("div");
          bottomCutter.dataset.viewerBottomcutter = "1";
          Object.assign(bottomCutter.style, {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "0",
            background: "#fff",
            pointerEvents: "none",
            zIndex: "6",
          });
          outer.appendChild(bottomCutter);
        }
        // collapse when not needed; tiny guard only when peek occurs
        bottomCutter.style.height = `${CUTTER_PX}px`;
        bottomCutter.style.display = CUTTER_PX === 0 ? "none" : "block";

        let topCutter = outer.querySelector<HTMLDivElement>("[data-viewer-topcutter='1']");
        if (!topCutter) {
          topCutter = document.createElement("div");
          topCutter.dataset.viewerTopcutter = "1";
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

        // Stop layer promotion after page is applied
        if (svg) { svg.style.willChange = "auto"; }
      } finally {
        try { outer.dataset.viewerFunc = prevFuncTag; } catch { }
      }
    },
    [visiblePageHeight, topGutterPx, paginationHeight, debugOverlays]
  );

  // Hide the SVG host while we do heavy work, then restore previous styles.
  const withHostHidden = useCallback(async <T,>(
    outer: HTMLDivElement,
    work: () => Promise<T>
  ): Promise<T> => {
    const host = svgHostRef.current;
    let prevVis = "";
    let prevCv = "";
    if (host) {
      prevVis = host.style.visibility || "";
      prevCv = host.style.getPropertyValue("content-visibility") || "";
      host.style.removeProperty("content-visibility");
      host.style.visibility = "hidden";
      try { void host.getBoundingClientRect().width; } catch { /* layout flush */ }
    }
    try {
      return await work();
    } finally {
      if (host) {
        if (prevCv) { host.style.setProperty("content-visibility", prevCv); }
        else { host.style.removeProperty("content-visibility"); }
        if (prevVis) { host.style.visibility = prevVis; }
        else { host.style.removeProperty("visibility"); }
      }
    }
  }, []);


  /** layoutViewer
   * Full layout pipeline:
   *   renderViewer()  → scanSystemsPx() → computePageStarts() → applyPage(0)
   * Optionally double-applies page 1 to settle masking; bounded by a paint gate.
   * Returns {bands, starts} for callers to stash.
   */
  const layoutViewer = useCallback(async (
    outer: HTMLDivElement,
    osmd: OpenSheetMusicDisplay,
    opts?: {
      gateLabel?: string;     // label for after-paint breadcrumb
      gateMs?: number;        // paint gate timeout
      doubleApply?: boolean;  // whether to applyPage(0) twice (reflow=yes, init=no)
    }
  ): Promise<{ bands: Band[]; starts: number[] }> => {
    const { gateLabel = "apply:first", gateMs = 400, doubleApply = true } = opts ?? {};

    const prevFuncTag = outer.dataset.viewerFunc ?? "";
    outer.dataset.viewerFunc = "layoutViewer";
    outer.dataset.viewerPhase = "render";
    await logStep("phase starting", { outer });

    try {
      const ap = makeAfterPaint(outer);

      await withHostHidden(outer, async () => {
        const uid = nextPerfUID(outer.dataset.viewerRun);
        await perfBlockAsync(
          uid,
          async () => { await renderViewer(outer, osmd); },
          (ms) => {
            outer.dataset.viewerRenderMs = String(ms);
            void logStep(`renderViewer() runtime: ${ms}ms`, { outer });
          }
        );
      });

      await new Promise<void>((r) => setTimeout(r, 0)); // yield one task

      await logStep("phase finished", { outer });
      outer.dataset.viewerPhase = "scan";
      await logStep("phase starting", { outer });

      const svgForPack = getSvg(outer);
      if (!svgForPack) {
        outer.dataset.viewerFatal = "no-svg";
        outer.dataset.viewerErr = "OSMD did not produce an <svg> element.";
        throw new Error("No SVG produced by OSMD render");
      }
      assertHasSystemGroups(outer, svgForPack);

      // 1) pack within pages
      packSystemsWithinPages(outer, svgForPack);

      // 2) flatten seams between pages
      const preBands = withSvgAtUnitScale(outer, (svg) => scanSystemsPx(outer, svg)) ?? [];
      if (preBands.length) {
        flattenEngravedSeams(outer, svgForPack, preBands);
      }

      const bands = perfBlock(
        nextPerfUID(outer.dataset.viewerRun),
        () => withSvgAtUnitScale(outer, (svg) => scanSystemsPx(outer, svg)) ?? [],
        (ms) => { void logStep(`scanSystemsPx() runtime: ${ms}ms`, { outer }); }
      );

      rebuildFlowMap(outer, bands);

      if (debugOverlays) {
        debugDrawBands(outer, bands, {
          tag: "scan",
          visibleAbsY: Math.max(0, topGutterPx) + visiblePageHeight(outer),
          pageAbsY: Math.max(0, topGutterPx) + paginationHeight(outer),
          topGutter: Math.max(0, topGutterPx),
        });
      } else {
        clearDebugLayers(outer);
      }

      const visH = visiblePageHeight(outer);
      const starts = perfBlock(
        nextPerfUID(outer.dataset.viewerRun),
        () => computePageStarts(outer, bands, visH),
        (ms) => { void logStep(`computePageStarts() runtime: ${ms}ms visH: ${visH}`, { outer }); }
      );

      try {
        // 1) Lightweight human-readable lines via logStep (eslint-ok inside logStep)
        await logStep(
          `bands=${bands.length} starts=[${starts.join(",")}] ` +
          `visibleH=${visiblePageHeight(outer)} paginationH=${paginationHeight(outer)}`,
          { outer }
        );

        // If you want per-band rows (still short enough to read in DevTools Console column)
        const rows = bands.map((b, i) =>
          `#${i} top=${Math.round(b.top)} bottom=${Math.round(b.bottom)} h=${Math.round(b.height)}`
        );
        // Split into a few chunks so each line stays short
        for (let k = 0; k < rows.length; k += 10) {
          await logStep(`bandRows ${k}-${Math.min(k + 9, rows.length - 1)}: ${rows.slice(k, k + 10).join(" | ")}`, { outer });
        }

        // 2) Machine-friendly dump on the wrapper (inspect via Elements → dataset)
        outer.dataset.viewerBandsDump = JSON.stringify(
          bands.map((b, i) => ({ i, top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }))
        );
        outer.dataset.viewerStartsDump = JSON.stringify(starts);

      } catch { }

      if (debugOverlays) {
        debugDrawBands(outer, bands, {
          tag: "starts",
          starts,
          visibleAbsY: Math.max(0, topGutterPx) + visiblePageHeight(outer),
          pageAbsY: Math.max(0, topGutterPx) + paginationHeight(outer),
          topGutter: Math.max(0, topGutterPx),
        });
      }

      // HUD & edge-lines (debug only)
      if (debugOverlays) {
        const startIndex0 = starts[0] ?? 0;
        const nextIndex0 = starts.length > 1 ? (starts[1] ?? -1) : -1;
        const ySnap0 = Math.ceil(bands[startIndex0]?.top ?? 0);

        drawHud(outer, {
          pageIdx: 0,
          pages: starts.length,
          startIndex: startIndex0,
          nextStartIndex: nextIndex0,
          ySnap: ySnap0,
          translateY: -ySnap0 + Math.max(0, topGutterPx),
          visibleH: visiblePageHeight(outer),
          paginationH: paginationHeight(outer),
          maskTop: visiblePageHeight(outer),
          startTop: bands[startIndex0]?.top,
          startBottom: bands[startIndex0]?.bottom,
          nextTop: nextIndex0 >= 0 ? bands[nextIndex0]?.top : undefined,
          nextBottom: nextIndex0 >= 0 ? bands[nextIndex0]?.bottom : undefined,
        });

        const rawIdxs: number[] = [startIndex0];
        if (nextIndex0 >= 0) { rawIdxs.push(nextIndex0); }

        drawSystemEdgeLines(
          outer,
          bands,
          rawIdxs,
          "raw",
          ySnap0,
          Math.max(0, topGutterPx)
        );
      }

      await logStep("phase finished", { outer });
      outer.dataset.viewerPhase = "apply";
      await logStep("phase starting", { outer });

      pageStartIdxsRef.current = starts;
      systemBandsRef.current = bands;
      pageIdxRef.current = 0;

      await perfBlockAsync(
        nextPerfUID(outer.dataset.viewerRun),
        async () => {
          applyPage(0);
          await Promise.race([ap(gateLabel, gateMs), new Promise<void>((r) => setTimeout(r, gateMs))]);
          if (doubleApply) { applyPage(0); }
        },
        (ms) => { void logStep(`applyPage() runtime: ${ms}ms`, { outer }); }
      );

      await logStep(`bands: ${bands.length} pages: ${starts.length}`, { outer });

      return { bands, starts };

    } finally {
      try { outer.dataset.viewerFunc = prevFuncTag; } catch { }
    }
  }, [nextPerfUID, renderViewer, withHostHidden, paginationHeight, applyPage, visiblePageHeight, topGutterPx, debugOverlays]);


  // --- HEIGHT-ONLY REPAGINATION (no OSMD re-init) ---
  const paginateViewer = useCallback((): void => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    // Prevent overlap
    if (repaginationRunningRef.current) { return; }
    repaginationRunningRef.current = true;

    const prevFuncTag = outer.dataset.viewerFunc ?? "";
    outer.dataset.viewerFunc = "paginateViewer";

    try {
      outer.dataset.viewerRecompute = String(Date.now());

      const bands = systemBandsRef.current;
      if (bands.length === 0) {
        void logStep("bands: 0 - exit", { outer });
        return;
      }

      // Recompute page starts using the SAME height that masking uses
      rebuildFlowMap(outer, bands);

      const visH = visiblePageHeight(outer);
      const starts = perfBlock(
        nextPerfUID(outer.dataset.viewerRun),
        () => computePageStarts(outer, bands, visH),
        (ms) => { void logStep(`computePageStarts runtime: ${ms}ms visibleH: ${visH}`, { outer }); }
      );

      pageStartIdxsRef.current = starts;
      outer.dataset.viewerPages = String(starts.length);

      // Always reset to page 1 after repagination
      perfBlock(
        nextPerfUID(outer.dataset.viewerRun),
        () => { applyPage(0); },
        (ms) => { void logStep(`applyPage runtime: ${ms}ms`, { outer }); }
      );

    } finally {
      // Drain any queued work that accumulated while we were repaginating
      const queued = reflowAgainRef.current;
      reflowAgainRef.current = "none";
      reflowQueuedCauseRef.current = "";

      if (queued === "width") {
        setTimeout(() => { reflowFnRef.current(); }, 0);
      } else if (queued === "height") {
        setTimeout(() => { repagFnRef.current(); }, 0);
      }

      // Update “handled” height so future VV height changes compare against it
      handledHRef.current = outer.clientHeight || handledHRef.current;

      repaginationRunningRef.current = false;

      outer.dataset.viewerFunc = prevFuncTag;
    }
  }, [applyPage, visiblePageHeight, nextPerfUID]);


  // keep ref pointing to latest repagination callback
  useEffect(() => {
    repagFnRef.current = paginateViewer;
  }, [paginateViewer]);


  /** reflowViewer
   * Heavy path for when effective layout width changes (width/zoom/DPR etc.).
   * Shows spinner, bumps run#, calls layoutViewer(), drains any queued work.
   * Concurrency-safe via reflowRunningRef; may queue a follow-up if invoked again mid-run.
   */
  const reflowViewer = useCallback(
    async function reflowViewer(): Promise<void> {
      const outer = wrapRef.current;
      const osmd = osmdRef.current;

      if (!outer) {
        console.warn("[reflowViewer][prep] early-bail outer=0 osmd=" + (osmd ? "1" : "0"));
        return;
      }

      const prevFuncTag = outer.dataset.viewerFunc ?? "";
      outer.dataset.viewerFunc = "reflowViewer";
      outer.dataset.viewerPhase = "prep";
      await logStep("phase starting", { outer });

      let started = false;

      try {
        if (!osmd) {
          void logStep("early-bail outer=1 osmd=0", { outer });
          return;
        }

        if (reflowRunningRef.current) {
          reflowAgainRef.current = "width";
          const run = Number(outer.dataset.viewerRun || "0");
          outer.dataset.viewerReflowQueued = String(run);
          outer.dataset.viewerReflowQueueWhy = "reflowRunning";
          outer.dataset.viewerReflowQueuedAt = String(Date.now());
          void logStep("reflow already in progress; queued follow-up", { outer });
          return;
        }

        started = true;

        reflowRunningRef.current = true;

        const run = (Number(outer.dataset.viewerRun || "0") + 1);
        outer.dataset.viewerRun = String(run);
        void logStep(`run: ${run} • ${formatRunSnapshot()}`, { outer });

        const currW = outer.clientWidth;
        const currH = outer.clientHeight;
        handledWRef.current = currW; // prime "handled" now, not only at the end
        handledHRef.current = currH;

        try {
          outer.dataset.viewerReflowTargetW = String(currW);
          outer.dataset.viewerReflowTargetH = String(currH);
        } catch { }

        await startSpinner({ message: DEFAULT_BUSY_MSG, gatePaint: true });
        await logStep("spinner started", { outer });

        const { bands, starts } = await layoutViewer(outer, osmd, {
          gateLabel: "reflowViewer",
          gateMs: 400,
          doubleApply: true
        });
        outer.dataset.viewerBands = String(bands.length);
        outer.dataset.viewerPages = String(starts.length);

        await logStep("phase finished", { outer });

      } finally {
        if (started) {
          try { outer.dataset.viewerPhase = "finally"; } catch { }
          await logStep("phase starting", { outer });

          // we finished a run; drop the guard before hiding spinner
          reflowRunningRef.current = false;

          // spinner end + small paint gate
          await stopSpinner();
          await logStep("spinner stopped", { outer });

          // clear breadcrumbs
          outer.dataset.viewerReflowTargetW = "";
          outer.dataset.viewerReflowTargetH = "";

          // drain any queued work
          const queued = reflowAgainRef.current;
          const cause = reflowQueuedCauseRef.current || "drain:finally";
          reflowAgainRef.current = "none";
          reflowQueuedCauseRef.current = "";

          if (queued === "width") {
            await logStep(`draining queued width reflow (cause=${cause})`, { outer });
            setTimeout(() => { reflowFnRef.current(); }, 0);
          } else if (queued === "height") {
            await logStep(`draining queued height repagination (cause=${cause})`, { outer });
            setTimeout(() => { repagFnRef.current(); }, 0);
          }

          await logStep("phase finished", { outer });
        }
        try { outer.dataset.viewerFunc = prevFuncTag; } catch { }
        try { outer.dataset.viewerPhase = ""; } catch { }
      }

    },
    [layoutViewer, formatRunSnapshot, startSpinner, stopSpinner]
  );

  // keep ref pointing to latest width-reflow callback
  useEffect(() => {
    reflowFnRef.current = reflowViewer;
  }, [reflowViewer]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) { return; }

    el.dataset.viewerProbeMounted = "1";
  }, []);

  // Record baseline zoom/scale at mount (used to compute relative zoom later)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const initial = (vv && typeof vv.scale === "number") ? vv.scale : (window.devicePixelRatio || 1);
    baseScaleRef.current = initial || 1;
    zoomFactorRef.current = 1;
  }, []);

  // Reflow only for actual zoom; never start immediately, just queue safely.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;

    let lastScale = vv?.scale ?? 1;
    let lastDpr = window.devicePixelRatio || 1;
    let kick: number | null = null;

    const schedule = (why: "vv-scale" | "dpr") => {
      // Ignore before first layout is fully ready
      if (!readyRef.current) {
        void logStep(`ignored (pre-ready) reason=${why}`);
        return;
      }

      // Debounce a burst of zoom changes
      if (kick !== null) { window.clearTimeout(kick); }
      kick = window.setTimeout(() => {
        kick = null;

        const before = zoomFactorRef.current;
        zoomFactorRef.current = computeZoomFactor();

        // Only act if zoom actually changed
        if (Math.abs(zoomFactorRef.current - before) < 0.003) { return; }

        void logStep(`debounced zf=${zoomFactorRef.current.toFixed(3)} reason=${why}`);

        // Queue only; let our normal drain paths run it when safe
        reflowAgainRef.current = "width";
        reflowQueuedCauseRef.current = `zoom:${why}`;

        if (reflowRunningRef.current || repaginationRunningRef.current || busyRef.current) {
          void logStep("queued width reflow (guard busy)");
          return;
        }

        // If we're idle, drain the queue ourselves on the next tick
        window.setTimeout(() => {
          if (
            reflowAgainRef.current === "width" &&
            !reflowRunningRef.current &&
            !repaginationRunningRef.current &&
            !busyRef.current
          ) {
            reflowAgainRef.current = "none";
            reflowFnRef.current();
          }
        }, 0);
      }, 220);
    };

    const onVVScale = () => {
      const s = vv?.scale ?? 1;
      if (Math.abs(s - lastScale) > 0.003) {
        lastScale = s;
        schedule("vv-scale");
      }
    };

    const pollDPR = () => {
      const d = window.devicePixelRatio || 1;
      if (Math.abs(d - lastDpr) > 0.003) {
        lastDpr = d;
        schedule("dpr");
      }
    };

    vv?.addEventListener("resize", onVVScale);
    vv?.addEventListener("scroll", onVVScale);
    const t = window.setInterval(pollDPR, 400);

    return () => {
      vv?.removeEventListener("resize", onVVScale);
      vv?.removeEventListener("scroll", onVVScale);
      window.clearInterval(t);
      if (kick !== null) { window.clearTimeout(kick); }
    };
  }, [computeZoomFactor]);

  /** initViewer
   * One-time boot for the component:
   * - feature checks, dynamic import of OSMD
   * - load MusicXML (MXL/URL), wait for fonts
   * - first layout via layoutViewer, then height-only repagination
   * - marks ready & clears the spinner
   */
  useEffect(function initViewer() {
    (async () => {
      const host = svgHostRef.current;
      const outer = wrapRef.current;
      if (!host || !outer) { return; }

      const prevFuncTag = outer.dataset.viewerFunc ?? "";
      outer.dataset.viewerFunc = "initViewer";
      outer.dataset.viewerPhase = "prep";
      await logStep("phase starting", { outer });

      try {
        const epoch = ++initEpochRef.current;
        outer.dataset.viewerInitEpoch = String(epoch);

        // If a newer init started (src changed), abort this one quietly.
        const isStale = () => outer.dataset.viewerInitEpoch !== String(epoch);

        try {
          const hasVV =
            typeof window !== "undefined" &&
            !!window.visualViewport &&
            typeof window.visualViewport.scale === "number";

          const hasRO =
            typeof window !== "undefined" &&
            "ResizeObserver" in window &&
            typeof window.ResizeObserver === "function";

          outer.dataset.viewerCapVv = hasVV ? "1" : "0";
          outer.dataset.viewerCapRo = hasRO ? "1" : "0";

          await logStep(`hasVV: ${hasVV ? "yes" : "no"} hasRO: ${hasRO ? "yes" : "no"}`, { outer });

          if (!hasVV) {
            // Hard-fail policy
            outer.dataset.viewerPhase = "fatal:no-visual-viewport";
            outer.dataset.viewerFatal = "1";
            setBusyMsg("This viewer requires the Visual Viewport API for correct zoom & pagination.\nTry a modern browser (Chrome, Edge, Safari 16+).");
            setBusy(true); // show blocking overlay with the message
            await logStep("fatal: visualViewport unavailable — aborting init", { outer });
            return; // stop init right here
          }
          if (isStale()) { return; }

        } catch { }

        // --- Dynamic import OSMD ---
        const mod = await perfBlockAsync(
          nextPerfUID(outer.dataset.viewerRun),
          async () => await import("opensheetmusicdisplay"),
          (ms) => { void logStep(`import("opensheetmusicdisplay") runtime: ${ms}ms`, { outer }); }
        );
        const { OpenSheetMusicDisplay: OSMDClass } =
          mod as typeof import("opensheetmusicdisplay");

        // Fresh instance
        if (osmdRef.current) {
          osmdRef.current?.clear();
          (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
          osmdRef.current = null;
        }
        const osmd = new OSMDClass(host, {
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

        await startSpinner({ message: DEFAULT_BUSY_MSG, gatePaint: true });
        await logStep("spinner started", { outer });

        await logStep("phase finished", { outer });
        outer.dataset.viewerPhase = "load";
        await logStep("phase starting", { outer });

        let loadInput: string | Document | ArrayBuffer | Uint8Array = src;

        if (src.startsWith("/api/")) {
          const ab = await perfBlockAsync(
            nextPerfUID(outer.dataset.viewerRun),
            async () => {
              const res = await fetch(src, { cache: "no-store" });
              if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

              const buf = await withTimeout(res.arrayBuffer(), 12000, "fetch timeout");
              outer.dataset.viewerZipBytes = String(buf.byteLength);
              return buf;
            },
            (ms) => {
              const bytes = outer.dataset.viewerZipBytes ?? "?";
              void logStep(`fetch() + arrayBuffer() runtime: ${ms}ms bytes: ${bytes}`, { outer });
            }
          );

          const uzMod = await perfBlockAsync(
            nextPerfUID(outer.dataset.viewerRun),
            async () => await withTimeout(import("unzipit"), 4000, "unzipit timeout"),
            (ms) => { void logStep(`import("unzipit") runtime: ${ms}ms`, { outer }); }
          );
          const { unzip } = uzMod as typeof import("unzipit");

          const { entries } = await perfBlockAsync(
            nextPerfUID(outer.dataset.viewerRun),
            async () => await withTimeout(unzip(ab), 8000, "unzip timeout"),
            (ms) => { void logStep(`unzip() runtime: ${ms}ms`, { outer }); }
          );

          const container = entries["META-INF/container.xml"];
          if (!container) {
            await logStep("container.xml missing → abort", { outer });
            throw new Error("MXL error: META-INF/container.xml missing");
          }

          const containerXml = await perfBlockAsync(
            nextPerfUID(outer.dataset.viewerRun),
            async () => {
              const s = await withTimeout(container.text(), 6000, "container.text timeout");
              outer.dataset.viewerContainerChars = String(s.length);
              return s;
            },
            (ms) => {
              const chars = outer.dataset.viewerContainerChars ?? "?";
              void logStep(`container.text() runtime: ${ms}ms chars: ${chars}`, { outer });
            }
          );

          const cdoc = perfBlock(
            nextPerfUID(outer.dataset.viewerRun),
            () => new DOMParser().parseFromString(containerXml, "application/xml"),
            (ms) => { void logStep(`DOMParser().parseFromString() runtime: ${ms}ms`, { outer }); }
          );

          const rootEl =
            cdoc.querySelector('rootfile[full-path]') ||
            cdoc.querySelector('rootfile[path]') ||
            cdoc.querySelector('rootfile[href]');

          const fullPath =
            rootEl?.getAttribute("full-path") ||
            rootEl?.getAttribute("path") ||
            rootEl?.getAttribute("href") ||
            "";

          if (!fullPath) {
            await logStep("container rootfile path missing → abort", { outer });
            throw new Error("MXL error: container.xml lacks a rootfile path");
          }

          if (!entries[fullPath]) {
            await logStep(`container rootfile not in ZIP (${fullPath}) → abort`, { outer });
            throw new Error(`MXL error: rootfile entry not found in archive: ${fullPath}`);
          }

          const entry = entries[fullPath]!;
          const xmlText = await perfBlockAsync(
            nextPerfUID(outer.dataset.viewerRun),
            async () => await withTimeout(entry.text(), 10000, "entry.text() timeout"),
            (ms) => { void logStep(`entry.text() runtime: ${ms}ms`, { outer }); }
          );
          outer.dataset.viewerZipChosen = fullPath;
          outer.dataset.viewerZipChars = String(xmlText.length);

          const xmlDoc = await perfBlockAsync(
            nextPerfUID(outer.dataset.viewerRun),
            async () => new DOMParser().parseFromString(xmlText, "application/xml"),
            (ms) => { void logStep(`DOMParser().parseFromString runtime: ${ms}ms`, { outer }); }
          );

          if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error("xmlDoc.getElementsByTagName parsererror");
          }
          const hasPartwise = xmlDoc.getElementsByTagName("score-partwise").length > 0;
          const hasTimewise = xmlDoc.getElementsByTagName("score-timewise").length > 0;
          await logStep(`xmlDoc.getElementsByTagName() hasPartwise: ${String(hasPartwise)} hasTimewise: ${String(hasTimewise)}`, { outer });
          if (!hasPartwise && !hasTimewise) {
            throw new Error("xmlDoc.getElementsByTagName() no partwise or timewise");
          }

          {
            let serializeMs = 0;
            const serialized = perfBlock(
              nextPerfUID(outer.dataset.viewerRun),
              () => new XMLSerializer().serializeToString(xmlDoc),
              (ms) => { serializeMs = ms; }
            );
            outer.dataset.viewerXmlChars = String(serialized.length);
            await logStep(`XMLSerializer().serializeToString runtime: ${serializeMs}ms chars: ${serialized.length}`, { outer });
            loadInput = serialized;
          }
        } else {
          // Non-API source: pass `src` straight to OSMD.load(...)
          // - If `src` is a URL/path to a plain MusicXML file (e.g. "/scores/foo.musicxml" or "https://…"),
          //   OSMD.load(...) will fetch it internally.
          // - If `src` is already a MusicXML XML string, OSMD.load(...) will parse it directly.
          // - (We only take the manual fetch + unzip path for "/api/*" endpoints that return MXL/ZIP content.)
          // In other words: non-API = plain MusicXML, so no special handling here.
          loadInput = src;
        }

        await perfBlockAsync(
          nextPerfUID(outer.dataset.viewerRun),
          async () => {
            await loadOSMD(osmd, loadInput);
          },
          (ms) => {
            void logStep(`loadOSMD() runtime: ${ms}ms`, { outer });
          }
        );

        await perfBlockAsync(
          nextPerfUID(outer.dataset.viewerRun),
          async () => { await waitForFonts(); },
          (ms) => { void logStep(`waitForFonts() runtime: ${ms}ms`, { outer }); }
        );

        await logStep("phase finished", { outer });

        const { bands, starts } = await layoutViewer(outer, osmd, {
          gateLabel: "initViewer",
          gateMs: 450,
          doubleApply: false
        });
        outer.dataset.viewerBands = String(bands.length);
        outer.dataset.viewerPages = String(starts.length);

        // Immediately recompute page starts using the *final* visible height.
        // Why: on first load, the browser/UI chrome (URL/tool bars) can settle a frame
        // or two later. This cheap pass does height-only pagination (no OSMD render),
        // resets to page 1, and ensures we’re not showing a split system at the bottom.
        paginateViewer();

        // Record the dimensions we just handled. The VisualViewport listener compares
        // future vv events against these to decide:
        //   - width changed -> full reflow (layoutViewer via reflowViewer)
        //   - height only   -> quick repagination
        // We capture them here once at the end of init; the width-reflow path updates
        // these itself at the start of each run.
        handledWRef.current = outer.clientWidth;
        handledHRef.current = outer.clientHeight;

        // Mark the viewer as “ready” so zoom/DPR listeners become active.
        // This is a one-time toggle per init and is never set in the reflow path.
        readyRef.current = true;

        // First page is applied and masking is in place — hide the overlay now.
        // In the reflow path the spinner is ended in its `finally` block.
        // because a fatal no-VV path sets busy directly and must keep the overlay visible.
        await stopSpinner();
        await logStep("spinner stopped", { outer });

      } finally {
        try { outer.dataset.viewerPhase = "finally"; } catch { }
        await logStep("phase starting", { outer });

        await logStep("phase finished", { outer });

        try { outer.dataset.viewerFunc = prevFuncTag; } catch { }
        try { outer.dataset.viewerPhase = ""; } catch { }
      }

    })().catch(async (err: unknown) => {
      // If init crashed after startSpinner, close the spinner immediately.
      // (Fatal no-visualViewport path never sets spinnerOwnerRef, so it stays up.)
      if (spinnerOwnerRef.current) {
        try { await stopSpinner(); } catch { }
      } else {
        hideBusy(); // fallback for any older/non-spinner busy state
      }

      const outerNow = wrapRef.current;
      const msg = err instanceof Error ? err.message :
        typeof err === "string" ? err :
          JSON.stringify(err);

      if (outerNow) {
        outerNow.setAttribute("data-viewer-step", "init-crash");
        outerNow.dataset.viewerErr = String(msg).slice(0, 180);
      }
    });

    return () => {
      try {
        if (initFinalizeTimerRef.current) {
          window.clearTimeout(initFinalizeTimerRef.current);
          initFinalizeTimerRef.current = null;
        }
      } catch { }

      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
    };
    // Only re-init when source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, debugShowAllMeasureNumbers]);


  /** Paging helpers */
  // --- Stuck-page guard: ensure forward/back actually lands on the next/prev start ---
  const tryAdvance = useCallback(
    (dir: 1 | -1) => {
      if (busyRef.current) { return; }

      const starts = pageStartIdxsRef.current;
      const pages = starts.length;
      if (!pages) { return; }

      const beforePage = pageIdxRef.current;
      const targetPage = Math.max(0, Math.min(beforePage + dir, pages - 1));
      if (targetPage === beforePage) { return; }

      // The start index we want to land on after any recompute
      const desiredStart = starts[targetPage] ?? starts[beforePage] ?? 0;

      applyPage(targetPage);

      // If we didn't actually move, rebuild page starts and retry *toward* desiredStart.
      window.requestAnimationFrame(() => {
        if (pageIdxRef.current !== beforePage) { return; } // we moved – all good

        const outer = wrapRef.current;
        if (!outer) { return; }

        const fresh = computePageStarts(outer, systemBandsRef.current, paginationHeight(outer));
        if (!fresh.length) { return; }

        pageStartIdxsRef.current = fresh;

        // pick first start >= desiredStart (forward) or last start <= desiredStart (backward)
        let idx: number;
        if (dir === 1) {
          idx = fresh.findIndex((s) => s >= desiredStart);
          if (idx < 0) { idx = fresh.length - 1; }
        } else {
          let firstGreater = fresh.findIndex((s) => s > desiredStart);
          if (firstGreater < 0) { firstGreater = fresh.length; }
          idx = Math.max(0, firstGreater - 1);
        }

        if (idx !== beforePage) { applyPage(idx); }
      });
    },
    [applyPage, paginationHeight]
  );

  const goNext = useCallback(() => tryAdvance(1), [tryAdvance]);
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
        const last = Math.max(0, pageStartIdxsRef.current.length - 1);
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
      if (!readyRef.current || busyRef.current || e.touches.length === 0) {
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
    outer.addEventListener("touchmove", onTouchMove, { passive: false });
    outer.addEventListener("touchend", onTouchEnd, { passive: true });

    outer.style.overscrollBehavior = "contain";

    const cleanupOuter = outer;
    return () => {
      cleanupOuter.removeEventListener("touchstart", onTouchStart);
      cleanupOuter.removeEventListener("touchmove", onTouchMove);
      cleanupOuter.removeEventListener("touchend", onTouchEnd);
    };
  }, [goNext, goPrev]);

  // Recompute pagination when the visual viewport changes (URL bar, IME, orientation, etc.)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) { return; }

    const handleVVChange = () => {
      if (!readyRef.current) { return; }

      // debounce vv events
      if (vvTimerRef.current) { window.clearTimeout(vvTimerRef.current); }
      vvTimerRef.current = window.setTimeout(async () => {
        vvTimerRef.current = null;

        const outerNow = wrapRef.current;
        if (!outerNow) { return; }

        const prevFuncTag = outerNow.dataset.viewerFunc ?? "";
        outerNow.dataset.viewerFunc = "handleVVChange";

        try {
          // Current wrapper (host) size in CSS px
          const wrapW = outerNow.clientWidth;
          const wrapH = outerNow.clientHeight;

          // Current VisualViewport metrics (for diagnosis only)
          const vvW = Math.floor(vv?.width ?? 0);
          const vvH = Math.floor(vv?.height ?? 0);
          const vvScale = (vv?.scale ?? (window.devicePixelRatio || 1));

          // What we last handled (used to decide if work is needed)
          const handledWrapW = handledWRef.current;
          const handledWrapH = handledHRef.current;

          const widthChanged =
            handledWrapW === -1 || Math.abs(wrapW - handledWrapW) >= 1;
          const heightChanged =
            handledWrapH === -1 || Math.abs(wrapH - handledWrapH) >= 1;

          // Only log when we're going to act; keeps noise down long-term.
          if (widthChanged || heightChanged) {
            await logStep(
              `wrap: ${wrapW}×${wrapH} vv: ${vvW}×${vvH} scale: ${vvScale.toFixed(3)} ` +
              `handled: ${handledWrapW}×${handledWrapH} ΔW: ${widthChanged} ΔH: ${heightChanged}`,
              { outer: outerNow }
            );
          } else {
            return; // nothing to do
          }

          // Guard against heavy work overlapping
          const kind = widthChanged ? "width" : "height";
          if (busyRef.current) {
            reflowAgainRef.current = kind;
            reflowQueuedCauseRef.current = `vv:guard-busy:${kind}`;
            return;
          }
          if (reflowRunningRef.current) {
            reflowAgainRef.current = kind;
            reflowQueuedCauseRef.current = `vv:guard-reflow:${kind}`;
            return;
          }
          if (repaginationRunningRef.current) {
            reflowAgainRef.current = kind;
            reflowQueuedCauseRef.current = `vv:guard-repag:${kind}`;
            return;
          }

          // Do the work
          if (widthChanged) {
            // Horizontal change → full OSMD reflow + reset to page 1
            await reflowFnRef.current();
            handledWRef.current = wrapW;
            handledHRef.current = wrapH;
          } else {
            // Vertical-only change → cheap repagination (no spinner) + reset to page 1
            repagFnRef.current();
            handledHRef.current = wrapH;
          }
        } finally {
          outerNow.dataset.viewerFunc = prevFuncTag;
        }
      }, 200);
    };

    vv.addEventListener("resize", handleVVChange);
    vv.addEventListener("scroll", handleVVChange);
    return () => {
      vv.removeEventListener("resize", handleVVChange);
      vv.removeEventListener("scroll", handleVVChange);
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
        vvTimerRef.current = null;
      }
    };
  }, []);

  // Auto-clear busy if we linger too long *outside* heavy phases.
  // Heavy phases are exactly: "render" and "scan".
  useEffect(() => {
    if (!busy) { return; }

    const t = window.setTimeout(() => {
      const phase = wrapRef.current?.dataset.viewerPhase ?? "";
      const inHeavy = phase === "render" || phase === "scan";

      if (!inHeavy) {
        hideBusy();
        void logStep("busy:auto-clear");
      } else {
        void logStep(`busy:auto-clear:skipped phase=${phase}`);
      }
    }, 20000);

    return () => window.clearTimeout(t);
  }, [busy, hideBusy]);

  // POST-BUSY QUEUE DRAIN: if width/height work was queued while busy, run it now.
  // These kick off heavy paths; add a tiny breadcrumb, but don't await paint here.
  useEffect(() => {
    if (busy) { return; } // only act when the overlay turned off
    const queued = reflowAgainRef.current;
    reflowAgainRef.current = "none";

    if (queued === "width") {
      const cause = reflowQueuedCauseRef.current || "drain:post-busy";
      reflowQueuedCauseRef.current = "";
      window.setTimeout(() => {
        void logStep(`queue:drain:width cause=${cause}`);
        reflowFnRef.current();
      }, 0);
    } else if (queued === "height") {
      window.setTimeout(() => {
        void logStep("queue:drain:height");
        repagFnRef.current();
      }, 0);
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
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: busy ? "grid" : "none",
    placeItems: "center",
    background: "rgba(0,0,0,0.45)",
    backdropFilter: "blur(2px)",
    cursor: "wait",
  };

  const stopEvent = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={wrapRef}
      data-viewer-wrapper="1"
      data-viewer-probe="v10-pre"
      className={className}
      style={{ /* outline: "4px solid fuchsia", */ ...outerStyle, ...style }}
    >
      {/* OSMD host (SVG goes here) */}
      <div ref={svgHostRef} style={hostStyle} />

      {/* Input-blocking overlay while busy */}
      <div
        ref={overlayRef}
        aria-busy={busy}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={blockerStyle}
        onPointerDown={stopEvent}
        onPointerMove={stopEvent}
        onPointerUp={stopEvent}
        onTouchStart={stopEvent}
        onTouchMove={stopEvent}
        onWheel={stopEvent}
        onScroll={stopEvent}
        onMouseDown={stopEvent}
        onContextMenu={stopEvent}
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
              animation: "viewer-spin 0.9s linear infinite",
            }}
          />
          <div>{busyMsg || DEFAULT_BUSY_MSG}</div>
        </div>
      </div>

      <style>{`@keyframes viewer-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
