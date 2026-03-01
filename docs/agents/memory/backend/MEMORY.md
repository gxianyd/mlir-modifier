# 后端 Agent 记忆

## 技术要点
- Python ≥ 3.10，FastAPI + Uvicorn
- 数据模型用 Pydantic（通过 FastAPI 自动校验）
- IRManager 是核心单例：解析/构建图/执行 mutation
- 所有 mutation 后必须调用 `rebuild_graph()` 重建图
- 验证通过 `notifier.py` 广播到 WebSocket 客户端

## MLIR Python Bindings 关键注意事项
- OpView vs Operation：获取 op 类型名用 `.operation.name`，不是 `.name`
- Wrapper 同一性：不能用 `id()` 比较，用 `==`
- 属性迭代：`op.attributes` 迭代时返回 `NamedAttribute`，用 `na.name` / `na.attr` 获取键值（**不能用 `op.attributes[na]` 索引**）
- 值类型区分：`isinstance(value, ir.OpResult)` **不可靠**，必须用 `ir.OpResult.isinstance(value)` + `ir.OpResult(value)` 显式转型
- `ir.Operation` 无 `.block` 属性，用 `ir.InsertionPoint(op).block` 获取父 Block
- `ir.Operation.create()` 对于有注册 Python 类的方言（如 `math.powf` → `PowOp`）会返回 `ir.OpView`，需检查并 unwrap：`if not isinstance(new_op, ir.Operation): new_op = new_op.operation`
- 嵌套 Region：含 region 的 op（func.func、scf.if 等）需递归处理

## 已知模式
- 路由器在 `backend/app/routers/`，服务在 `backend/app/services/`
- 每个编辑操作先快照（history.py），再 mutation，再重建图，再验证
- 方言自省通过 Python `inspect` 模块获取 op 构造函数签名
- 支持未注册方言：`allow_unregistered_dialects = True`

## 开发原则
- **测试覆盖**: 添加新功能后必须添加对应的测试用例
  - 后端操作：需要添加 pytest 测试，覆盖正常场景、异常场景和边界情况
  - 前端功能：需要添加 vitest 测试，覆盖组件交互逻辑和 API 调用
- **禁止修改已有测试**: 严禁修改之前的测试用例。如果某些测试由于功能变更而失效，必须：
  1. 先与用户确认是否需要更新测试
  2. 获得确认后才能修改
  3. 修改时必须确保测试逻辑与新的功能需求完全一致

## 测试规范
- 测试文件在 `backend/tests/`，使用 pytest
- Fixtures 在 `conftest.py`：`SIMPLE_MLIR`、`NESTED_MLIR`、`MULTI_FUNC_MLIR`
- 运行：`make test-backend`
- **新建测试**: 添加新功能时，在对应的测试文件中新增测试用例，不要修改现有测试
- **测试隔离**: 新测试应该独立运行，不依赖于其他测试的执行顺序或状态

## 历史经验

### 验证逻辑改进 (2026-02-28)
- **问题**：原 `validate()` 方法只返回布尔值，不捕获详细诊断信息
- **修复**：
  - 使用 `context.attach_diagnostic_handler(handler)` 捕获 MLIR 验证诊断
  - handler 返回 `True` 表示已处理诊断
  - 捕获 `MLIRError` 异常（验证失败时抛出）
  - Dialect 注册：在 `dialect_registry.py` 中添加 `_load_builtin_dialects()` 函数，在 `main.py` 启动时导入
- **关键代码**：
  ```python
  def validate(self) -> tuple[bool, list[str]]:
      diagnostics: list[str] = []
      def handler(diag) -> bool:
          diagnostics.append(f"{diag.severity.upper()}: {diag.message}")
          return True
      try:
          with self.context.attach_diagnostic_handler(handler):
              valid = self.module.operation.verify()
          return (valid, diagnostics)
      except ir.MLIRError:
          return (False, diagnostics)
  ```
- **注意**：必须在创建 Context 之前导入 dialect 模块（通过 `dialect_registry._load_builtin_dialects()`），否则 dialect 不会被注册到 Context 中
