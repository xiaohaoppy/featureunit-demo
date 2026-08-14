import { defineConfig } from "vitest/config";

/**
 * vitest 配置。
 * 为什么只 include src 下的 .test.ts：
 * 判据 = 单元测试（各 features 目录下的 impl.test.ts）+ 组测试（group.test.ts），
 * 不允许出现"游离的测试文件"——测试必须贴着它验证的对象存在。
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
