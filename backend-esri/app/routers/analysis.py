from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Dict
import base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from app.services.io_service import dataframe_from_upload, dataframe_from_upload_cols  # NEW
from pydantic import BaseModel

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
