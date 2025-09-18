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
  initialZoom?: number; // default: 0.9 (90%)
  topGutterPx?: number; // default: 3 (small white space at very top)
  debugShowAllMeasureNumbers?: boolean; // default: false (dev aid)
}

interface Band { top: number; bottom: number; height: number }
interface OSMDZoomable { Zoom: number }

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

const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

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

/** Wait for web fonts to be ready to avoid late reflow on mobile */
async function waitForFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      await fonts.ready;
    }
  } catch {
    // no-op
  }
}

/** Track the *visible* viewport height (accounts for mobile URL/tool bars) */
function useVisibleViewportHeight() {
  const vpRef = useRef<number>(0);
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const update = () => {
      const h =
        (window.visualViewport && Math.floor(window.visualViewport.height)) ||
        Math.floor(document.documentElement.clientHeight);
      if (h && h !== vpRef.current) {
        vpRef.current = h;
        force();
      }
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
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
      if (!next) {
        break;
      }
      const isFirstPage = starts.length === 0 && i === 0;
      const slack = isFirstPage && fuseTitle ? Math.max(12, Math.round(viewportH * 0.06)) : 0;

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
  initialZoom = 0.9, // default to 90%
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

  const vpHRef = useVisibleViewportHeight();

  const getViewportH = useCallback(
    (outer: HTMLDivElement): number => {
      const v = vpHRef.current;
      const raw = v > 0 ? Math.min(v, outer.clientHeight || v) : outer.clientHeight || 0;
      return Math.max(0, raw - Math.max(0, topGutterPx));
    },
    [vpHRef, topGutterPx]
  );

  /** Ensure OSMD zoom is applied before every render */
  const applyZoom = useCallback((): void => {
    const osmd = osmdRef.current as unknown as OSMDZoomable | null;
    if (osmd) {
      const z = Math.max(0.5, Math.min(3, initialZoom ?? 0.9));
      osmd.Zoom = z;
    }
  }, [initialZoom]);

  /** Apply a page index */
  const applyPage = useCallback(
    (pageIdx: number): void => {
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

      const hVisible = getViewportH(outer);


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
          // Re-apply current page; now it ends before cutIdx, next page starts at cutIdx.
          applyPage(clampedPage);
          return;
        }
        // If cutIdx === startIndex, the single system is taller than the page; do nothing.
      }


      // ---- stale page-starts guard: recompute if last-included doesn't fit ----
      const SAFETY = 8; // small buffer
      const assumedLastIdx = (clampedPage + 1 < starts.length)
        ? Math.max(startIndex, (starts[clampedPage + 1] ?? startIndex) - 1)
        : Math.max(startIndex, bands.length - 1);

      const assumedLast = bands[assumedLastIdx];
      const lastBottomRel = assumedLast ? (assumedLast.bottom - startBand.top) : 0;

      if (assumedLast && lastBottomRel > hVisible - SAFETY) {
        // Our breaks were computed for a taller viewport. Fix them now and re-apply.
        const freshStarts = computePageStartIndices(bands, hVisible);
        if (freshStarts.length) {
          pageStartsRef.current = freshStarts;

          // Pick the page whose start index is nearest to our old startIndex
          let nearest = 0;
          let best = Number.POSITIVE_INFINITY;
          for (let i = 0; i < freshStarts.length; i++) {
            const s = freshStarts[i] ?? 0;
            const d = Math.abs(s - startIndex);
            if (d < best) { best = d; nearest = i; }
          }

          applyPage(nearest);
          return; // bail; next run will use corrected starts
        }
      }

      const MASK_BOTTOM_SAFETY_PX = 6; // try 6–8 if needed

      const maskTopWithinMusicPx = (() => {
        if (nextStartIndex < 0) { return hVisible; }

        const lastIncludedIdx = Math.max(startIndex, nextStartIndex - 1);
        const lastBand = bands[lastIncludedIdx];
        if (!lastBand) { return hVisible; }

        const relBottom = lastBand.bottom - startBand.top; // px within page

        // Start the mask just after the last system’s bottom,
        // but NEVER earlier than that (no hard early cutoff).
        const start = Math.min(
          hVisible - 2,                              // keep a tiny gap to avoid rounding artifacts
          Math.max(0, Math.ceil(relBottom) + MASK_BOTTOM_SAFETY_PX)
        );

        // (optional HUD/lines you added can stay as-is; just feed them `relBottom` and `start`)
        return start;
      })();

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
      [getViewportH, topGutterPx]
    );


  const recomputePaginationHeightOnly = useCallback((resetToFirst: boolean = false, showBusy: boolean = false): void => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    const bands = bandsRef.current;
    if (bands.length === 0) { return; }

    try {
      if (showBusy) {
        setBusyMsg(DEFAULT_BUSY);
        setBusy(true);
      }

      const starts = computePageStartIndices(bands, getViewportH(outer));
      const oldStarts = pageStartsRef.current;
      pageStartsRef.current = starts;

      if (resetToFirst) {
        applyPage(0);
        return;
      }

      const oldPage = pageIdxRef.current;
      const oldStartIdx = oldStarts.length
        ? oldStarts[Math.max(0, Math.min(oldPage, oldStarts.length - 1))] ?? 0
        : 0;

      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        if (s === undefined) { continue; }
        const d = Math.abs(s - oldStartIdx);
        if (d < best) { best = d; nearest = i; }
      }
      applyPage(nearest);
    } finally {
      if (showBusy) {
        setBusy(false);
        setBusyMsg(DEFAULT_BUSY);
      }
    }
  }, [applyPage, getViewportH]);

  const reflowOnWidthChange = useCallback(async (resetToFirst: boolean = false): Promise<void> => {
    const outer = wrapRef.current;
    const osmd = osmdRef.current;
    if (!outer || !osmd) { return; }

    // NEW: bail if another render is in progress
    if (busyRef.current) { return; }

    setBusyMsg(DEFAULT_BUSY);
    setBusy(true);
    try {
      await afterPaint();

      applyZoom();
      osmd.render();
      await afterPaint();

      const newBands = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
      if (newBands.length === 0) { return; }
      bandsRef.current = newBands;

      const newStarts = computePageStartIndices(newBands, getViewportH(outer));
      pageStartsRef.current = newStarts;

      if (resetToFirst) {
        applyPage(0);
        return;
      }

      const oldStarts = pageStartsRef.current; // after recompute
      const oldPage = pageIdxRef.current;
      const oldTopSystem =
        oldStarts.length ? oldStarts[Math.max(0, Math.min(oldPage, oldStarts.length - 1))] ?? 0 : 0;

      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < newStarts.length; i++) {
        const s = newStarts[i];
        if (s === undefined) { continue; }
        const d = Math.abs(s - oldTopSystem);
        if (d < best) { best = d; nearest = i; }
      }
      applyPage(nearest);
    } finally {
      setBusy(false);
      setBusyMsg(DEFAULT_BUSY);
    }
  }, [applyZoom, applyPage, getViewportH]);

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

  /** Init OSMD */
  useEffect(() => {
    let resizeObs: ResizeObserver | null = null;
    let lastW = -1;
    let lastH = -1;

    (async () => {
      const host = hostRef.current;
      const outer = wrapRef.current;
      if (!host || !outer) {
        return;
      }

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

      setBusyMsg(DEFAULT_BUSY);
      setBusy(true);
      await afterPaint();

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

      applyZoom();

      await waitForFonts();
      osmd.render();
      await afterPaint();

      purgeWebGL(outer);

      const bands = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
      bandsRef.current = bands;

      pageStartsRef.current = computePageStartIndices(bands, getViewportH(outer));
      pageIdxRef.current = 0;
      applyPage(0);

      readyRef.current = true;

      setBusy(false);
      setBusyMsg(DEFAULT_BUSY);

      resizeObs = new ResizeObserver(() => {
        if (!readyRef.current) { return; }

        const w = outer.clientWidth;
        const h = outer.clientHeight;

        const widthChanged = lastW !== -1 && Math.abs(w - lastW) >= 1;
        const heightChanged = lastH !== -1 && Math.abs(h - lastH) >= 1;

        lastW = w;
        lastH = h;

        // Debounce to avoid reflow storms (esp. big scores)
        if (resizeTimerRef.current) {
          window.clearTimeout(resizeTimerRef.current);
          resizeTimerRef.current = null;
        }
        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;
          if (!readyRef.current || busyRef.current) { return; }
          if (widthChanged) {
            void reflowOnWidthChange(true);                  // reset to page 1, spinner shown by reflow
          } else if (heightChanged) {
            recomputePaginationHeightOnly(true, true);       // reset to page 1, SHOW spinner
          }
        }, 200); // bumped from 120 → 200ms
      });
      
      resizeObs.observe(outer);
      lastW = outer.clientWidth;
      lastH = outer.clientHeight;
    })().catch(() => {
      setBusy(false);
      setBusyMsg(DEFAULT_BUSY);
    });

    const cleanupOuter = wrapRef.current;
    return () => {
      if (resizeObs && cleanupOuter) {
        resizeObs.unobserve(cleanupOuter);
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
  }, [applyZoom, applyPage, recomputePaginationHeightOnly, reflowOnWidthChange, src, getViewportH, debugShowAllMeasureNumbers]);

  /** Paging helpers */
  const goNext = useCallback((): void => {
    if (busy) {
      return;
    }
    const pages = pageStartsRef.current.length;
    if (!pages) {
      return;
    }
    const next = Math.min(pageIdxRef.current + 1, pages - 1);
    if (next !== pageIdxRef.current) {
      applyPage(next);
    }
  }, [applyPage, busy]);

  const goPrev = useCallback((): void => {
    if (busy) {
      return;
    }
    const prev = Math.max(pageIdxRef.current - 1, 0);
    if (prev !== pageIdxRef.current) {
      applyPage(prev);
    }
  }, [applyPage, busy]);

  // Wheel & keyboard paging (disabled while busy)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!readyRef.current || busy) {
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
      if (!readyRef.current || busy) {
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
  }, [applyPage, goNext, goPrev, busy]);

  // Touch swipe paging (disabled while busy)
  useEffect(() => {
    const outer = wrapRef.current;
    if (!outer) {
      return;
    }

    let startY = 0;
    let startX = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (!readyRef.current || busy || e.touches.length === 0) {
        return;
      }
      active = true;
      startY = e.touches[0]?.clientY ?? 0;
      startX = e.touches[0]?.clientX ?? 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active || !readyRef.current || busy) {
        return;
      }
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) {
        return;
      }
      active = false;
      if (busy) {
        return;
      }
      const t = e.changedTouches[0];
      if (!t) {
        return;
      }

      const dy = t.clientY - startY;
      const dx = t.clientX - startX;

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
  }, [goNext, goPrev, busy]);

  // Recompute pagination when the visual viewport height changes (mobile URL/tool bars)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!vv) { return; }

    const onChange = () => {
      if (!readyRef.current) { return; }
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
        vvTimerRef.current = null;
      }
      vvTimerRef.current = window.setTimeout(() => {
        vvTimerRef.current = null;
        if (busyRef.current) { return; }
        recomputePaginationHeightOnly(true, true); // reset to page 1, SHOW spinner
      }, 200); // debounce matches RO
    };

    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
        vvTimerRef.current = null;
      }
    };
  }, [recomputePaginationHeightOnly]);

  /* ---------- Styles ---------- */

  const isFill = fillParent;
  const outerStyle: React.CSSProperties = isFill
    ? {
        width: "100%",
        height: vpHRef.current > 0 ? vpHRef.current : "100%",
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2px)",
        boxSizing: "border-box",
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
    zIndex: 50,
    display: busy ? "grid" : "none",
    placeItems: "center",
    background: "rgba(0,0,0,0.25)",
    backdropFilter: "blur(2px)",
    cursor: "wait",
  };

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={wrapRef} className={className} style={{ ...outerStyle, ...style }}>
      <div ref={hostRef} style={hostStyle} />
      {/* Input-blocking overlay while busy */}
      <div
        aria-busy={busy}
        role="status"
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
