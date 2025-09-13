from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import data, analysis

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(analysis.router)

@app.get("/api/health")
def health():
    return {"ok": True}
