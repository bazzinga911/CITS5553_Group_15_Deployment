// frontend-esri/src/api/data.ts
// Same-origin "/api/*" calls so Render Static Site can rewrite to the backend.
// For local dev, set vite.config.ts proxy:
//   server: { proxy: { "/api": "http://127.0.0.1:8000" } }

export type ColumnsResponse = {
  original_columns: string[];
  dl_columns: string[];
  run_token?: string; // optional, backend may include
};

// API base — empty string means use absolute /api/... paths
const API = "";

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
