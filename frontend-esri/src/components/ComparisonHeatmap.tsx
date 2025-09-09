import React, { useEffect, useMemo, useRef, useState } from "react";

type GridFeature = {
  type: "Feature";
  properties: {
    ix: number; iy: number;
    stat_original: number | null;
    stat_dl: number | null;
    cmp: number | null;
    chi2_bins?: number;
    value?: number;
  };
  geometry: { type: string; coordinates: any };
};
type GridFC = { type: "FeatureCollection"; features: GridFeature[] };

type Props = {
  runId: string;
  apiBase?: string;
  method: "max" | "mean" | "median" | "chi2";
  thresholdMode?: "quantile" | "value";
  thresholdValue?: number;
  width?: number;
  cellSizePx?: number;
};

const diverging = (t: number) => {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  const x = 2 * t - 1;
  const r = x > 0 ? 255 : 255 * (1 + x);
  const b = x < 0 ? 255 : 255 * (1 - x);
  const g = 255 - Math.abs(x) * 255 * 0.6;
  return `rgb(${c(r)},${c(g)},${c(b)})`;
};
const sequential = (t: number) => {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  const r = 255 - 180 * t;
  const g = 240 - 210 * t;
  const b = 50 + 180 * t;
  return `rgb(${c(r)},${c(g)},${c(b)})`;
};

