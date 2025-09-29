from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import data, analysis

app = FastAPI()

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

# Routers
app.include_router(data.router)
app.include_router(analysis.router)

# Health check (keep it under /api to match your style)
@app.get("/api/health")
def health():
    return {"ok": True}

# Optional root (so hitting / doesn’t just 404)
@app.get("/")
def root():
    return {"ok": True, "docs": "/docs", "health": "/api/health"}
