# backend/app/services/io_service.py
import io
import zipfile
import uuid
import logging
from typing import List, Tuple, Optional

import chardet  # pip install chardet
import pandas as pd
from fastapi import UploadFile

logger = logging.getLogger("io_service")
if not logger.handlers:
    # Basic console logger
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )

ALLOWED = (".csv", ".zip")


def _safe_name(name: str) -> bool:
    n = (name or "").lower().strip()
    return any(n.endswith(ext) for ext in ALLOWED)


def _detect_encoding(sample: bytes) -> str:
    """
    Detect encoding from a small sample. Fall back sensibly.
    """
    if not sample:
        return "utf-8"
    guess = chardet.detect(sample)
    enc = guess.get("encoding") or "utf-8"
    return enc


def _read_header_from_bytes(raw: bytes) -> List[str]:
    """
    Read only the header row from raw CSV bytes, with robust encoding fallbacks.
    """
    # Try a few encodings if needed (utf-8-sig handles BOM)
    candidates = []
    candidates.append(_detect_encoding(raw[:4096]))
    for c in ("utf-8-sig", "utf-8", "latin-1"):
        if c not in candidates:
            candidates.append(c)

    last_err: Optional[Exception] = None
    for enc in candidates:
        try:
            text = raw.decode(enc, errors="ignore")
            df = pd.read_csv(io.StringIO(text), nrows=0)
            logger.info("Header parsed with encoding=%s; columns=%s", enc, list(df.columns))
            return list(df.columns)
        except Exception as e:
            last_err = e
            logger.warning("Header parse failed with encoding=%s: %s", enc, e)

    raise ValueError(f"Could not read header with candidate encodings; last error: {last_err}")


def _read_csv_bytes_to_df(raw: bytes) -> pd.DataFrame:
    """
    Read full CSV to DataFrame with robust encodings.
    """
    candidates = []
    candidates.append(_detect_encoding(raw[:4096]))
    for c in ("utf-8-sig", "utf-8", "latin-1"):
        if c not in candidates:
            candidates.append(c)

    last_err: Optional[Exception] = None
    for enc in candidates:
        try:
            df = pd.read_csv(io.BytesIO(raw), encoding=enc, low_memory=False)
            logger.info("DataFrame read with encoding=%s; shape=%s", enc, df.shape)
            return df
        except Exception as e:
            last_err = e
            logger.warning("DataFrame read failed with encoding=%s: %s", enc, e)

    raise ValueError(f"Could not read CSV with candidate encodings; last error: {last_err}")


def _pick_first_csv_from_zip(zf: zipfile.ZipFile) -> Tuple[str, bytes]:
    """
    Pick the first .csv file in a ZIP (prefer top-level CSVs), return (name, bytes).
    """
    csv_infos = [info for info in zf.infolist() if info.filename.lower().endswith(".csv")]
    if not csv_infos:
        raise ValueError("No CSV file found in ZIP archive.")

    # Prefer top-level CSVs (no folders in name), else just first
    csv_infos.sort(key=lambda i: ("/" in i.filename or "\\" in i.filename, i.filename.lower()))
    target = csv_infos[0]
    with zf.open(target) as fh:
        data = fh.read()
    logger.info("Picked CSV from zip: %s (%d bytes)", target.filename, len(data))
    return target.filename, data


def extract_columns(upload: UploadFile) -> List[str]:
    """
    Accepts .csv directly or a .zip containing .csv; returns header columns.
    Reads only the header row (≤64KB) for both .csv and .zip.
    """
    fname = upload.filename or ""
    logger.info("extract_columns: filename=%s", fname)

    if not _safe_name(fname):
        raise ValueError("Only .csv or .zip files are accepted")

    lower = fname.lower()

    if lower.endswith(".csv"):
        # Read a small chunk; header normally sits at the start
        upload.file.seek(0)
        raw = upload.file.read(65536)
        upload.file.seek(0)
        cols = _read_header_from_bytes(raw)
        logger.info("extract_columns: CSV columns=%s", cols)
        return cols

    # ZIP case
    upload.file.seek(0)
    raw_zip = upload.file.read()
    upload.file.seek(0)
    try:
        with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
            name, csv_bytes = _pick_first_csv_from_zip(zf)
            # For header: we can pass full csv_bytes (usually small header anyway)
            cols = _read_header_from_bytes(csv_bytes[:65536])
            logger.info("extract_columns: ZIP->CSV=%s; columns=%s", name, cols)
            return cols
    except zipfile.BadZipFile:
        raise ValueError("Provided file is not a valid ZIP archive")
    except Exception as e:
        logger.exception("extract_columns failed for ZIP: %s", e)
        raise


def dataframe_from_upload(upload: UploadFile) -> pd.DataFrame:
    """
    Load the entire CSV (or first CSV in ZIP) into a pandas DataFrame.
    """
    fname = (upload.filename or "").lower()
    logger.info("dataframe_from_upload: filename=%s", upload.filename)

    upload.file.seek(0)
    raw = upload.file.read()
    upload.file.seek(0)

    if fname.endswith(".csv"):
        return _read_csv_bytes_to_df(raw)

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        _, csv_bytes = _pick_first_csv_from_zip(zf)
        return _read_csv_bytes_to_df(csv_bytes)


# --- FAST column-only readers for plots ---
def _read_csv_bytes_to_df_cols(raw: bytes, usecols: List[str]) -> pd.DataFrame:
    candidates = []
    candidates.append(_detect_encoding(raw[:4096]))
    for c in ("utf-8-sig", "utf-8", "latin-1"):
        if c not in candidates:
            candidates.append(c)

    last_err: Optional[Exception] = None
    for enc in candidates:
        try:
            df = pd.read_csv(io.BytesIO(raw), encoding=enc, usecols=usecols, low_memory=False)
            logger.info("DataFrame (cols=%s) read with encoding=%s; shape=%s", usecols, enc, df.shape)
            return df
        except Exception as e:
            last_err = e
            logger.warning("DataFrame (cols=%s) read failed with encoding=%s: %s", usecols, enc, e)

    raise ValueError(f"Could not read CSV with candidate encodings; last error: {last_err}")


def dataframe_from_upload_cols(upload: UploadFile, usecols: List[str]) -> pd.DataFrame:
    fname = (upload.filename or "").lower()
    logger.info("dataframe_from_upload_cols: filename=%s usecols=%s", upload.filename, usecols)

    upload.file.seek(0)
    raw = upload.file.read()
    upload.file.seek(0)

    if fname.endswith(".csv"):
        return _read_csv_bytes_to_df_cols(raw, usecols)

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        _, csv_bytes = _pick_first_csv_from_zip(zf)
        return _read_csv_bytes_to_df_cols(csv_bytes, usecols)


def make_run_token() -> str:
    return uuid.uuid4().hex
