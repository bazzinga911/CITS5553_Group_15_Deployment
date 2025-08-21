# comparisons.py
"""
Comparison methods for grid-based geochemical data.
Each function follows the same interface:

    compare_fn(dl_gdf_idx, orig_gdf_idx, nx, ny) -> (arr_orig, arr_dl, arr_cmp)

- dl_gdf_idx:   GeoDataFrame with DL samples + grid_ix/grid_iy columns
- orig_gdf_idx: GeoDataFrame with original samples + grid_ix/grid_iy columns
- nx, ny:       grid dimensions

Outputs:
- arr_orig: 2D numpy array with summary statistic for original
- arr_dl:   2D numpy array with summary statistic for DL
- arr_cmp:  2D numpy array with comparison result (usually DL – Original)

Available methods: max, mean, median, chi2
"""

import numpy as np
from scipy.stats import chisquare


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper
# ─────────────────────────────────────────────────────────────────────────────

def _fill_stat_array(gdf, nx, ny, stat_func):
    """Helper: compute grid-wise stats and return a filled 2D array."""
    arr = np.zeros((ny, nx), dtype=float)
    if len(gdf) > 0:
        gid = gdf['grid_iy'].values * nx + gdf['grid_ix'].values
        stat = (
            gdf.assign(grid_id=gid)
               .groupby('grid_id')['Te_ppm']
               .agg(stat_func)
        )
        iy = (stat.index.values // nx).astype(int)
        ix = (stat.index.values % nx).astype(int)
        arr[iy, ix] = stat.values
    return arr


# ─────────────────────────────────────────────────────────────────────────────
# Comparison methods
# ─────────────────────────────────────────────────────────────────────────────

def max_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise maximum (DL – Original)."""
    arr_orig = _fill_stat_array(orig_gdf_idx, nx, ny, "max")
    arr_dl   = _fill_stat_array(dl_gdf_idx, nx, ny, "max")
    arr_cmp  = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


def mean_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise mean (DL – Original)."""
    arr_orig = _fill_stat_array(orig_gdf_idx, nx, ny, "mean")
    arr_dl   = _fill_stat_array(dl_gdf_idx, nx, ny, "mean")
    arr_cmp  = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


def median_diff(dl_gdf_idx, orig_gdf_idx, nx, ny):
    """Grid-wise median (DL – Original)."""
    arr_orig = _fill_stat_array(orig_gdf_idx, nx, ny, "median")
    arr_dl   = _fill_stat_array(dl_gdf_idx, nx, ny, "median")
    arr_cmp  = arr_dl - arr_orig
    return arr_orig, arr_dl, arr_cmp


def chi_squared_test(dl_gdf_idx, orig_gdf_idx, nx, ny, bins=10):
    """
    Chi-squared test between DL and Original Te_ppm distributions in each grid cell.

    arr_orig = counts of Original samples per cell
    arr_dl   = counts of DL samples per cell
    arr_cmp  = chi-square statistic per cell (useful as a heatmap)

    Notes:
    - p-values can also be extracted; for now we store χ² stat in arr_cmp.
    - Empty or single-sided cells are set to 0.
    """
    arr_orig = np.zeros((ny, nx), dtype=float)
    arr_dl   = np.zeros((ny, nx), dtype=float)
    arr_cmp  = np.zeros((ny, nx), dtype=float)

    for iy in range(ny):
        for ix in range(nx):
            orig_vals = orig_gdf_idx.query("grid_ix==@ix and grid_iy==@iy")["Te_ppm"].values
            dl_vals   = dl_gdf_idx.query("grid_ix==@ix and grid_iy==@iy")["Te_ppm"].values

            if len(orig_vals) > 0:
                arr_orig[iy, ix] = len(orig_vals)
            if len(dl_vals) > 0:
                arr_dl[iy, ix] = len(dl_vals)

            if len(orig_vals) > 0 and len(dl_vals) > 0:
                # Use same bin edges for both
                data_max = max(orig_vals.max(), dl_vals.max())
                hist_o, bins_edges = np.histogram(orig_vals, bins=bins, range=(0, data_max))
                hist_d, _          = np.histogram(dl_vals, bins=bins, range=(0, data_max))

                # Add small epsilon to avoid divide-by-zero
                chi2, pval = chisquare(hist_d + 1e-6, f_exp=hist_o + 1e-6)

                arr_cmp[iy, ix] = chi2   # alternative: store pval

    return arr_orig, arr_dl, arr_cmp


# ─────────────────────────────────────────────────────────────────────────────
# Registry
# ─────────────────────────────────────────────────────────────────────────────

COMPARISON_METHODS = {
    "max": max_diff,
    "mean": mean_diff,
    "median": median_diff,
    "chi2": chi_squared_test,
}
