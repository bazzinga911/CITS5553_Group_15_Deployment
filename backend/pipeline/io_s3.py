# backend/pipeline/io_s3.py
import geopandas as gpd
import fsspec

def read_points(path: str) -> gpd.GeoDataFrame:
    with fsspec.open(path, "rb") as f:
        return gpd.read_parquet(f)

def write_grid(path: str, gdf: gpd.GeoDataFrame) -> None:
    with fsspec.open(path, "wb") as f:
        gdf.to_parquet(f, index=False)

def write_text(path: str, text: str) -> None:
    with fsspec.open(path, "w") as f:
        f.write(text)
