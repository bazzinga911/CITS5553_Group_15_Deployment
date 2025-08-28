import geopandas as gpd
from shapely.geometry import Point
from backend.pipeline.grid import (
    DEFAULT_PROJECTED_CRS, ensure_projected,
    make_grid_spec, make_regular_grid, assign_grid_index
)

def test_grid_and_index():
    # Two points 150km apart in EPSG:4326 -> reproject to 3577
    orig = gpd.GeoDataFrame({"Te_ppm":[10]}, geometry=[Point(115.0, -31.0)], crs=4326)
    dl   = gpd.GeoDataFrame({"Te_ppm":[20]}, geometry=[Point(116.5, -31.0)], crs=4326)

    orig = ensure_projected(orig)
    dl   = ensure_projected(dl)
    spec = make_grid_spec(orig, dl, cell_size_m=100_000, crs=str(orig.crs))
    grid = make_regular_grid(spec)

    assert spec.nx >= 1 and spec.ny >= 1
    assert {"ix","iy","Grid_ID"}.issubset(set(grid.columns))

    o_idx = assign_grid_index(orig, spec).iloc[0]
    d_idx = assign_grid_index(dl, spec).iloc[0]
    assert 0 <= o_idx["grid_ix"] < spec.nx
    assert 0 <= o_idx["grid_iy"] < spec.ny
    assert 0 <= d_idx["grid_ix"] < spec.nx
    assert 0 <= d_idx["grid_iy"] < spec.ny
