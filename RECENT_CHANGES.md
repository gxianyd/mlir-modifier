# 最近修改文件清单

## 修改的文件

### 1. 核心脚本
- ✅ `.github/workflows/build-offline-bundle.yml` - 更新为不含 MLIR 的 bundle 构建流程
- ✅ `scripts/bundle-offline.sh` - 修改为只打包前后端依赖
- ✅ `setup.sh` - 添加 macOS realpath 兼容性和改进错误信息
- ✅ `README_zh.md` - 更新离线部署说明，添加 MLIR 安装指南

### 2. 新增文件
- ✅ `scripts/diagnose-bundle.sh` - Bundle 诊断工具
- ✅ `scripts/bundle-simple.sh` - 精简版打包脚本（已废弃，功能已合并到 bundle-offline.sh）
- ✅ `docs/bundle-troubleshooting.md` - Bundle 故障排除指南
- ✅ `CHANGES.md` - 修改总结文档
- ✅ `RECENT_CHANGES.md` - 本文件

### 3. 测试文件（可删除）
- ⚠️ `offline-bundle-simple.tar.gz` - 测试生成的 bundle
- ⚠️ `offline-bundle-simple.tar.gz.checksums` - 测试 bundle 的校验和
- ⚠️ `offline-bundle-simple.tar.gz.USAGE.md` - 测试 bundle 的使用说明

## 关键修改说明

### Bundle 策略变更

**修改前**:
- Bundle 包含 MLIR Python bindings
- 文件大小约 200 MB
- 打包时间 30-60 分钟

**修改后**:
- Bundle 只包含前后端环境依赖
- 文件大小约 40-50 MB
- 打包时间 2-5 分钟
- MLIR 需要用户单独安装

### 安装流程变更

**修改前**:
```bash
./setup.sh                    # 自动包含 MLIR 编译
```

**修改后**:
```bash
# 1. 安装 MLIR（新增步骤）
conda install -c conda-forge mlir

# 2. 使用 bundle
./setup.sh --skip-llvm --offline offline-bundle.tar.gz
```

## 兼容性

✅ 完全向后兼容
- 现有安装方式继续可用
- 用户可选择完整构建或使用 bundle
- `setup.sh` 保持原有功能

## 使用建议

### 新用户
1. 直接 Conda 安装 MLIR（推荐）
2. 下载对应平台的 package bundle
3. 使用 `--skip-llvm --offline` 安装

### HPC 用户
1. 在有网络的环境 conda 安装 MLIR
2. 打包 bundle 传输到集群
3. 在集群上安装使用

### 开发者
1. 继续使用完整构建 `./setup.sh`
2. 或使用预安装的 MLIR + bundle

---

**修改日期**: 2026-02-28
**修改者**: Claude
**状态**: 已完成
