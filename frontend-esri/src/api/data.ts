// frontend-esri/src/api/data.ts
// Same host base via VITE_API_BASE; keep /api/... in paths.

export type ColumnsResponse = {
  original_columns: string[];
  dl_columns: string[];
  run_token?: string; // optional, backend may include
};

const API =
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

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

  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<ColumnsResponse>;
}
