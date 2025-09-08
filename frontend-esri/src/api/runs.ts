export async function createRun({
  originalZip, dlZip,
  comparison_method,
  chi2_bins = 10,
  negatives = "NA",
  cell_size_m = 100,
  threshold_mode = "quantile",
  threshold_value = 0.9,
}: {
  originalZip: File; dlZip: File;
  comparison_method: "max" | "mean" | "median" | "chi2";
  chi2_bins?: number;
  negatives?: "NA" | "ZERO";
  cell_size_m?: number;
  threshold_mode?: "quantile" | "value";
  threshold_value?: number;
}) {
  const fd = new FormData();
  fd.append("original_zip", originalZip);
  fd.append("dl_zip", dlZip);
  fd.append("comparison_method", comparison_method);
  fd.append("chi2_bins", String(chi2_bins));
  fd.append("negatives", negatives);
  fd.append("cell_size_m", String(cell_size_m));
  fd.append("threshold_mode", threshold_mode);
  fd.append("threshold_value", String(threshold_value));

  const res = await fetch("/api/runs", { method: "POST", body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ run_id: string; summary: any }>;
}
