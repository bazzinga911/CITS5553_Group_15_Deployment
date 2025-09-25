from pydantic import BaseModel
from typing import List, Optional

class ColumnsResponse(BaseModel):
    original_columns: List[str]
    dl_columns: List[str]
    run_token: str  # simple token you can reuse later in the session

class ErrorResponse(BaseModel):
    detail: str
