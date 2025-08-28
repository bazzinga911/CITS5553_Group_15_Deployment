# max_per_cell.py
"""
Comparison methods (currently only MAX) for grid-based geochemical data.
"""

import numpy as np

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

# ─────────────────────────────────────────────────────────────────────────────
# Registry
# ─────────────────────────────────────────────────────────────────────────────

COMPARISON_METHODS = {
    "max": max_diff
}

def compare(orig_gdf_idx, dl_gdf_idx, nx, ny, method="max"):
    fn = COMPARISON_METHODS[method]
    return fn(dl_gdf_idx, orig_gdf_idx, nx, ny)
