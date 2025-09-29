// frontend-esri/src/api/data.ts
// Use VITE_API_BASE as the backend ROOT (no /api suffix).
// Examples:
//   VITE_API_BASE=https://cits5553-group-15-deployment.onrender.com
//   (local) falls back to http://localhost:8000

export type ColumnsResponse = {
  original_columns: string[];
  dl_columns: string[];
  run_token?: string;
};

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

// normalize: remove trailing slashes
const API = API_BASE.replace(/\/+$/, "");

export async function fetchColumns(
  originalFile: File,
  dlFile: File
): Promise<ColumnsResponse> {
  const form = new FormData();
  form.append("original", originalFile);
  form.append("dl", dlFile);

  const res = await fetch(`${API}/api/data/columns`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ColumnsResponse>;
}
