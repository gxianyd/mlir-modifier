# MLIR Modifier

[中文版](README_zh.md)

A web-based visual editor for [MLIR](https://mlir.llvm.org/) programs. Load a `.mlir` file,
explore the dataflow graph interactively, edit operations and attributes, and save the result
back to MLIR text — all in the browser.

> **Work in progress**: This project is under active development. Feedback and bug reports are welcome via [Issues](../../issues).

## Features

- **Interactive graph visualization** — operations as nodes, SSA values as edges
- **Nested region navigation** — drill into functions, loops, and control flow with breadcrumb navigation
- **Multi-function support** — switch between top-level `func.func` definitions
- **Live editing**
  - Create operations (with dialect-aware signature forms)
  - Delete operations (with cascade use removal)
  - Modify / add / delete attributes
  - Rewire operands
  - Add results to function return values
- **Undo / redo** — full edit history (Ctrl+Z / Ctrl+Y)
- **Real-time MLIR validation** — WebSocket-based; shows diagnostics inline
- **Custom dialect support** — load and edit IR with unregistered ops out of the box;
  full signature introspection via Python binding import script
- **HPC / offline support** — bundle dependencies on a connected machine, install
  without network access on an air-gapped cluster

## Requirements

| Requirement | Version |
|---|---|
| Python | ≥ 3.10 |
| Node.js | ≥ 14.18 |
| CMake | ≥ 3.20 |
| Ninja | any |
| GCC or Clang | C++17 |
| Disk space | ~30 GB (LLVM build) |
| RAM | ≥ 16 GB recommended |

> If LLVM/MLIR is already built, you only need Python, Node.js, and standard build tools.

## Quick Start

### 1. Clone

```bash
git clone https://github.com/<your-org>/mlir-modifier.git
cd mlir-modifier
```

### 2. Set up

```bash
# Full setup — clones llvm-project and builds MLIR Python bindings (~30–60 min)
./setup.sh

# If LLVM/MLIR is already built at ../llvm-project:
./setup.sh --skip-llvm

# Custom LLVM path:
./setup.sh --skip-llvm --llvm-dir /path/to/llvm-project
```

The script:
- Creates a Python venv with all backend dependencies
- Installs frontend packages via npm
- Bakes the MLIR binding path into the venv `activate` script
- Generates `start-backend.sh` and `start-frontend.sh`

### 3. Start

```bash
./start-backend.sh    # FastAPI on http://localhost:8000
./start-frontend.sh   # Vite dev server on http://localhost:5173
```

### 4. Open

Navigate to **http://localhost:5173**, upload a `.mlir` file, and start editing.

## Setup Options

| Flag | Description |
|---|---|
| `--llvm-dir <path>` | LLVM source directory (default: `../llvm-project`) |
| `--llvm-tag <tag>` | Checkout specific LLVM version (default: `llvmorg-19.1.7`) |
| `--jobs <N>` | Parallel build jobs (default: `nproc`) |
| `--cc / --cxx <path>` | Custom C/C++ compilers |
| `--libstdcxx-dir <dir>` | Custom libstdc++ path (fixes `GLIBCXX not found` on HPC) |
| `--ninja <path>` | Custom ninja binary |
| `--node <path>` | Custom Node.js binary |
| `--npm-registry <url>` | npm mirror (e.g., `https://registry.npmmirror.com`) |
| `--skip-llvm` | Skip LLVM clone and build |
| `--skip-backend` | Skip Python/backend setup |
| `--skip-frontend` | Skip npm/frontend setup |
| `--offline <bundle>` | Install from offline bundle (see below) |

For detailed instructions see [docs/setup-guide.md](docs/setup-guide.md).

## Offline / HPC Setup

For air-gapped clusters:

> **Pre-built bundles** for Linux x86_64 (Python 3.10 / 3.11 / 3.12) are attached to each
> [GitHub Release](https://github.com/gxianyd/mlir-modifier/releases).
> Download the one matching your Python version and skip Step 1.

```bash
# Step 1: On a machine with internet access — build the dependency bundle
./scripts/bundle-offline.sh
# → produces offline-bundle.tar.gz

# Step 2: Transfer to the cluster
scp offline-bundle.tar.gz hpc-node:~/mlir-modifier/

# Step 3: On the cluster (LLVM must already be built separately)
./setup.sh --skip-llvm --offline offline-bundle.tar.gz
```

The bundle contains pre-downloaded Python wheels and a compressed `node_modules` snapshot.

## Custom Dialects

MLIR Modifier loads and displays IR with unregistered/custom dialect ops out of the box
(`allow_unregistered_dialects = True`). You can view, edit attributes, rewire operands, and
delete custom ops without any configuration.

For **full support** — creating new custom ops via the Op Creator UI with signature
auto-completion — import the dialect's Python binding:

```bash
./scripts/import-dialect.sh mydia ./build/_mydia_ops_gen.py
```

See [docs/custom-dialect-guide.md](docs/custom-dialect-guide.md) for CMakeLists setup and
detailed integration steps.

## Development

### Tests

```bash
make test            # backend + frontend
make test-backend    # pytest  (132 tests)
make test-frontend   # vitest  (16 tests)
```

### All make targets

```bash
make help
```

### Project layout

```
backend/
├── app/
│   ├── main.py              # FastAPI app, CORS, router registration
│   ├── routers/             # model.py · edit.py · ws.py
│   └── services/
│       ├── ir_manager.py    # Core: parse MLIR, build graph, mutations
│       ├── dialect_registry.py
│       ├── history.py       # Undo/redo stack
│       └── notifier.py      # WebSocket broadcaster
└── tests/                   # 12 test files · 132 tests

frontend/src/
├── App.tsx
├── components/
│   ├── Graph/               # XYFlow graph + Dagre layout
│   ├── Toolbar/
│   ├── PropertyPanel/       # Op detail / attribute editor
│   └── OpCreator/           # Modal: create new operations
├── services/api.ts
└── hooks/                   # Validation (WebSocket), keyboard shortcuts
```

## Tech Stack

| Layer | Libraries |
|---|---|
| Backend | Python · FastAPI · uvicorn · MLIR Python bindings |
| Frontend | React 19 · TypeScript · Vite 4 · Ant Design 6 |
| Graph | XYFlow (React Flow) · Dagre |
| Testing | pytest · vitest |
| Build | CMake · Ninja · LLVM 19.1.7 |

## License

[Apache 2.0](LICENSE)
