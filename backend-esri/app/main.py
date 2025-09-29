from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import data, analysis

app = FastAPI(title="ESRI Comparison API")

# Allow frontend (Render static site) + local dev
ALLOWED_ORIGINS = [
    "https://cits5553-group-15-deployment-front-end.onrender.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers with API prefixes so frontend calls match:
#   /api/data/columns
#   /api/analysis/summary
#   /api/analysis/plots
#   /api/analysis/comparison
app.include_router(data.router, prefix="/api/data", tags=["data"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])

# Health check
@app.get("/api/health", tags=["meta"])
def health():
    return {"ok": True}

# Optional root to avoid 404 at /
@app.get("/", include_in_schema=False)
def root():
    return {"ok": True, "docs": "/docs", "health": "/api/health"}
