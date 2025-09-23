# app/services/comparisons.py
"""
Grid-based comparison methods for geochemical data.

Each function follows the same interface:

    compare_fn(dl_gdf_idx, orig_gdf_idx, nx, ny) -> (arr_orig, arr_dl, arr_cmp)

- dl_gdf_idx:   DataFrame with DL samples + grid_ix/grid_iy columns
- orig_gdf_idx: DataFrame with Original samples + grid_ix/grid_iy columns
- nx, ny:       grid dimensions

Outputs:
- arr_orig: 2D numpy array with summary statistic for original
- arr_dl:   2D numpy array with summary statistic for DL
- arr_cmp:  2D numpy array with (DL – Original)
"""

import numpy as np
import pandas as pd


def _fill_stat_array(gdf: pd.DataFrame, nx: int, ny: int, stat: str) -> np.ndarray:
    """Compute grid-wise stats and return a filled 2D array."""
    arr = np.full((ny, nx), np.nan, dtype=float)
    if gdf is None or len(gdf) == 0:
        return arr

    # linearize grid cell id
    gid = gdf["grid_iy"].values * nx + gdf["grid_ix"].values
    stat_series = (
        gdf.assign(grid_id=gid)
           .groupby("grid_id")["Te_ppm"]
           .agg(stat)  # 'mean' | 'median' | 'max'
    )
    if stat_series.empty:
        return arr

    iy = (stat_series.index.values // nx).astype(int)
    ix = (stat_series.index.values % nx).astype(int)
    arr[iy, ix] = stat_series.values.astype(float)
    return arr


def _safe_diff(a, b):
    mask = np.isfinite(a) & np.isfinite(b)
    out = np.full_like(a, np.nan, dtype=float)
    out[mask] = b[mask] - a[mask]
    return out


def mean_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise mean (DL – Original)."""
    arr_orig = _fill_stat_array(orig_gdf_idx, nx, ny, "mean")
    arr_dl   = _fill_stat_array(dl_gdf_idx,   nx, ny, "mean")
    arr_cmp  = _safe_diff(arr_orig, arr_dl)
    return arr_orig, arr_dl, arr_cmp


def median_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise median (DL – Original)."""
    arr_orig = _fill_stat_array(orig_gdf_idx, nx, ny, "median")
    arr_dl   = _fill_stat_array(dl_gdf_idx,   nx, ny, "median")
    arr_cmp  = _safe_diff(arr_orig, arr_dl)
    return arr_orig, arr_dl, arr_cmp


def max_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise maximum (DL – Original)."""
    arr_orig = _fill_stat_array(orig_gdf_idx, nx, ny, "max")
    arr_dl   = _fill_stat_array(dl_gdf_idx,   nx, ny, "max")
    arr_cmp  = _safe_diff(arr_orig, arr_dl)
    return arr_orig, arr_dl, arr_cmp


# Registry
COMPARISON_METHODS = {
    "mean": mean_diff,
    "median": median_diff,
    "max": max_diff,
}
