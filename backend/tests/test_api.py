"""Tests for FastAPI routes."""

import pytest
from httpx import AsyncClient

from app.routers.model import ir_manager
from tests.conftest import SIMPLE_MLIR


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health(self, client: AsyncClient):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestModelLoad:
    @pytest.mark.asyncio
    async def test_load_valid_mlir(self, client: AsyncClient):
        resp = await client.post(
            "/api/model/load",
            files={"file": ("test.mlir", SIMPLE_MLIR.encode(), "text/plain")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "module_id" in data
        assert "operations" in data
        assert "edges" in data
        assert len(data["operations"]) > 0

    @pytest.mark.asyncio
    async def test_load_returns_correct_ops(self, client: AsyncClient):
        resp = await client.post(
            "/api/model/load",
            files={"file": ("test.mlir", SIMPLE_MLIR.encode(), "text/plain")},
        )
        data = resp.json()
        op_names = {op["name"] for op in data["operations"]}
        assert "arith.addf" in op_names
        assert "arith.mulf" in op_names

    @pytest.mark.asyncio
    async def test_load_invalid_mlir_returns_400(self, client: AsyncClient):
        resp = await client.post(
            "/api/model/load",
            files={"file": ("bad.mlir", b"not valid mlir", "text/plain")},
        )
        assert resp.status_code == 400
        assert "Failed to parse" in resp.json()["detail"]


class TestModelSave:
    @pytest.mark.asyncio
    async def test_save_without_load_returns_400(self, client: AsyncClient):
        # Reset global state from previous tests
        ir_manager.module = None
        resp = await client.post("/api/model/save")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_save_after_load(self, client: AsyncClient):
        # Load first
        await client.post(
            "/api/model/load",
            files={"file": ("test.mlir", SIMPLE_MLIR.encode(), "text/plain")},
        )
        # Save
        resp = await client.post("/api/model/save")
        assert resp.status_code == 200
        text = resp.text
        assert "arith.addf" in text
        assert "arith.mulf" in text
