import os
import time
import sys
import io
from pathlib import Path
import subprocess
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from zipfile import ZipFile, BadZipFile
from werkzeug.utils import secure_filename
import traceback

# ---- Paths ----
PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR  = PROJECT_ROOT / "backend"
UPLOAD_DIR   = BACKEND_DIR / "uploads"
RESULTS_DIR  = BACKEND_DIR / "results"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# ---- App ----
app = Flask(__name__)
CORS(app)

def _session_dir(base: Path) -> Path:
    d = base / f"session_{time.strftime('%Y%m%d-%H%M%S')}"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _latest_session_dir() -> Path | None:
    sessions = [p for p in RESULTS_DIR.glob("session_*") if p.is_dir()]
    if not sessions:
        return None
    return max(sessions, key=lambda p: p.stat().st_mtime)

ALLOWED_DATA_EXTS = {".parquet", ".csv", ".geojson", ".json", ".shp"}

def _extract_if_zip(path: Path, dest_dir: Path) -> list[Path]:
    """If `path` is a .zip, extract its files into `dest_dir` and return the new file paths.
       Otherwise return [path]."""
    if path.suffix.lower() != ".zip":
        return [path]
    extracted = []
    try:
        with ZipFile(path, "r") as zf:
            for name in zf.namelist():
                if name.endswith("/"):  # skip dirs
                    continue
                safe_name = secure_filename(Path(name).name)
                target = dest_dir / safe_name
                with zf.open(name) as src, open(target, "wb") as dst:
                    dst.write(src.read())
                extracted.append(target)
    except BadZipFile:
        raise ValueError(f"Uploaded file {path.name} is not a valid zip")
    return extracted

def _pick_two_inputs(candidates: list[Path]) -> tuple[Path, Path]:
    """Choose orig & dl files from a list (prefer names containing 'orig'/'dl')."""
    data = []
    seen_shp = set()
    for p in candidates:
        ext = p.suffix.lower()
        if ext in ALLOWED_DATA_EXTS:
            # Keep one .shp per basename (sidecars will sit beside it)
            if ext == ".shp":
                if p.stem in seen_shp:
                    continue
                seen_shp.add(p.stem)
            data.append(p)

    def find_kw(kw):
        for q in data:
            if kw in q.name.lower():
                return q
        return None

    orig = find_kw("orig")
    dl   = find_kw("dl")
    if orig and dl:
        return orig, dl
    return data[0], data[1]

@app.post("/run-comparison")
def run_comparison():
    files = request.files.getlist("files")
    if len(files) != 2:
        return jsonify({"status": "error", "message": "Upload exactly 2 files"}), 400

    upload_dir = _session_dir(UPLOAD_DIR)
    out_dir    = _session_dir(RESULTS_DIR)

    # Save uploads (secure file names)
    saved_paths = []
    for f in files:
        fname = secure_filename(f.filename)
        dest = upload_dir / fname
        f.save(dest.as_posix())
        saved_paths.append(dest)

    # Expand any zips into the same session upload dir
    expanded = []
    for p in saved_paths:
        expanded.extend(_extract_if_zip(p, upload_dir))

    # Pick orig & dl from the expanded list
    try:
        orig, dl = _pick_two_inputs(expanded)
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 400

    env = os.environ.copy()
    env["PYTHONPATH"] = (
        f"{PROJECT_ROOT.as_posix()}:{env.get('PYTHONPATH', '')}"
        if env.get("PYTHONPATH") else PROJECT_ROOT.as_posix()
    )

    cmd = [
        sys.executable, "-m", "backend.pipeline.run_comparison",
        "--orig", orig.as_posix(),
        "--dl",   dl.as_posix(),
        "--out",  out_dir.as_posix(),
        "--cell-km", "100",
        "--method", "max",
    ]

    try:
        proc = subprocess.run(
            cmd, cwd=PROJECT_ROOT.as_posix(),
            env=env, capture_output=True, text=True
        )
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to start pipeline: {e}"}), 500

    if proc.returncode != 0:
        return jsonify({
            "status": "error",
            "message": "Pipeline failed",
            "stderr": proc.stderr,
            "stdout": proc.stdout,
        }), 500

    outputs = {
        "orig_grid": (out_dir / "orig_grid.parquet").as_posix(),
        "dl_grid":   (out_dir / "dl_grid.parquet").as_posix(),
        "comp_grid": (out_dir / "comp_grid.parquet").as_posix(),
        "flag":      (out_dir / "done.flag").as_posix(),
    }

    return jsonify({
        "status": "ok",
        "message": "Finished: wrote 3 grids + done.flag",
        "inputs": {"orig": orig.name, "dl": dl.name},
        "outputs": outputs,
        "stdout": proc.stdout,
    })

@app.get("/results/latest")
def latest_results():
    d = _latest_session_dir()
    if not d:
        return jsonify({"status": "error", "message": "No results yet"}), 404
    return jsonify({
        "status": "ok",
        "session_dir": d.as_posix(),
        "outputs": {
            "orig_grid": (d / "orig_grid.parquet").as_posix(),
            "dl_grid":   (d / "dl_grid.parquet").as_posix(),
            "comp_grid": (d / "comp_grid.parquet").as_posix(),
            "flag":      (d / "done.flag").as_posix(),
        }
    })

@app.get("/export/comp-grid.csv")
def export_comp_grid_csv():
    d = _latest_session_dir()
    if not d:
        return jsonify({"status": "error", "message": "No results"}), 404

    comp_path = d / "comp_grid.parquet"
    if not comp_path.exists():
        return jsonify({"status": "error", "message": "comp_grid.parquet missing"}), 404

    try:
        import geopandas as gpd
    except ImportError:
        return jsonify({"status": "error", "message": "Missing geopandas"}), 500

    try:
        gdf = gpd.read_parquet(comp_path.as_posix())
        if "cell_id" not in gdf.columns:
            gdf = gdf.reset_index().rename(columns={"index": "cell_id"})
        centroids = gdf.geometry.centroid
        out_df = gdf.drop(columns=["geometry"], errors="ignore").copy()
        out_df["centroid_x"] = centroids.x
        out_df["centroid_y"] = centroids.y

        csv_buf = io.StringIO()
        out_df.to_csv(csv_buf, index=False)
        csv_buf.seek(0)
        filename = f"comp_grid_{d.name}.csv"
        return Response(
            csv_buf.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        return jsonify({"status": "error", "message": f"Export failed: {e}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
