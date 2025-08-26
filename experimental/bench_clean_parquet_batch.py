# -----------------------------------------------------------
# bench_clean_parquet_batch.py
# Runs benchmarks comparing two data cleaning pipelines on .dbf files in a folder.
# Requires: clean_parquet_lib.py in the same folder.
# -----------------------------------------------------------
# FINAL VERSION
# NOTE: You must have clean_parquet_lib.py in the same folder to run this script.
# -----------------------------------------------------------

import glob
import logging
from pathlib import Path

import clean_parquet_lib as lib  # Part 1 library


# ----------------- Runner -----------------
def bench_folder(base_folder: Path, field: str = "Te_ppm", policy: str = "NA"):
    """
    Run benchmarks for all .dbf files in a folder (skip .shp files).
    """
    files = list(base_folder.glob("*.dbf"))
    if not files:
        print(f"No .dbf files found in {base_folder}")
        return

    outroot = base_folder.parent / "out_parquet_bench"
    for f in files:
        try:
            name = f.stem
            print(f"\n=== Processing {name} ===")

            # Read attributes
            df_raw = lib.read_attributes(f, keep_geometry=False)
            print(f"Loaded {len(df_raw):,} rows, {len(df_raw.columns)} columns")

            # Outdir for this dataset
            outdir = outroot / name

            res_a = lib.run_pipeline_a_parquet_then_clean(
                df_raw, field=field, policy=policy, outdir=outdir / "A"
            )
            res_b = lib.run_pipeline_b_clean_then_parquet(
                df_raw, field=field, policy=policy, outdir=outdir / "B"
            )

            same = res_a["hash_clean"] == res_b["hash_clean"]

            # Print results
            def fmt(r: dict) -> str:
                return (
                    f"{r['pipeline']}\n"
                    f"  rows_raw:      {r['rows_raw']:,}\n"
                    f"  rows_clean:    {r['rows_clean']:,}\n"
                    f"  rows_removed:  {r['rows_removed']:,}\n"
                    f"  bytes_written: {r['bytes_written']:,}\n"
                    f"  time_s:        {r['time_s']}\n"
                    f"  artifacts:     {', '.join(r['artifacts'])}\n"
                )

            print(fmt(res_a))
            print(fmt(res_b))
            print(f"Cleaned datasets identical: {same}")

            faster = "A" if res_a["time_s"] < res_b["time_s"] else "B"
            smaller = "A" if res_a["bytes_written"] < res_b["bytes_written"] else "B"
            print(f"Faster: {faster} | Smaller: {smaller}")

            if same and faster == "B" and smaller == "B":
                print("✅ Success criteria met: B is faster and smaller.")
            else:
                print("ℹ️ Review metrics above.")

        except Exception as e:
            logging.exception(f"Failed: {f} | {e}")


if __name__ == "__main__":
    # Set up paths to your dataset folders
    base_dir = Path("C:\\My Folder\\UWA\\SEM 4\\CITS5553\\Datasets")

    dl_folder = base_dir / "dl"
    orig_folder = base_dir / "original"

    print("=== Running benchmarks for ORIGINAL dataset ===")
    bench_folder(orig_folder, field="Te_ppm", policy="NA")

    print("\n=== Running benchmarks for DL dataset ===")
    bench_folder(dl_folder, field="Te_ppm", policy="NA")


