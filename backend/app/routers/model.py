from fastapi import APIRouter, HTTPException, UploadFile, File

from app.models.ir_schema import IRGraph, SaveResponse
from app.services.ir_manager import IRManager

router = APIRouter()

# Singleton IR manager for the current session
ir_manager = IRManager()


@router.post("/model/load", response_model=IRGraph)
async def load_model(file: UploadFile = File(...)):
    """Load an .mlir file and return its structured IR graph."""
    content = await file.read()
    mlir_text = content.decode("utf-8")
    try:
        graph = ir_manager.load(mlir_text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse MLIR: {e}")
    return graph


@router.post("/model/save", response_model=SaveResponse)
async def save_model():
    """Serialize the current module to MLIR text and validate it."""
    try:
        text = ir_manager.get_module_text()
        valid, diagnostics = ir_manager.validate()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SaveResponse(mlir_text=text, valid=valid, diagnostics=diagnostics)