export default function ComparisonHeatmap({
  runId, apiBase = "/api", method,
  thresholdMode = "quantile", thresholdValue = 0.9,
  width = 900, cellSizePx = 10,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [grid, setGrid] = useState<GridFC | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; p?: GridFeature["properties"] }>();
  const [ausOutline, setAusOutline] = useState<any>(null);

  useEffect(() => {
    fetch("/static/australia_outline.geojson")
      .then(r => r.json())
      .then(setAusOutline)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiBase}/runs/${runId}/grid.geojson?map_type=difference`);
        const fc: GridFC = await res.json();
        if (live) setGrid(fc);
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [runId, apiBase]);

  const { nx, ny, cmpMin, cmpMax, thr, hotspots } = useMemo(() => {
    if (!grid) return { nx: 0, ny: 0, cmpMin: NaN, cmpMax: NaN, thr: NaN, hotspots: 0 };
    let maxIx = 0, maxIy = 0;
    const vals: number[] = [];
    for (const f of grid.features) {
      const { ix, iy, value } = f.properties;
      if (ix > maxIx) maxIx = ix;
      if (iy > maxIy) maxIy = iy;
      if (value !== null && Number.isFinite(value)) vals.push(value);
    }
    const nx = maxIx + 1, ny = maxIy + 1;
    const min = Math.min(...vals), max = Math.max(...vals);
    let thr = NaN;
    if (vals.length) {
      if (thresholdMode === "quantile") {
        const s = [...vals].sort((a, b) => a - b);
        const pos = (s.length - 1) * thresholdValue;
        const base = Math.floor(pos), rest = pos - base;
        thr = s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
      } else {
        thr = thresholdValue;
      }
    }
    const hotspots = Number.isFinite(thr) ? vals.filter(v => v > thr).length : 0;
    return { nx, ny, cmpMin: min, cmpMax: max, thr, hotspots };
  }, [grid, thresholdMode, thresholdValue]);

  useEffect(() => {
    if (!grid || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const height = (Math.max(...grid.features.map(f => f.properties.iy)) + 1) * cellSizePx;
    canvas.width = width; canvas.height = height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const colorFor = (v: number) => {
      if (!Number.isFinite(v)) return "rgba(0,0,0,0)";
      if (method === "chi2" || "difference" !== "difference") {
        const t = (v - cmpMin) / ((cmpMax - cmpMin) || 1);
        return sequential(Math.max(0, Math.min(1, t)));
      } else {
        const span = Math.max(Math.abs(cmpMin), Math.abs(cmpMax)) || 1;
        const t = (v / (2 * span)) + 0.5;
        return diverging(Math.max(0, Math.min(1, t)));
      }
    };

    const nyLocal = height / cellSizePx;
    for (const f of grid.features) {
      const { ix, iy, value } = f.properties;
      const x = ix * cellSizePx;
      const y = (nyLocal - 1 - iy) * cellSizePx;
      ctx.fillStyle = (value == null ? "rgba(0,0,0,0)" : colorFor(value));
      ctx.fillRect(x, y, cellSizePx, cellSizePx);
    }

    if (ausOutline && ausOutline.features) {
      ctx.save();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 2;
      ausOutline.features.forEach((feat: any) => {
        const coords = feat.geometry.coordinates;
        const polys = feat.geometry.type === "Polygon" ? [coords] : coords;
        for (const poly of polys) {
          for (const ring of poly) {
            ctx.beginPath();
            for (let i = 0; i < ring.length; ++i) {
              const [minx, miny, maxx, maxy] = [0, 0, nx, ny];
              const [gx, gy] = ring[i];
              const px = ((gx - minx) / (maxx - minx)) * width;
              const py = height - ((gy - miny) / (maxy - miny)) * height;
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
      });
      ctx.restore();
    }
  }, [grid, cmpMin, cmpMax, thr, method, width, cellSizePx, mapType, ausOutline]);

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!grid || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ix = Math.floor(cx / cellSizePx);
    const iyFromTop = Math.floor(cy / cellSizePx);
    const nyLocal = canvasRef.current.height / cellSizePx;
    const iy = (nyLocal - 1) - iyFromTop;
    const p = grid.features.find(f => f.properties.ix === ix && f.properties.iy === iy)?.properties;
    setHover({ x: cx, y: cy, p });
  };

  const legendTicks = useMemo(() => {
    if (method === "chi2") {
      const max = Number.isFinite(cmpMax) ? cmpMax : 1;
      return [0, 0.25*max, 0.5*max, 0.75*max, max];
    } else {
      const span = Math.max(Math.abs(cmpMin), Math.abs(cmpMax)) || 1;
      return [-span, -span/2, 0, span/2, span];
    }
  }, [method, cmpMin, cmpMax]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div style={{ fontWeight: 600 }}>
            Difference grid
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Method: <code>{method}</code>
            {Number.isFinite(thr) && <> · Threshold: <b>{thresholdMode === "quantile" ? `${(thresholdValue*100).toFixed(0)}%` : thr}</b></>}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{loading ? "Loading…" : `${nx} × ${ny} cells`}</div>
      </div>

      <div style={{ position: "relative", width, border: "1px solid #eee" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHover(undefined)}
          style={{ display: "block", width, imageRendering: "pixelated", cursor: "crosshair" }}
        />
        {hover?.p && (
          <div
            style={{
              position: "absolute", left: hover.x + 10, top: hover.y + 10,
              background: "white", border: "1px solid #ddd", borderRadius: 8, padding: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: 12
            }}
          >
            <div><b>Cell</b> ({hover.p.ix}, {hover.p.iy})</div>
            <div>Original: {hover.p.stat_original ?? "—"}</div>
            <div>DL: {hover.p.stat_dl ?? "—"}</div>
            <div>cmp: {hover.p.cmp ?? "—"}</div>
            <div>value: {hover.p.value ?? "—"}</div>
            {method === "chi2" && hover.p.chi2_bins != null && <div>chi2 bins: {hover.p.chi2_bins}</div>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 180, height: 14 }}>
          <div style={{
            width: "100%", height: "100%",
            background: (method === "chi2")
              ? "linear-gradient(90deg, #fff1a0, #9a6cd7)"
              : "linear-gradient(90deg, #4da3ff, #ffffff 50%, #ff4d4d)"
          }}/>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, opacity: 0.8 }}>
          {legendTicks.map((t, i) => <span key={i}>{Number.isFinite(t) ? t.toFixed(2) : "—"}</span>)}
        </div>
      </div>
    </div>
  );
}

function ZipList({
  title,
  progress,
  items,
  accent,
}: {
  title: string;
  progress: number;
  items: Array<{ name: string; size: number }>;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200">
      <div className="p-3 flex items-center justify-between">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-neutral-500">{items.length} files</div>
      </div>
      <div className="px-3 pb-3">
        <div className="h-2 w-full rounded bg-neutral-100 overflow-hidden">
          <div className="h-full" style={{ width: `${progress}%`, background: accent }} />
        </div>
        <ul className="mt-3 max-h-60 overflow-auto divide-y divide-neutral-100">
          {items.length === 0 ? (
            <li className="py-3 text-xs text-neutral-500">Listing…</li>
          ) : (
            items.map((f, idx) => (
              <li key={idx} className="py-2 text-sm flex items-center gap-2">
                {/* If FileArchive is not imported here, remove this line or import it */}
                {/* <FileArchive className="h-4 w-4 text-neutral-500" /> */}
                <span className="truncate" title={f.name}>{f.name}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
