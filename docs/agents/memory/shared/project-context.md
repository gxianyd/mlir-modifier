# MLIR Modifier — 项目共享上下文

## 项目定位
Web 端 MLIR IR 可视化编辑器，供编译器工程师交互式查看和编辑 MLIR 程序。

## 技术栈

### 后端
| 组件 | 技术 | 版本 |
|------|------|------|
| Web 框架 | FastAPI | 0.115.0 |
| ASGI 服务 | Uvicorn | 0.34.0 |
| MLIR 绑定 | mlir-python-bindings | LLVM 19.1.7 |
| 数据验证 | Pydantic | (via FastAPI) |

### 前端
| 组件 | 技术 | 版本 |
|------|------|------|
| 框架 | React | 19.2.0 |
| 语言 | TypeScript | 5.4.0 |
| 构建 | Vite | 4.5.0 |
| UI 库 | Ant Design | 6.3.0 |
| 图形引擎 | XYFlow (React Flow) | 12.10.0 |
| 布局算法 | Dagre | 0.8.5 |
| HTTP 客户端 | Axios | 1.13.5 |

## 关键文件路径

### 后端
- `backend/app/main.py` — FastAPI 应用入口，CORS，路由注册
- `backend/app/services/ir_manager.py` — 核心引擎：解析 MLIR、构建图、执行 mutation
- `backend/app/models/ir_schema.py` — Pydantic 数据模型（IRGraph、OperationInfo 等）
- `backend/app/services/dialect_registry.py` — 方言自省（14 个内置方言）
- `backend/app/services/history.py` — 撤销/重做（zlib 压缩快照）
- `backend/app/services/notifier.py` — WebSocket 广播管理
- `backend/app/routers/edit.py` — 编辑 CRUD 端点
- `backend/app/routers/model.py` — 文件加载/保存端点
- `backend/app/routers/ws.py` — WebSocket 验证端点

### 前端
- `frontend/src/App.tsx` — 主容器（viewPath、函数选择器、全局状态）
- `frontend/src/components/Graph/GraphView.tsx` — 画布（节点选择、下钻、边）
- `frontend/src/components/Graph/irToFlow.ts` — IR 图 → Flow 节点/边转换
- `frontend/src/components/Graph/layoutGraph.ts` — Dagre 层次化布局
- `frontend/src/components/Graph/OpNode.tsx` — 操作节点卡片
- `frontend/src/components/Graph/InputNode.tsx` — Block 参数节点
- `frontend/src/components/Toolbar/Toolbar.tsx` — 顶部工具栏（上传/保存/撤销重做）
- `frontend/src/components/Toolbar/Breadcrumb.tsx` — 嵌套区域导航面包屑
- `frontend/src/components/PropertyPanel/PropertyPanel.tsx` — 右侧属性面板
- `frontend/src/components/OpCreator/OpCreator.tsx` — 创建操作弹窗
- `frontend/src/components/ValidationBanner.tsx` — 诊断信息展示
- `frontend/src/hooks/useValidation.ts` — WebSocket 验证监听
- `frontend/src/hooks/useKeyboardShortcuts.ts` — Ctrl+Z/Y、Delete 快捷键
- `frontend/src/services/api.ts` — Axios API 客户端
- `frontend/src/types/ir.ts` — TypeScript 类型定义（镜像后端 ir_schema.py）

## 架构要点
- REST API + WebSocket 双通道：操作通过 REST，验证结果通过 WebSocket 推送
- IRManager 是单例，管理当前加载的 MLIR module
- 每次 mutation 后重建图（rebuild_graph），并触发验证广播
- viewPath 记录当前嵌套区域位置（用于下钻导航）
- 支持未注册方言（`allow_unregistered_dialects = True`）
- 撤销/重做：最多 50 个快照，zlib 压缩（约 10:1 压缩比）

## 开发原则
- **测试覆盖**: 添加新功能后必须添加对应的测试用例
  - 后端操作：需要添加 pytest 测试，覆盖正常场景、异常场景和边界情况
  - 前端功能：需要添加 vitest 测试，覆盖组件交互逻辑和 API 调用
- **禁止修改已有测试**: 严禁修改之前的测试用例。如果某些测试由于功能变更而失效，必须：
  1. 先与用户确认是否需要更新测试
  2. 获得确认后才能修改
  3. 修改时必须确保测试逻辑与新的功能需求完全一致

## MLIR Python Bindings 注意事项
- 用 `.operation.name` 获取 op 类型名，不用 `.name`（OpView vs Operation 区别）
- 不能用 `id()` 比较 wrapper 同一性，用 `==`
- `op.attributes` 类似 dict，通过 `NamedAttribute` 对象（`.name` / `.attr`）迭代
- 区分 `OpResult` 和 `BlockArgument` 需用 `isinstance`

## 开发命令
```bash
# 启动
./start-backend.sh    # FastAPI on :8000
./start-frontend.sh   # Vite on :5173

# 测试
make test             # 全部（后端 132 个 + 前端 16 个）
make test-backend     # pytest
make test-frontend    # vitest

# 其他
make lint
make build
make clean
```

## API 端点概览
| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/model/load` | 上传并解析 MLIR 文件 |
| GET | `/api/model/save` | 序列化为 MLIR 文本 |
| POST | `/api/op/create` | 创建新操作 |
| DELETE | `/api/op/{op_id}` | 删除操作（级联删除依赖） |
| PATCH | `/api/op/{op_id}/attributes` | 修改属性 |
| PATCH | `/api/op/{op_id}/operand/{index}` | 重接 SSA 连线 |
| POST | `/api/op/{op_id}/add-to-output` | 添加结果到函数返回 |
| POST | `/api/undo` | 撤销 |
| POST | `/api/redo` | 重做 |
| WS | `/ws/validation` | 实时验证推送 |
