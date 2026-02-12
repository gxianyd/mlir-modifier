import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.ir_manager import IRManager


SIMPLE_MLIR = """\
func.func @add_mul(%arg0: f32, %arg1: f32, %arg2: f32) -> f32 {
  %0 = arith.addf %arg0, %arg1 : f32
  %1 = arith.mulf %0, %arg2 : f32
  return %1 : f32
}
"""

NESTED_MLIR = """\
func.func @nested(%arg0: f32, %arg1: f32) -> f32 {
  %c0 = arith.constant 0.0 : f32
  %result = scf.if %arg0 : f32 -> f32 {
    %a = arith.addf %arg0, %arg1 : f32
    scf.yield %a : f32
  } else {
    scf.yield %c0 : f32
  }
  return %result : f32
}
"""

MULTI_FUNC_MLIR = """\
func.func @foo(%arg0: f32) -> f32 {
  %0 = arith.negf %arg0 : f32
  return %0 : f32
}

func.func @bar(%arg0: f32, %arg1: f32) -> f32 {
  %0 = arith.addf %arg0, %arg1 : f32
  return %0 : f32
}
"""

TENSOR_MLIR = """\
func.func @tensor_op(%arg0: tensor<2x3xf32>, %arg1: tensor<2x3xf32>) -> tensor<2x3xf32> {
  %0 = arith.addf %arg0, %arg1 : tensor<2x3xf32>
  return %0 : tensor<2x3xf32>
}
"""


@pytest.fixture
def ir_manager():
    return IRManager()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
