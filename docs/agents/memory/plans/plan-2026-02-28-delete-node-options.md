# 计划：删除节点两种模式
status: done
date: 2026-02-28
priority: medium

## 需求描述
右键上下文菜单的"Delete"按钮改为两个选项：
- **Delete Node**：只删除当前节点，将其所有 result 从依赖 op 的 operand 列表中移除（断开连线），但保留依赖节点本身
- **Delete Nodes From Here**：删除当前节点及所有传递性依赖节点（现有行为）

键盘 Delete/Backspace 改用更安全的"Delete Node"（单节点删除）。

## 影响范围
- **后端**：`ir_manager.py`（新增方法）、`edit.py`（新增端点或查询参数）
- **前端**：`api.ts`（新增 API 函数）、`App.tsx`（新增回调）、`GraphView.tsx`（上下文菜单 + 键盘）
- **数据模型**：无
- **API**：新增 `DELETE /api/op/{op_id}?cascade=false`

---

## 后端任务

### 任务 1：`backend/app/services/ir_manager.py`

新增方法 `delete_op_single(op_id)`：

```python
def delete_op_single(self, op_id: str) -> IRGraph:
    """Delete only this op; remove its results from user ops' operand lists."""
    if self.module is None:
        raise ValueError("No module loaded")
    if op_id not in self._op_map:
        raise KeyError(f"Unknown op_id: {op_id}")

    self._snapshot()
    op = self._op_map[op_id]

    try:
        # For each result, collect (user_op, operand_indices) — may have multiple
        from collections import defaultdict
        # Map: id(user_op) -> (user_op, sorted list of operand indices in this op's results)
        users: dict[int, tuple[ir.Operation, list[int]]] = defaultdict(
            lambda: (None, [])
        )
        for res in op.results:
            for use in list(res.uses):
                user_op = use.owner
                key = id(user_op)
                if key not in users:
                    users[key] = (user_op, [])
                # Find operand index in user_op that equals this result
                for i, operand in enumerate(user_op.operands):
                    if operand == res:
                        users[key][1].append(i)

        # Recreate each user op without the operands that reference this op's results
        # Process indices in descending order to preserve index validity
        for key, (user_op, indices) in users.items():
            indices_desc = sorted(set(indices), reverse=True)
            new_operands = list(user_op.operands)
            for i in indices_desc:
                new_operands.pop(i)
            self._recreate_op_with_operands(user_op, new_operands)

        # Now safe to erase (no uses remain)
        op.erase()
    except Exception:
        rollback_text = self.history.undo(str(self.module))
        self._reparse(rollback_text)
        self.rebuild_graph()
        raise

    return self.rebuild_graph()
```

### 任务 2：`backend/app/routers/edit.py`

修改 `delete_op` 端点，新增 `cascade` 查询参数（默认 `True` 保持向后兼容）：

```python
from typing import Annotated
from fastapi import Query

@router.delete("/op/{op_id}", response_model=EditResponse)
async def delete_op(op_id: str, cascade: Annotated[bool, Query()] = True):
    """Delete an operation. cascade=True also deletes dependents."""
    try:
        if cascade:
            graph = ir_manager.delete_op(op_id)
        else:
            graph = ir_manager.delete_op_single(op_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await _validate_and_respond(graph)
```

---

## 前端任务

### 任务 3：`frontend/src/services/api.ts`

新增 `deleteOpSingle(opId)` 函数（`cascade=false`）：

```typescript
export async function deleteOpSingle(opId: string): Promise<EditResponse> {
  const res = await axios.delete<EditResponse>(`/api/op/${encodeURIComponent(opId)}`, {
    params: { cascade: false },
  });
  return res.data;
}
```

注意：现有 `deleteOp(opId)` 不需要改（默认 cascade=true）。

### 任务 4：`frontend/src/App.tsx`

新增 `handleDeleteOpSingle` 回调（参考 `handleDeleteOp` 实现，调用 `deleteOpSingle`），
传给 `<GraphView onDeleteOpSingle={handleDeleteOpSingle} />`。

### 任务 5：`frontend/src/components/Graph/GraphView.tsx`

**A. Props 新增：**
```typescript
onDeleteOpSingle?: (opId: string) => void;
```

**B. 上下文菜单（节点）— 将单个"Delete Node"改为两项：**
```tsx
{/* Delete Node（只删自身，断线） */}
{onDeleteOpSingle && (
  <div style={...} onClick={() => { onDeleteOpSingle(contextMenu.opId!); setContextMenu(null); }}>
    Delete Node
  </div>
)}
{/* Delete Nodes From Here（原有级联删除） */}
{onDeleteOp && (
  <div style={{ ...redStyle }} onClick={handleContextDeleteNode}>
    Delete Nodes From Here
  </div>
)}
```

