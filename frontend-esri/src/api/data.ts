// frontend-esri/src/api/data.ts
export type ColumnsResponse = {
  original_columns: string[];
  dl_columns: string[];
  // include if your backend returns it; otherwise it's fine to omit
  run_token?: string;
};

const API = import.meta.env.VITE_API_BASE || "http://localhost:8000";

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
