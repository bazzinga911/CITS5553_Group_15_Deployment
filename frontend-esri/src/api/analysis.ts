const API = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export type Summary = {
  count: number;
  mean: number | null;
  median: number | null;
  max: number | null;
  std: number | null;
};

export async function runSummary(
  originalFile: File,
  dlFile: File,
  originalAssay: string,
  dlAssay: string
): Promise<{ original: Summary; dl: Summary }> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);
  form.append("original_assay", originalAssay);
  form.append("dl_assay", dlAssay);

  const res = await fetch(`${API}/api/analysis/summary`, {
    method: "POST",
    body: form,
  });

  // Defensive: read as text first to avoid JSON parse crashes masking the real error
  const text = await res.text();

  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!data?.original || !data?.dl) {
    throw new Error("Malformed response: missing 'original' or 'dl'");
  }

  return data;
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
    oN: string;
    oE: string;
    oA: string;
    dN: string;
    dE: string;
    dA: string;
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
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Comparison failed (${res.status})`);
  }
  return res.json();
}