**C. 键盘 Delete/Backspace：**
将 `onDeleteOp` 改为 `onDeleteOpSingle`（更安全的默认行为）：
```typescript
if (selectedNodeIdRef.current && onDeleteOpSingle) {
  e.preventDefault();
  onDeleteOpSingle(selectedNodeIdRef.current);
}
```

---

## 接口约定

```
DELETE /api/op/{op_id}?cascade=true   → 级联删除（原行为）
DELETE /api/op/{op_id}?cascade=false  → 单节点删除（新行为）
```

两者响应格式相同：`EditResponse`（含更新后的 `graph`）。

---

---

## 测试要求

### 后端测试（新增到 `backend/tests/test_edit_delete.py`）

在 `TestDeleteOp` 类中新增（使用 `SIMPLE_MLIR`：addf → mulf → return）：

```python
def test_delete_single_only_removes_target(self, ir_manager):
    """delete_op_single removes the op itself but leaves users intact."""
    graph = ir_manager.load(SIMPLE_MLIR)
    mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
    new_graph = ir_manager.delete_op_single(mulf_op.op_id)
    op_names = [op.name for op in new_graph.operations]
    assert "arith.mulf" not in op_names
    assert "func.return" in op_names   # user not cascade-deleted
    assert "arith.addf" in op_names    # upstream not affected

def test_delete_single_users_lose_operand(self, ir_manager):
    """After delete_op_single, user op has one fewer operand."""
    graph = ir_manager.load(SIMPLE_MLIR)
    mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
    ret_op = next(op for op in graph.operations if op.name == "func.return")
    original_count = len(ret_op.operands)
    new_graph = ir_manager.delete_op_single(mulf_op.op_id)
    new_ret = next(op for op in new_graph.operations if op.name == "func.return")
    assert len(new_ret.operands) == original_count - 1

def test_delete_single_undo_restores(self, ir_manager):
    """Undo after delete_op_single restores the op and its connections."""
    graph = ir_manager.load(SIMPLE_MLIR)
    original_count = len(graph.operations)
    mulf_op = next(op for op in graph.operations if op.name == "arith.mulf")
    ir_manager.delete_op_single(mulf_op.op_id)
    restored = ir_manager.undo()
    assert len(restored.operations) == original_count
    assert any(op.name == "arith.mulf" for op in restored.operations)

def test_delete_single_nonexistent_raises(self, ir_manager):
    ir_manager.load(SIMPLE_MLIR)
    with pytest.raises(KeyError):
        ir_manager.delete_op_single("nonexistent_id")

def test_delete_single_without_module_raises(self, ir_manager):
    with pytest.raises(ValueError):
        ir_manager.delete_op_single("some_id")
```

在 `TestDeleteOpAPI` 类中新增：

```python
async def test_delete_single_endpoint(self, client):
    """?cascade=false deletes only the target op, leaving users intact."""
    content = SIMPLE_MLIR.encode()
    files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
    load_resp = await client.post("/api/model/load", files=files)
    graph = load_resp.json()
    mulf_op = next(op for op in graph["operations"] if op["name"] == "arith.mulf")
    resp = await client.delete(f"/api/op/{mulf_op['op_id']}?cascade=false")
    assert resp.status_code == 200
    op_names = [op["name"] for op in resp.json()["graph"]["operations"]]
    assert "arith.mulf" not in op_names
    assert "func.return" in op_names  # user survived

async def test_delete_cascade_default_preserved(self, client):
    """Without ?cascade param, cascade=true is the default."""
    content = SIMPLE_MLIR.encode()
    files = {"file": ("test.mlir", io.BytesIO(content), "text/plain")}
    load_resp = await client.post("/api/model/load", files=files)
    graph = load_resp.json()
    mulf_op = next(op for op in graph["operations"] if op["name"] == "arith.mulf")
    resp = await client.delete(f"/api/op/{mulf_op['op_id']}")
    assert resp.status_code == 200
    op_names = [op["name"] for op in resp.json()["graph"]["operations"]]
    assert "arith.mulf" not in op_names
    assert "func.return" not in op_names  # cascade-deleted
```

---

## 验收标准
- [ ] 右键菜单出现"Delete Node"和"Delete Nodes From Here"两个选项
- [ ] "Delete Node"只删除自身，依赖节点仍然存在但断开连线
- [ ] "Delete Nodes From Here"行为与当前一致（级联删除）
- [ ] 键盘 Delete/Backspace 执行"Delete Node"（单节点删除）
- [ ] 两种删除均支持 Undo
- [ ] `make test-frontend` 全绿
- [ ] `make test-backend` 全绿（新增 7 个测试）
