"""
Defines standard schemas for points and grids.
"""

POINT_SCHEMA = {
    "columns": ["Te_ppm", "geometry", "Grid_ID"],
    "crs": "EPSG:XXXX"  # TODO: replace with chosen projected CRS
}

GRID_SCHEMA = {
    "columns": ["Grid_ID", "orig_max", "dl_max", "delta", "n_orig", "n_dl", "geometry"],
    "crs": "EPSG:XXXX"
}
