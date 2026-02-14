from fastapi import APIRouter, HTTPException

from app.models.ir_schema import (
    AddOperandRequest,
    AddToOutputRequest,
    CreateOpRequest,
    EditResponse,
    HistoryStatus,
    ModifyAttrRequest,
    OpDefinitionInfo,
    OpParamInfoResponse,
    OpSignatureResponse,
    SetOperandRequest,
)
from app.routers.model import ir_manager
from app.services.dialect_registry import list_dialects, list_ops, get_op_signature
from app.services.notifier import notifier

router = APIRouter()


async def _validate_and_respond(graph):
    """Validate the current module and broadcast status via WebSocket."""
    valid, diagnostics = ir_manager.validate()
    await notifier.broadcast(valid, diagnostics)
    return EditResponse(graph=graph, valid=valid, diagnostics=diagnostics)


@router.post("/undo", response_model=EditResponse)
async def undo():
    """Undo the last edit operation."""
    try:
        graph = ir_manager.undo()
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await _validate_and_respond(graph)


@router.post("/redo", response_model=EditResponse)
async def redo():
    """Redo the last undone edit operation."""
    try:
        graph = ir_manager.redo()
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await _validate_and_respond(graph)


@router.delete("/op/{op_id}", response_model=EditResponse)
async def delete_op(op_id: str):
    """Delete an operation from the IR."""
    try:
        graph = ir_manager.delete_op(op_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await _validate_and_respond(graph)


@router.patch("/op/{op_id}/attributes", response_model=EditResponse)
async def modify_attributes(op_id: str, request: ModifyAttrRequest):
    """Modify attributes on an operation."""
    try:
        graph = ir_manager.modify_attributes(op_id, request.updates, request.deletes)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Attribute error: {e}")
    return await _validate_and_respond(graph)


@router.post("/op/create", response_model=EditResponse)
async def create_op(request: CreateOpRequest):
    """Create a new operation and insert it into the IR."""
    try:
        graph = ir_manager.create_op(
            op_name=request.op_name,
            result_types=request.result_types,
            operands=request.operands,
            attributes=request.attributes,
            block_id=request.insert_point.block_id,
            position=request.insert_point.position,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Create error: {e}")
    return await _validate_and_respond(graph)


@router.put("/op/{op_id}/operand/{index}", response_model=EditResponse)
async def set_operand(op_id: str, index: int, request: SetOperandRequest):
    """Replace an operand at the given index with a different value."""
    try:
        graph = ir_manager.set_operand(op_id, index, request.new_value_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Set operand error: {e}")
    return await _validate_and_respond(graph)


@router.post("/op/{op_id}/add-to-output", response_model=EditResponse)
async def add_to_output(op_id: str, request: AddToOutputRequest):
    """Add an op's result to the enclosing function's return."""
    try:
        graph = ir_manager.add_to_output(op_id, request.result_index)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Add to output error: {e}")
    return await _validate_and_respond(graph)


@router.delete("/op/{op_id}/operand/{index}", response_model=EditResponse)
async def remove_operand(op_id: str, index: int):
    """Remove an operand at the given index (changes op arity)."""
    try:
        graph = ir_manager.remove_operand(op_id, index)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Remove operand error: {e}")
    return await _validate_and_respond(graph)


@router.post("/op/{op_id}/operand", response_model=EditResponse)
async def add_operand(op_id: str, request: AddOperandRequest):
    """Add a new operand to an operation."""
    try:
        graph = ir_manager.add_operand(op_id, request.value_id, request.position)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (IndexError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Add operand error: {e}")
    return await _validate_and_respond(graph)


@router.get("/dialects", response_model=list[str])
async def get_dialects():
    """List available dialects that have Python bindings."""
    return list_dialects()


@router.get("/dialect/{name}/ops", response_model=list[OpDefinitionInfo])
async def get_dialect_ops(name: str):
    """List operations in a dialect."""
    ops = list_ops(name)
    return [
        OpDefinitionInfo(name=o.name, dialect=o.dialect, description=o.description)
        for o in ops
    ]


@router.get("/op/{op_name:path}/signature", response_model=OpSignatureResponse)
async def op_signature(op_name: str):
    """Return the signature (operands, attributes, results) of an op."""
    sig = get_op_signature(op_name)
    if sig is None:
        raise HTTPException(status_code=404, detail=f"No binding for op: {op_name}")
    return OpSignatureResponse(
        op_name=sig.op_name,
        params=[
            OpParamInfoResponse(name=p.name, kind=p.kind, required=p.required)
            for p in sig.params
        ],
        num_results=sig.num_results,
        num_regions=sig.num_regions,
    )


@router.get("/history", response_model=HistoryStatus)
async def history_status():
    """Return whether undo/redo are available."""
    return HistoryStatus(
        can_undo=ir_manager.history.can_undo,
        can_redo=ir_manager.history.can_redo,
    )
