## Pipeline (Eusha)

### First time
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt


# To run the pipeline
python -m backend.pipeline.run_comparison \
  --orig ./Te_ppm_Orig_S_SOWETO.geoparquet \
  --dl   ./Te_ppm_DL_S_SOWETO.geoparquet \
  --out  ./results_soweto \
  --cell-km 100 \
  --method max
