from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Dict, Literal, Tuple
import base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from app.services.io_service import dataframe_from_upload, dataframe_from_upload_cols  # NEW
from pydantic import BaseModel
from app.services.comparisons import COMPARISON_METHODS
from pyproj import Transformer 

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

def _clean_and_stats(df: pd.DataFrame, assay_col: str) -> Dict[str, float]:
    if assay_col not in df.columns:
        raise ValueError(f"Column '{assay_col}' not found")
    # coerce to numeric, drop NaNs, drop <= 0
    s = pd.to_numeric(df[assay_col], errors="coerce").dropna()
    s = s[s > 0]
    if s.empty:
        return {"count": 0, "mean": None, "median": None, "max": None, "std": None}
    return {
        "count": int(s.shape[0]),
        "mean": float(s.mean()),
        "median": float(s.median()),
        "max": float(s.max()),
        "std": float(s.std(ddof=1)),  # sample std
    }

@router.post("/summary")
async def summary(
    original: UploadFile = File(..., description="Original ESRI .csv or .zip"),
    dl: UploadFile       = File(..., description="DL ESRI .csv or .zip"),
    original_assay: str  = Form(...),
    dl_assay: str        = Form(...),
):
    try:
        df_o = dataframe_from_upload(original)
        df_d = dataframe_from_upload(dl)
        stats_o = _clean_and_stats(df_o, original_assay)
        stats_d = _clean_and_stats(df_d, dl_assay)
        return {"original": stats_o, "dl": stats_d}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class PlotsResponse(BaseModel):
    original_png: str  # base64 (no data: prefix)
    dl_png: str
    qq_png: str

def _clean_series(df: pd.DataFrame, assay_col: str) -> pd.Series:
    if assay_col not in df.columns:
        raise ValueError(f"Column '{assay_col}' not found")
    s = pd.to_numeric(df[assay_col], errors="coerce").dropna()
    s = s[s > 0]
    return s

def _fig_to_b64(fig) -> str:
    import io
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")

@router.post("/plots", response_model=PlotsResponse)
async def plots(
    original: UploadFile = File(..., description="Original ESRI .csv or .zip"),
    dl: UploadFile       = File(..., description="DL ESRI .csv or .zip"),
    original_assay: str  = Form(...),
    dl_assay: str        = Form(...),
):
    try:
        # read only the assay columns (fast)
        df_o = dataframe_from_upload_cols(original, [original_assay])
        df_d = dataframe_from_upload_cols(dl, [dl_assay])

        s_o = _clean_series(df_o, original_assay)
        s_d = _clean_series(df_d, dl_assay)

        # Histogram (Original) with log-spaced bins
        fig1 = plt.figure(figsize=(7,4))
        ax1 = fig1.add_subplot(111)
        bins_o = np.logspace(np.log10(s_o.min()), np.log10(s_o.max()), 50)
        ax1.hist(s_o, bins=bins_o, color="#7C3AED", edgecolor="black")
        ax1.set_xscale("log")
        ax1.set_title(f"Original {original_assay} Distribution")
        ax1.set_xlabel(original_assay)
        ax1.set_ylabel("Count")
        original_png = _fig_to_b64(fig1)

        # Histogram (DL) with log-spaced bins
        fig2 = plt.figure(figsize=(7,4))
        ax2 = fig2.add_subplot(111)
        bins_d = np.logspace(np.log10(s_d.min()), np.log10(s_d.max()), 50)
        ax2.hist(s_d, bins=bins_d, color="#7C3AED", edgecolor="black")
        ax2.set_xscale("log")
        ax2.set_title(f"DL {dl_assay} Distribution")
        ax2.set_xlabel(dl_assay)
        ax2.set_ylabel("Count")
        dl_png = _fig_to_b64(fig2)

        # QQ plot (log–log)
        q = np.linspace(0.01, 0.99, 50)
        qo = np.quantile(s_o, q)
        qd = np.quantile(s_d, q)
        fig3 = plt.figure(figsize=(6,6))
        ax3 = fig3.add_subplot(111)
        ax3.scatter(qo, qd, s=20, color="#7C3AED")
        line = np.linspace(min(qo.min(), qd.min()), max(qo.max(), qd.max()), 100)
        ax3.plot(line, line, "--", linewidth=1)
        ax3.set_xscale("log"); ax3.set_yscale("log")
        ax3.set_title("QQ Plot (log–log): Original vs DL")
        ax3.set_xlabel(f"Original {original_assay} quantiles")
        ax3.set_ylabel(f"DL {dl_assay} quantiles")
        qq_png = _fig_to_b64(fig3)

        return {"original_png": original_png, "dl_png": dl_png, "qq_png": qq_png}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- Helpers for grid comparison (replace old single-cell helpers) ---
