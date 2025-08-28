# backend/pipeline/run_comparison.py
"""
Run the comparison pipeline:
- Read two GeoParquets (Orig, DL)
- Project to EPSG:3577 (AU Albers)
- Build regular grid (cell size in km)
- Assign grid_ix/grid_iy/Grid_ID to samples
- Call comparison (max for v1)
- Write 3 GeoParquet grids + done flag

Usage:
  python -m backend.pipeline.run_comparison \
      --orig path/or/s3://.../orig.parquet \
      --dl   path/or/s3://.../dl.parquet \
      --out  path/or/s3://.../results/ \
      --cell-km 100 \
      --method max
"""

import argparse
import os
import pandas as pd
import geopandas as gpd

from backend.comparisons.max_per_cell import compare
from backend.pipeline.grid import (
    DEFAULT_PROJECTED_CRS, ensure_projected,
    make_grid_spec, make_regular_grid, assign_grid_index
)
from backend.pipeline.io_s3 import read_points, write_grid, write_text


def _is_s3(path: str) -> bool:
    return path.lower().startswith("s3://")


def _join_arrays_to_grid(grid: gpd.GeoDataFrame, arr_orig, arr_dl, arr_cmp, nx: int, ny: int) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """
    For each cell (iy, ix), set columns from the corresponding array index.
    Assumes grid has columns 'ix' and 'iy'.
    """
    g = grid.copy()
    g["orig_max"] = arr_orig[g["iy"], g["ix"]]
    g["dl_max"]   = arr_dl[g["iy"], g["ix"]]
    g["delta"]    = arr_cmp[g["iy"], g["ix"]]

    orig_grid = g[["Grid_ID", "orig_max", "geometry"]].copy()
    dl_grid   = g[["Grid_ID", "dl_max", "geometry"]].copy()
    comp_grid = g[["Grid_ID", "delta", "geometry"]].copy()
    return orig_grid, dl_grid, comp_grid


def main():
    parser = argparse.ArgumentParser(description="Run comparison pipeline.")
    parser.add_argument("--orig", required=True, help="Original dataset (GeoParquet)")
    parser.add_argument("--dl",   required=True, help="DL dataset (GeoParquet)")
    parser.add_argument("--out",  required=True, help="Output folder (local or s3://)")
    parser.add_argument("--cell-km", type=int, default=100, help="Grid cell size in km")
    parser.add_argument("--method", choices=["max"], default="max", help="Comparison method (v1: max)")
    args = parser.parse_args()

    # 1) Read inputs
    orig = read_points(args.orig)
    dl   = read_points(args.dl)
    req_cols = {"Te_ppm", orig.geometry.name}
    for name, gdf in [("orig", orig), ("dl", dl)]:
        if "Te_ppm" not in gdf.columns:
            raise ValueError(f"{name} is missing 'Te_ppm' column")
        if gdf.geometry is None:
            raise ValueError(f"{name} is missing 'geometry' column")

    # 2) Project to meter CRS
    orig = ensure_projected(orig, DEFAULT_PROJECTED_CRS)
    dl   = ensure_projected(dl,   DEFAULT_PROJECTED_CRS)

    # 3) Grid spec + grid polygons
    cell_m = int(args.cell_km) * 1000
    spec = make_grid_spec(orig, dl, cell_m, str(orig.crs))
    grid = make_regular_grid(spec)

    # 4) Assign indices to points (vectorised)
    orig_idx = assign_grid_index(orig, spec)
    dl_idx   = assign_grid_index(dl,   spec)

    # 5) Compare (Anthony’s algorithm wrapped via our API)
    arr_orig, arr_dl, arr_cmp = compare(orig_idx, dl_idx, nx=spec.nx, ny=spec.ny, method=args.method)

    # 6) Join arrays back to polygons
    orig_grid, dl_grid, comp_grid = _join_arrays_to_grid(grid, arr_orig, arr_dl, arr_cmp, spec.nx, spec.ny)

    # 7) Write outputs
    outdir = args.out.rstrip("/")
    if not _is_s3(outdir):
        os.makedirs(outdir, exist_ok=True)

    write_grid(f"{outdir}/orig_grid.parquet", orig_grid)
    write_grid(f"{outdir}/dl_grid.parquet",   dl_grid)
    write_grid(f"{outdir}/comp_grid.parquet", comp_grid)
    write_text(f"{outdir}/done.flag", "done")

    print(f"✅ Finished: wrote 3 grids + done.flag to {outdir}")


if __name__ == "__main__":
    main()
