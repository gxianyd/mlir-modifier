from __future__ import annotations

import importlib
import inspect
from dataclasses import dataclass, field

import mlir.ir as ir


@dataclass
class OpDefinition:
    """Minimal metadata about a registered MLIR operation."""

    name: str       # e.g. "arith.addf"
    dialect: str    # e.g. "arith"
    description: str  # summary or empty


@dataclass
class OpParamInfo:
    """Describes a single parameter of an op's __init__ signature."""

    name: str
    kind: str       # "operand" | "attribute"
    required: bool  # positional → required, keyword → optional


@dataclass
class OpSignature:
    """Structured description of an op extracted from its OpView subclass."""

    op_name: str
    params: list[OpParamInfo] = field(default_factory=list)
    num_results: int = 0   # -1 means variadic
    num_regions: int = 0


# Properties inherited from OpView / _OperationBase — not op-specific
_BASE_PROPERTIES: set[str] = {
    "attached", "attributes", "context", "location", "name",
    "operands", "operation", "opview", "parent", "regions",
    "result", "results", "successors",
}

# Parameters to skip in __init__ signature
_SKIP_PARAMS: set[str] = {"self", "loc", "ip"}


# Well-known built-in dialects that have Python bindings under mlir.dialects.*
_BUILTIN_DIALECT_MODULES: list[str] = [
    "arith",
    "func",
    "scf",
    "memref",
    "tensor",
    "linalg",
    "math",
    "cf",
    "affine",
    "vector",
    "gpu",
    "index",
    "bufferization",
    "tosa",
]


def _get_all_dialect_modules() -> list[str]:
    """Return built-in dialects plus any local additions."""
    try:
        from app.services.local_dialects import LOCAL_DIALECT_MODULES
    except ImportError:
        LOCAL_DIALECT_MODULES = []
    seen = set(_BUILTIN_DIALECT_MODULES)
    extra = [d for d in LOCAL_DIALECT_MODULES if d not in seen]
    return _BUILTIN_DIALECT_MODULES + extra


def _load_builtin_dialects() -> None:
    """Import all dialect modules to ensure they are registered.

    This function should be called at application startup, before any
    MLIR Context is created, so that the dialects are available for
    parsing and validation.
    """
    for dialect_name in _get_all_dialect_modules():
        try:
            importlib.import_module(f"mlir.dialects.{dialect_name}")
        except ImportError:
            pass  # Some dialects may use different naming conventions


# Load all builtin dialects at module import time
_load_builtin_dialects()


def list_dialects() -> list[str]:
    """Return the list of known dialect names (those with Python bindings)."""
    available: list[str] = []
    for name in _get_all_dialect_modules():
        try:
            importlib.import_module(f"mlir.dialects.{name}")
            available.append(name)
        except ImportError:
            pass
    return available


def list_ops(dialect_name: str) -> list[OpDefinition]:
    """List all operations in *dialect_name* by introspecting its Python module."""
    try:
        mod = importlib.import_module(f"mlir.dialects.{dialect_name}")
    except ImportError:
        return []

    ops: list[OpDefinition] = []
    seen: set[str] = set()

    for _attr_name, obj in inspect.getmembers(mod, inspect.isclass):
        op_name = getattr(obj, "OPERATION_NAME", None)
        if op_name and isinstance(op_name, str) and op_name not in seen:
            seen.add(op_name)
            doc = (obj.__doc__ or "").strip().split("\n")[0]
            ops.append(OpDefinition(
                name=op_name,
                dialect=dialect_name,
                description=doc,
            ))

    ops.sort(key=lambda o: o.name)
    return ops


def _find_opview_class(op_name: str) -> type | None:
    """Find the OpView subclass for the given fully qualified op name."""
    dialect = op_name.split(".")[0] if "." in op_name else ""
    if not dialect:
        return None
    try:
        mod = importlib.import_module(f"mlir.dialects.{dialect}")
    except ImportError:
        return None

    for _attr_name, obj in inspect.getmembers(mod, inspect.isclass):
        if getattr(obj, "OPERATION_NAME", None) == op_name:
            return obj
    return None


def _classify_param(cls: type, param_name: str) -> str:
    """Classify a parameter as 'operand' or 'attribute' by inspecting its property source."""
    prop = getattr(cls, param_name, None)
    if prop is None or not isinstance(prop, property) or prop.fget is None:
        return "operand"  # default assumption for unknown params
    try:
        src = inspect.getsource(prop.fget)
        if "operand" in src or "Operand" in src:
            return "operand"
        if "attributes" in src or "Attribute" in src:
            return "attribute"
    except (OSError, TypeError):
        pass
    return "operand"  # default


def get_op_signature(op_name: str) -> OpSignature | None:
    """Extract the signature of an op from its OpView __init__.

    Returns None if the op has no Python binding.
    """
    cls = _find_opview_class(op_name)
    if cls is None:
        return None

    try:
        sig = inspect.signature(cls.__init__)
    except (ValueError, TypeError):
        return OpSignature(op_name=op_name)

    # Step 1: Identify class-level property names whose getter accesses
    # operation.results.  These are result descriptors (may have non-standard
    # names like 'output' instead of 'result').  We scan cls.__dict__ directly
    # to include overrides of base-class names (e.g. 'result').
    result_prop_names: set[str] = set()
    for key, desc in cls.__dict__.items():
        if key.startswith("_"):
            continue
        if isinstance(desc, property):
            try:
                src = inspect.getsource(desc.fget)
                if "operation.results" in src:
                    result_prop_names.add(key)
            except (OSError, TypeError):
                pass

    params: list[OpParamInfo] = []
    num_results = 0
    has_result_keyword = False

    for pname, param in sig.parameters.items():
        if pname in _SKIP_PARAMS:
            continue

        is_positional = param.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
        is_keyword = param.kind == inspect.Parameter.KEYWORD_ONLY

        # 'result' as positional → means 1 result type needed (standard ODS naming)
        if pname == "result" and is_positional:
            num_results = 1
            continue

        # 'results' or 'results_' as keyword → variadic results
        if pname in ("results", "results_"):
            has_result_keyword = True
            continue

        # Positional param whose name matches a class property accessing
        # operation.results → it is a result TYPE parameter (e.g. 'output' in
        # hbir ops).  Count it as a result and skip adding to params.
        if is_positional and pname in result_prop_names:
            num_results += 1
            continue

        # Classify the parameter
        if is_positional:
            kind = _classify_param(cls, pname)
            params.append(OpParamInfo(name=pname, kind=kind, required=True))
        elif is_keyword:
            # Keyword-only params (except loc/ip/results) are optional attributes
            params.append(OpParamInfo(name=pname, kind="attribute", required=False))

    # Determine result count
    if num_results == 0 and has_result_keyword:
        num_results = -1  # variadic

    # Fallback: if no result was found via __init__ inspection (type-inferred ops
    # like arith.addf where result type equals operand type and is not a param),
    # use the count of result-accessing class properties collected in Step 1.
    if num_results == 0 and not has_result_keyword and result_prop_names:
        num_results = len(result_prop_names)

    # Extract region count from _ODS_REGIONS
    ods_regions = getattr(cls, "_ODS_REGIONS", (0, True))
    num_regions = ods_regions[0] if isinstance(ods_regions, tuple) else 0

    return OpSignature(
        op_name=op_name,
        params=params,
        num_results=num_results,
        num_regions=num_regions,
    )
