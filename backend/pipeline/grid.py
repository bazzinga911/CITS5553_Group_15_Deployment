# backend/pipeline/grid.py
"""
Grid construction and point assignment utilities (projected CRS + vectorised).
"""

from dataclasses import dataclass
import math
import numpy as np
import geopandas as gpd
from shapely.geometry import box


# Use an equal-area CRS for AU by default; change if your project needs others.
DEFAULT_PROJECTED_CRS = "EPSG:3577"  # GDA94 / Australian Albers


@dataclass
class GridSpec:
    minx: float
    miny: float
    cell: float   # cell size in meters
    nx: int
    ny: int
    crs: str


def _ceil_div(length: float, cell: float) -> int:
    return int(math.ceil(length / cell))


def ensure_projected(gdf: gpd.GeoDataFrame, target_crs: str = DEFAULT_PROJECTED_CRS) -> gpd.GeoDataFrame:
    """Reproject to target_crs if needed; require geometry present."""
    if gdf.crs is None:
        # Assume EPSG:4326 if missing; change if your files carry CRS metadata.
        gdf = gdf.set_crs(4326, allow_override=True)
    if str(gdf.crs).upper() != str(target_crs).upper():
        gdf = gdf.to_crs(target_crs)
    return gdf


def make_grid_spec(orig: gpd.GeoDataFrame, dl: gpd.GeoDataFrame, cell_size_m: int, crs: str) -> GridSpec:
    """Compute combined bounds and grid dimensions in the projected CRS."""
    minx1, miny1, maxx1, maxy1 = orig.total_bounds
    minx2, miny2, maxx2, maxy2 = dl.total_bounds
    minx = min(minx1, minx2)
    miny = min(miny1, miny2)
    maxx = max(maxx1, maxx2)
    maxy = max(maxy1, maxy2)

    width  = maxx - minx
    height = maxy - miny
    nx = _ceil_div(width,  cell_size_m)
    ny = _ceil_div(height, cell_size_m)

    return GridSpec(minx=minx, miny=miny, cell=cell_size_m, nx=nx, ny=ny, crs=crs)


def make_regular_grid(spec: GridSpec) -> gpd.GeoDataFrame:
    """Build row-major grid polygons with ix, iy, Grid_ID."""
    polys = []
    ix_all = []
    iy_all = []
    for iy in range(spec.ny):
        y0 = spec.miny + iy * spec.cell
        y1 = y0 + spec.cell
        for ix in range(spec.nx):
            x0 = spec.minx + ix * spec.cell
            x1 = x0 + spec.cell
            polys.append(box(x0, y0, x1, y1))
            ix_all.append(ix)
            iy_all.append(iy)

    grid = gpd.GeoDataFrame(
        {"ix": ix_all, "iy": iy_all},
        geometry=polys,
        crs=spec.crs
    )
    grid["Grid_ID"] = grid["iy"] * spec.nx + grid["ix"]
    return grid


def assign_grid_index(points: gpd.GeoDataFrame, spec: GridSpec) -> gpd.GeoDataFrame:
    """
    Vectorised assignment of (grid_ix, grid_iy, Grid_ID) using floor division.
    Assumes points are in the same projected CRS as the grid spec.
    """
    # Extract coordinates
    xy = np.vstack([points.geometry.x.values, points.geometry.y.values]).T
    gx = np.floor((xy[:, 0] - spec.minx) / spec.cell).astype(int)
    gy = np.floor((xy[:, 1] - spec.miny) / spec.cell).astype(int)

    # Clip to grid extent to avoid -1 or out-of-range
    gx = np.clip(gx, 0, spec.nx - 1)
    gy = np.clip(gy, 0, spec.ny - 1)

    pts = points.copy()
    pts["grid_ix"] = gx
    pts["grid_iy"] = gy
    pts["Grid_ID"] = gy * spec.nx + gx
    return pts
