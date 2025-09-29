# backend-esri/app/routers/data.py
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.models.schemas import ColumnsResponse
from app.services.io_service import extract_columns, make_run_token

# No prefix here — main.py will mount this router at prefix="/api/data"
router = APIRouter(tags=["data"])

@router.post("/columns", response_model=ColumnsResponse)
async def get_columns(
    original: UploadFile = File(..., description="Original ESRI .csv or .zip"),
    dl: UploadFile       = File(..., description="DL ESRI .csv or .zip"),
):
    try:
        original_cols = extract_columns(original)
        dl_cols = extract_columns(dl)
        return ColumnsResponse(
            original_columns=original_cols,
            dl_columns=dl_cols,
            run_token=make_run_token(),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