def _grid_meta_xy(east: pd.Series, north: pd.Series, cell_x: float, cell_y: float):
    xmin = float(np.floor(east.min()  / cell_x) * cell_x)
    ymin = float(np.floor(north.min() / cell_y) * cell_y)
    nx   = int(((east.max()  - xmin) // cell_x) + 1)
    ny   = int(((north.max() - ymin) // cell_y) + 1)
    return xmin, ymin, nx, ny

def _index_cols_xy(df: pd.DataFrame, easting: str, northing: str,
                   xmin: float, ymin: float, cell_x: float, cell_y: float) -> pd.DataFrame:
    df = df.copy()
    df["grid_ix"] = ((df[easting]  - xmin) // cell_x).astype(int)
    df["grid_iy"] = ((df[northing] - ymin) // cell_y).astype(int)
    return df

def _looks_like_degrees(east: pd.Series, north: pd.Series) -> bool:
    return bool(east.between(-180, 180).all() and north.between(-90, 90).all())

def _to_float(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    df = df.copy()
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna()

@router.post("/comparison")
async def comparison(
    original: UploadFile = File(...),
    dl: UploadFile       = File(...),
    original_northing: str = Form(...),
    original_easting: str  = Form(...),
    original_assay: str    = Form(...),
    dl_northing: str       = Form(...),
    dl_easting: str        = Form(...),
    dl_assay: str          = Form(...),
    method: Literal["mean","median","max"] = Form(...),
    grid_size: float       = Form(...),
    treat_as: Literal["auto","meters","degrees"] = Form("auto"),
):
    try:
        # 1) Read & clean
        df_o = dataframe_from_upload_cols(original, [original_easting, original_northing, original_assay])
        df_d = dataframe_from_upload_cols(dl,       [dl_easting,       dl_northing,       dl_assay])

        df_o = _to_float(df_o, [original_easting, original_northing, original_assay])
        df_d = _to_float(df_d, [dl_easting, dl_northing, dl_assay])
        df_o = df_o[df_o[original_assay] > 0]
        df_d = df_d[df_d[dl_assay] > 0]
        if df_o.empty or df_d.empty:
            raise ValueError("No valid rows after cleaning (assay <= 0 removed).")

        # 2) Decide units, and project to meters if inputs are degrees
        looks_deg = _looks_like_degrees(
            pd.concat([df_o[original_easting], df_d[dl_easting]], ignore_index=True),
            pd.concat([df_o[original_northing], df_d[dl_northing]], ignore_index=True),
        )
        use_degrees = (treat_as == "degrees") or (treat_as == "auto" and looks_deg)

        if use_degrees:
            # Project lon/lat (EPSG:4326) → meters (EPSG:3577)
            transformer = Transformer.from_crs("EPSG:4326", "EPSG:3577", always_xy=True)
            ex_o, ny_o = transformer.transform(df_o[original_easting].values, df_o[original_northing].values)
            ex_d, ny_d = transformer.transform(df_d[dl_easting].values,       df_d[dl_northing].values)
            df_o["__E_m"], df_o["__N_m"] = ex_o, ny_o
            df_d["__E_m"], df_d["__N_m"] = ex_d, ny_d
            e_col_o, n_col_o = "__E_m", "__N_m"
            e_col_d, n_col_d = "__E_m", "__N_m"
            coord_units = "meters"
        else:
            # Already meters
            e_col_o, n_col_o = original_easting, original_northing
            e_col_d, n_col_d = dl_easting,       dl_northing
            coord_units = "meters"

        # 3) Grid meta (meters)
        cell_x = cell_y = float(grid_size)
        e_all = pd.concat([df_o[e_col_o], df_d[e_col_d]], ignore_index=True)
        n_all = pd.concat([df_o[n_col_o], df_d[n_col_d]], ignore_index=True)
        xmin, ymin, nx, ny = _grid_meta_xy(e_all, n_all, cell_x, cell_y)

        # 4) Index + rename assay → Te_ppm
        o_idx = _index_cols_xy(df_o, e_col_o, n_col_o, xmin, ymin, cell_x, cell_y)\
                  .rename(columns={original_assay: "Te_ppm"})
        d_idx = _index_cols_xy(df_d, e_col_d, n_col_d, xmin, ymin, cell_x, cell_y)\
                  .rename(columns={dl_assay: "Te_ppm"})

        # 5) Compute arrays via registry
        fn = COMPARISON_METHODS[method]
        arr_orig, arr_dl, arr_cmp = fn(d_idx, o_idx, nx, ny)

        # 6) Downsample overlay points (in meters)
        def _downsample(df, n=5000):
            return df.sample(n=min(n, len(df)), random_state=42)
        o_pts = _downsample(o_idx)[[e_col_o, n_col_o]].values.tolist()
        d_pts = _downsample(d_idx)[[e_col_d, n_col_d]].values.tolist()

        # 7) Grid centers (meters)
        x = (xmin + (np.arange(nx) + 0.5) * cell_x).tolist()
        y = (ymin + (np.arange(ny) + 0.5) * cell_y).tolist()

        # 8) JSON-safe arrays
        def _to_jsonable(a: np.ndarray):
            return [[(float(v) if np.isfinite(v) else None) for v in row] for row in a]

        return {
            "nx": nx, "ny": ny,
            "xmin": float(xmin), "ymin": float(ymin),
            "cell": float(grid_size),
            "cell_x": float(cell_x),
            "cell_y": float(cell_y),
            "x": x, "y": y,
            "coord_units": coord_units,
            "mean_lat": None,
            "orig": _to_jsonable(arr_orig),
            "dl":   _to_jsonable(arr_dl),
            "cmp":  _to_jsonable(arr_cmp),
            "original_points": o_pts,
            "dl_points": d_pts,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

