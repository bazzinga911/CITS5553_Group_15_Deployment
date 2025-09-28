// frontend-esri/src/api/runs.ts
// Uses a same-origin "/api/*" path so Render Static Site can rewrite to the backend.
// In local dev, add this to vite.config.ts:
//   server: { proxy: { "/api": "http://127.0.0.1:8000" } }

const API = ""; // keep endpoints absolute like "/api/…"

export type Summary = {
  count: number;
  mean: number | null;
  median: number | null;
  max: number | null;
  std: number | null;
};

type SummaryResponse = { original: Summary; dl: Summary };

async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text(); // read as text first for better error messages

  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status} ${res.statusText}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON: ${text.slice(0, 300)}`);
  }
}

export async function runSummary(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string
): Promise<SummaryResponse> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("original_assay", originalAssay);
  form.append("dl_assay", dlAssay);

  const data = await fetchJSON(`${API}/api/analysis/summary`, {
    method: "POST",
    body: form,
  });

  if (!data?.original || !data?.dl) {
    throw new Error("Malformed response: missing 'original' or 'dl'");
  }
  return data as SummaryResponse;
}

export async function runPlots(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string
): Promise<{ original_png: string; dl_png: string; qq_png: string }> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("original_assay", originalAssay);
  form.append("dl_assay", dlAssay);

  // This endpoint returns JSON directly; no need for the text-first dance here.
  const res = await fetch(`${API}/api/analysis/plots`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runComparison(
  originalFile: File,
  dlFile: File,
  map: {
    oN: string; // original northing
    oE: string; // original easting
    oA: string; // original assay
    dN: string; // dl northing
    dE: string; // dl easting
    dA: string; // dl assay
  },
  method: "mean" | "median" | "max",
  gridSize: number
) {
  const fd = new FormData();
  fd.append("original", originalFile);
  fd.append("dl", dlFile);

  // MUST match FastAPI field names exactly
  fd.append("original_northing", map.oN);
  fd.append("original_easting", map.oE);
  fd.append("original_assay", map.oA);
  fd.append("dl_northing", map.dN);
  fd.append("dl_easting", map.dE);
  fd.append("dl_assay", map.dA);

  fd.append("method", method);
  fd.append("grid_size", String(gridSize));

  const res = await fetch(`${API}/api/analysis/comparison`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    // Try to pull FastAPI's JSON error detail; fall back to status text
    const err = await res.json().catch(() => ({} as any));
    throw new Error(err?.detail ?? `Comparison failed (${res.status} ${res.statusText})`);
  }
  return res.json();
}
