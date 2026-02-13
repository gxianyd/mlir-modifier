// 嵌套测试文件：func.func > scf.for > arith ops
// 用于测试 Phase 2 的 Group Node 展开、折叠、钻入功能
func.func @nested_example(%arg0: f32, %arg1: f32, %lb: index, %ub: index, %step: index) -> f32 {
  %init = arith.addf %arg0, %arg1 : f32
  %result = scf.for %iv = %lb to %ub step %step iter_args(%acc = %init) -> f32 {
    %prod = arith.mulf %acc, %arg1 : f32
    %sum = arith.addf %prod, %arg0 : f32
    scf.yield %sum : f32
  }
  return %result : f32
}
