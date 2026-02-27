# MLIR Modifier

[English](README.md)

基于浏览器的 [MLIR](https://mlir.llvm.org/) 可视化编辑器。加载 `.mlir` 文件，以有向图的形式浏览数据流，交互式地编辑 op 和属性，并将结果保存回 MLIR 文本。

> **开发状态**：本项目仍在积极开发中，欢迎试用并通过 [Issues](../../issues) 反馈问题或建议。

## 功能

- **交互式图可视化** — op 为节点，SSA 值为有向边
- **嵌套区域导航** — 下钻进入函数、循环、控制流，面包屑导航回溯
- **多函数支持** — 在顶层 `func.func` 之间切换
- **实时编辑**
  - 创建 op（含方言感知的签名表单）
  - 删除 op（级联移除 use）
  - 修改 / 新增 / 删除属性
  - 重连操作数（operand）
  - 将 op 结果添加到函数返回值
- **撤销 / 重做** — 完整编辑历史（Ctrl+Z / Ctrl+Y）
- **实时 MLIR 验证** — 基于 WebSocket，内联显示诊断信息
- **自定义方言支持** — 开箱即用加载和编辑未注册方言的 op；通过 Python binding 导入脚本实现完整签名内省
- **离线 / HPC 支持** — 在有网络的机器上打包依赖，在断网集群上安装

## 系统要求

| 依赖 | 版本 |
|---|---|
| Python | ≥ 3.10 |
| Node.js | ≥ 14.18 |
| CMake | ≥ 3.20 |
| Ninja | 任意版本 |
| GCC 或 Clang | 支持 C++17 |
| 磁盘空间 | ~30 GB（LLVM 编译产物） |
| 内存 | 建议 ≥ 16 GB |

> 如果 LLVM/MLIR 已编译完成，只需 Python、Node.js 和常规构建工具。

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/<your-org>/mlir-modifier.git
cd mlir-modifier
```

### 2. 一键配置

```bash
# 完整配置——克隆 llvm-project 并编译 MLIR Python binding（约 30–60 分钟）
./setup.sh

# 如果 ../llvm-project 已编译好，跳过 LLVM 步骤：
./setup.sh --skip-llvm

# 指定 LLVM 路径：
./setup.sh --skip-llvm --llvm-dir /path/to/llvm-project
```

脚本会完成以下步骤：
- 创建 Python venv 并安装后端依赖
- 通过 npm 安装前端依赖
- 将 MLIR binding 路径写入 venv `activate`
- 生成 `start-backend.sh` 和 `start-frontend.sh`

### 3. 启动

```bash
./start-backend.sh    # FastAPI，监听 http://localhost:8000
./start-frontend.sh   # Vite 开发服务器，监听 http://localhost:5173
```

### 4. 使用

打开 **http://localhost:5173**，上传 `.mlir` 文件，开始编辑。

## 配置选项

| 参数 | 说明 |
|---|---|
| `--llvm-dir <path>` | LLVM 源码目录（默认：`../llvm-project`） |
| `--llvm-tag <tag>` | 克隆指定版本（默认：`llvmorg-19.1.7`） |
| `--jobs <N>` | 编译并行数（默认：`nproc`） |
| `--cc / --cxx <path>` | 自定义 C/C++ 编译器 |
| `--libstdcxx-dir <dir>` | 自定义 libstdc++ 路径（解决 HPC 上 `GLIBCXX not found`） |
| `--ninja <path>` | 自定义 ninja 路径 |
| `--node <path>` | 自定义 Node.js 路径 |
| `--npm-registry <url>` | npm 镜像源（如 `https://registry.npmmirror.com`） |
| `--skip-llvm` | 跳过 LLVM 克隆与编译 |
| `--skip-backend` | 跳过后端依赖安装 |
| `--skip-frontend` | 跳过前端依赖安装 |
| `--offline <bundle>` | 从离线包安装（见下节） |

详细说明参见 [docs/setup-guide.md](docs/setup-guide.md)。

## 离线 / HPC 部署

适用于无网络访问的集群环境：

> **预构建 bundle**：每个 [GitHub Release](https://github.com/gxianyd/mlir-modifier/releases)
> 附带 Linux x86_64 平台的 bundle 文件（Python 3.10 / 3.11 / 3.12），
> 下载与你的 Python 版本匹配的文件，可跳过 Step 1。

```bash
# Step 1：在有网络的机器上打包依赖
./scripts/bundle-offline.sh
# → 生成 offline-bundle.tar.gz

# Step 2：传输到集群节点
scp offline-bundle.tar.gz hpc-node:~/mlir-modifier/

# Step 3：在集群上安装（需提前单独编译 LLVM）
./setup.sh --skip-llvm --offline offline-bundle.tar.gz
```

bundle 包含预下载的 Python wheel 文件和压缩后的 `node_modules` 快照。

## 自定义方言

MLIR Modifier 开箱即用支持未注册方言（`allow_unregistered_dialects = True`），无需任何配置即可加载、查看、编辑自定义方言的 op，包括修改属性、重连操作数、删除 op。

如需**完整支持**（通过 Op Creator 面板创建自定义 op，含签名自动补全），导入方言的 Python binding：

```bash
./scripts/import-dialect.sh mydia ./build/_mydia_ops_gen.py
```

详细的 CMakeLists 配置和集成步骤参见 [docs/custom-dialect-guide.md](docs/custom-dialect-guide.md)。

## 开发

### 运行测试

```bash
make test            # 后端 + 前端
make test-backend    # pytest（132 个测试）
make test-frontend   # vitest（16 个测试）
```

### 查看所有 make 目标

```bash
make help
```

### 项目结构

```
backend/
├── app/
│   ├── main.py              # FastAPI 应用、CORS、路由注册
│   ├── routers/             # model.py · edit.py · ws.py
│   └── services/
│       ├── ir_manager.py    # 核心：解析 MLIR、构建图、执行编辑
│       ├── dialect_registry.py  # 方言/op 内省
│       ├── history.py       # 撤销/重做栈
│       └── notifier.py      # WebSocket 广播
└── tests/                   # 12 个测试文件，132 个测试

frontend/src/
├── App.tsx                  # 根组件：状态管理、视图切换
├── components/
│   ├── Graph/               # XYFlow 图 + Dagre 布局
│   ├── Toolbar/             # 文件加载、函数选择、工具栏
│   ├── PropertyPanel/       # Op 详情 / 属性编辑器
│   └── OpCreator/           # 创建新 op 的弹窗
├── services/api.ts          # Axios API 客户端
└── hooks/                   # 验证（WebSocket）、键盘快捷键
```

## 技术栈

| 层次 | 技术 |
|---|---|
| 后端 | Python · FastAPI · uvicorn · MLIR Python bindings |
| 前端 | React 19 · TypeScript · Vite 4 · Ant Design 6 |
| 图可视化 | XYFlow (React Flow) · Dagre |
| 测试 | pytest · vitest |
| 构建 | CMake · Ninja · LLVM 19.1.7 |

## License

[Apache 2.0](LICENSE)
