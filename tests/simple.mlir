func.func @add_mul(%arg0: f32, %arg1: f32, %arg2: f32) -> f32 {
  %0 = arith.addf %arg0, %arg1 : f32
  %1 = arith.mulf %0, %arg2 : f32
  return %1 : f32
}
