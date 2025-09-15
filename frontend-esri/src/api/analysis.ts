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

  const res = await fetch(`${API}/api/analysis/summary`, { method: "POST", body: form });

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

  const res = await fetch(`${API}/api/analysis/plots`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
