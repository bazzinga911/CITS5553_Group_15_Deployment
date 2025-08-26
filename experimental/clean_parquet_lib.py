# -----------------------------------------------------------
# clean_parquet_lib.py
# Core, reusable functions for reading, cleaning, and writing tabular geoscience data.
# Supports .dbf, .shp, .gpkg, .csv, .parquet files and provides cleaning pipelines.
#Requires: pandas, pyarrow
#Optional: geopandas (for .shp/.gpkg), dbfread (for .dbf)
# -----------------------------------------------------------

from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path
from typing import Optional, Tuple, List, Dict

import pandas as pd

# Optional deps for spatial formats
try:
    import geopandas as gpd  # type: ignore
except Exception:
    gpd = None

try:
    from dbfread import DBF  # type: ignore
except Exception:
    DBF = None


# ----------------- Logging & small utils -----------------
def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )


def file_size_bytes(p: Path) -> int:
    return p.stat().st_size if Path(p).exists() else 0


def hash_dataframe(df: pd.DataFrame) -> str:
    """Order-insensitive, schema-stable hash for equality checks."""
    if df.empty:
        return "EMPTY"
    df2 = df.copy()
    df2 = df2.reindex(sorted(df2.columns), axis=1)  # stable column order
    h = pd.util.hash_pandas_object(df2, index=False)
    return hashlib.sha256(h.values.tobytes()).hexdigest()


def timeit(fn, *args, **kwargs):
    """Return (result, seconds)."""
    t0 = time.perf_counter()
    res = fn(*args, **kwargs)
    return res, time.perf_counter() - t0


# ----------------- IO: read attributes -----------------
def read_attributes(
    path: Path | str,
    *,
    layer: Optional[str] = None,
    keep_geometry: bool = False,
) -> pd.DataFrame:
    """
    Reads attributes from:
      .csv, .parquet, .dbf, .shp, .gpkg

    For .shp/.gpkg requires GeoPandas; for .dbf requires dbfread.
    If keep_geometry=False (default), geometry column is dropped.
    """
    p = Path(path)
    suf = p.suffix.lower()

    if suf == ".csv":
        logging.info(f"Reading CSV: {p}")
        return pd.read_csv(p)

    if suf == ".parquet":
        logging.info(f"Reading Parquet: {p}")
        return pd.read_parquet(p)

    if suf == ".dbf":
        if DBF is None:
            raise RuntimeError("Reading .dbf requires 'dbfread' (pip install dbfread).")
        logging.info(f"Reading DBF: {p}")
        table = DBF(str(p), load=True)
        return pd.DataFrame(iter(table))

    if suf in {".shp", ".gpkg"}:
        if gpd is None:
            raise RuntimeError("Reading vector files requires 'geopandas' (pip install geopandas).")
        logging.info(f"Reading vector: {p}")
        gdf = gpd.read_file(p, layer=layer) if (suf == ".gpkg" and layer) else gpd.read_file(p)
        if keep_geometry:
            # Return full GeoDataFrame as a plain DataFrame (keeps geometry column)
            return pd.DataFrame(gdf)
        # Drop geometry column if present
        geom_col = getattr(gdf, "geometry", None)
        if geom_col is not None and hasattr(gdf, "geometry") and gdf.geometry.name in gdf.columns:
            return pd.DataFrame(gdf.drop(columns=gdf.geometry.name))
        return pd.DataFrame(gdf)

    raise RuntimeError(f"Unsupported input type: {p.suffix} (use .csv/.parquet/.dbf/.shp/.gpkg)")


# ----------------- Cleaning -----------------
def apply_cleaning(df: pd.DataFrame, field: str, policy: str = "NA") -> Tuple[pd.DataFrame, int]:
    """
    Apply cleaning to 'field'.

    Policies:
      - 'NA'   : drop rows where field <= 0 (returns removed count)
      - 'ZERO' : coerce field <= 0 or NaN to 0.0 (keep all rows; removed=0)

    Returns: (cleaned_df, rows_removed)
    """
    if field not in df.columns:
        raise RuntimeError(f"Field '{field}' not found. Columns: {list(df.columns)}")

    out = df.copy()
    out[field] = pd.to_numeric(out[field], errors="coerce")

    policy_u = policy.upper()
    if policy_u == "NA":
        before = len(out)
        out = out[out[field] > 0].copy()
        removed = before - len(out)
        return out, removed

    if policy_u == "ZERO":
        mask = out[field].isna() | (out[field] <= 0)
        out.loc[mask, field] = 0.0
        return out, 0

    raise RuntimeError("policy must be 'NA' or 'ZERO'")


# ----------------- Write Parquet -----------------
def write_parquet(
    df: pd.DataFrame,
    out: Path | str,
    *,
    compression: str = "snappy",
) -> int:
    """Write DataFrame to Parquet and return file size in bytes."""
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, compression=compression, engine="pyarrow", index=False)
    return file_size_bytes(out_path)


# ----------------- Pipelines -----------------
def run_pipeline_a_parquet_then_clean(
    df_raw: pd.DataFrame,
    *,
    field: str,
    policy: str,
    outdir: Path | str,
    compression: str = "snappy",
) -> Dict[str, object]:
    """
    Pipeline A: Parquet → Clean
      1) write raw to Parquet (raw_a.parquet)
      2) read back, clean, write cleaned (cleaned_a.parquet)
    """
    outdir = Path(outdir)
    raw_pq = outdir / "raw_a.parquet"
    cleaned_pq = outdir / "cleaned_a.parquet"

    (_, t_write_raw) = timeit(write_parquet, df_raw, raw_pq, compression=compression)
    (df_read, t_read) = timeit(pd.read_parquet, raw_pq)

    df_clean, removed = apply_cleaning(df_read, field, policy)
    (_, t_write_clean) = timeit(write_parquet, df_clean, cleaned_pq, compression=compression)

    return {
        "pipeline": "A (Parquet → Clean)",
        "rows_raw": len(df_raw),
        "rows_clean": len(df_clean),
        "rows_removed": removed,
        "bytes_written": file_size_bytes(raw_pq) + file_size_bytes(cleaned_pq),
        "time_s": round(t_write_raw + t_read + t_write_clean, 4),
        "hash_clean": hash_dataframe(df_clean),
        "artifacts": [str(raw_pq), str(cleaned_pq)],
        "out_parquet": str(cleaned_pq),
    }


def run_pipeline_b_clean_then_parquet(
    df_raw: pd.DataFrame,
    *,
    field: str,
    policy: str,
    outdir: Path | str,
    compression: str = "snappy",
) -> Dict[str, object]:
    """
    Pipeline B: Clean → Parquet
      1) clean in memory
      2) write cleaned to Parquet (cleaned_b.parquet)
    """
    outdir = Path(outdir)
    cleaned_pq = outdir / "cleaned_b.parquet"

    (clean_res, t_clean) = timeit(apply_cleaning, df_raw, field, policy)
    df_clean, removed = clean_res
    (_, t_write_clean) = timeit(write_parquet, df_clean, cleaned_pq, compression=compression)

    return {
        "pipeline": "B (Clean → Parquet)",
        "rows_raw": len(df_raw),
        "rows_clean": len(df_clean),
        "rows_removed": removed,
        "bytes_written": file_size_bytes(cleaned_pq),
        "time_s": round(t_clean + t_write_clean, 4),
        "hash_clean": hash_dataframe(df_clean),
        "artifacts": [str(cleaned_pq)],
        "out_parquet": str(cleaned_pq),
    }
