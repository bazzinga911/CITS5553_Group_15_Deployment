import geopandas as gpd
from shapely.geometry import Point
from backend.comparisons.max_per_cell import compare
from backend.pipeline.grid import ensure_projected, make_grid_spec, assign_grid_index

def test_compare_max_per_cell_basic():
    # Two points fall in the same cell; dl has a higher max
    orig = gpd.GeoDataFrame({"Te_ppm":[10, 15]},
                             geometry=[Point(115.0,-31.0), Point(115.01,-31.0)], crs=4326)
    dl   = gpd.GeoDataFrame({"Te_ppm":[12, 30]},
                             geometry=[Point(115.0,-31.0), Point(115.02,-31.0)], crs=4326)
    orig = ensure_projected(orig)
    dl   = ensure_projected(dl)
    spec = make_grid_spec(orig, dl, 100_000, str(orig.crs))
    orig_idx = assign_grid_index(orig, spec)
    dl_idx   = assign_grid_index(dl,   spec)

    arr_o, arr_d, arr_c = compare(orig_idx, dl_idx, nx=spec.nx, ny=spec.ny, method="max")
    # The cell containing the points should have dl max (30) - orig max (15) = 15
    assert (arr_c.max() - 15) < 1e-9
