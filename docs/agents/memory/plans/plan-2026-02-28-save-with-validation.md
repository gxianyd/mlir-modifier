# 计划：模型保存时进行验证

status: approved
date: 2026-02-28
priority: medium

## 需求描述

在用户保存模型（序列化为 MLIR 文本）时，同时进行验证并返回验证结果。前端可以选择性地阻止用户下载无效的模型。

### 用户故事
- 作为编辑器用户，我保存当前编辑的 MLIR 程序
- 系统返回 MLIR 文本和验证状态
- 如果模型不合法，前端显示警告并询问用户是否仍要继续下载

### 技术背景
- 项目已有 `IRManager.validate()` 方法，调用 `module.operation.verify()`
- 每次 mutation 后已自动验证并通过 WebSocket 推送（ValidationBanner）
- 当前 `GET /api/model/save` 只返回 MLIR 文本，没有验证信息

## 影响范围

### 后端
- 修改 `backend/app/routers/model.py` 的 `save_model` 端点
- 修改 `backend/app/models/ir_schema.py` 添加 `SaveResponse` 数据模型

### 前端
- 修改 `frontend/src/services/api.ts` 中的 `saveModel` API 函数
- 修改 `frontend/src/App.tsx` 中的 `handleSave` 函数，添加验证警告对话框

### 数据模型
- 后端：新增 `SaveResponse` 模型
- 前端：`frontend/src/types/ir.ts` 同步类型定义

## 后端任务

- [ ] 新增 `SaveResponse` 数据模型（`backend/app/models/ir_schema.py`）
  ```python
  class SaveResponse(BaseModel):
      mlir_text: str
      valid: bool
      diagnostics: list[str] = []
  ```

- [ ] 修改 `save_model` 端点（`backend/app/routers/model.py`）
  ```python
  @router.post("/model/save", response_model=SaveResponse)
  async def save_model():
      """Serialize the current module to MLIR text and validate it."""
      try:
          text = ir_manager.get_module_text()
          valid, diagnostics = ir_manager.validate()
      except ValueError as e:
          raise HTTPException(status_code=400, detail=str(e))
      return SaveResponse(mlir_text=text, valid=valid, diagnostics=diagnostics)
  ```

- [ ] 更新前端类型 `frontend/src/types/ir.ts`（同步后端）
  ```typescript
  export interface SaveResponse {
    mlir_text: string;
    valid: boolean;
    diagnostics: string[];
  }
  ```

## 前端任务

- [ ] 修改 `saveModel` API 函数（`frontend/src/services/api.ts`）
  ```typescript
  export async function saveModel(): Promise<SaveResponse> {
    const response = await api.post<SaveResponse>('/model/save', null, {
      responseType: 'text',  // Remove this, we'll use JSON response
    });
    return response.data;
  }
  ```

- [ ] 修改 `handleSave` 函数（`frontend/src/App.tsx`）
  - 调用 `saveModel()` 获取 MLIR 文本和验证结果
  - 如果 `!valid`，显示 Modal.confirm 询问是否继续
  - 用户确认后下载文件

  ```typescript
  const handleSave = useCallback(async () => {
    try {
      const result = await saveModel();

      if (!result.valid) {
        const confirmed = await Modal.confirm({
          title: '模型验证失败',
          content: `当前 MLIR 模型不合法，可能存在问题：\n${result.diagnostics.join('\n')}\n\n是否仍要保存文件？`,
          okText: '仍然保存',
          cancelText: '取消',
        });
        if (!confirmed) return;
      }

      // Download the file
      const blob = new Blob([result.mlir_text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.mlir';
      a.click();
      URL.revokeObjectURL(url);
      message.success('已保存 model.mlir');
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`保存失败: ${detail}`);
    }
  }, []);
  ```

## 接口约定

### 后端端点修改

**修改前：**
```
POST /api/model/save
Content-Type: text/plain

Response: <mlir_text>
```

**修改后：**
```
POST /api/model/save
Content-Type: application/json

Response (200 OK):
{
  "mlir_text": "<mlir_text>",
  "valid": true,
  "diagnostics": []
}

Response (200 OK) - 验证失败:
{
  "mlir_text": "<mlir_text>",
  "valid": false,
  "diagnostics": ["error: use of undeclared value '%0'"]
}
```

### 前端 API

```typescript
export interface SaveResponse {
  mlir_text: string;
  valid: boolean;
  diagnostics: string[];
}

export async function saveModel(): Promise<SaveResponse> {
  const response = await api.post<SaveResponse>('/model/save');
  return response.data;
}
```

## 验收标准

- [ ] 后端修改 `save_model` 端点返回 JSON 格式（包含 mlir_text、valid、diagnostics）
- [ ] 后端添加 `SaveResponse` 数据模型
- [ ] 前端更新 `saveModel` 函数返回 `SaveResponse` 类型
- [ ] 前端保存时显示验证警告对话框（如果模型不合法）
- [ ] 用户可以选择"仍然保存"或"取消"
- [ ] 后端测试通过
- [ ] 前端测试通过
- [ ] 手动测试：验证失败的模型仍可保存（选择"仍然保存"后）
