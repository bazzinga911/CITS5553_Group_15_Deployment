import os
import time
import sys
import io
from pathlib import Path
import subprocess
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

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

@app.post("/run-comparison")
def run_comparison():
    files = request.files.getlist("files")
    if len(files) != 2:
        return jsonify({"status": "error", "message": "Upload exactly 2 files"}), 400

    upload_dir = _session_dir(UPLOAD_DIR)
    out_dir    = _session_dir(RESULTS_DIR)

    saved = []
    for f in files:
        dest = upload_dir / f.filename
        f.save(dest.as_posix())
        saved.append(dest)

    def pick(paths, kw):
        for p in paths:
            if kw.lower() in p.name.lower():
                return p
        return None

    orig = pick(saved, "orig") or saved[0]
    dl   = pick(saved, "dl")   or saved[1]

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
