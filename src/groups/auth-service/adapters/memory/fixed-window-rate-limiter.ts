/**
 * ============================================================================
 * [角色] 适配器：FixedWindowRateLimiter —— 固定窗口限流的内存实现（测试/演示用）
 * ----------------------------------------------------------------------------
 * 一句话：每个 key 在一个时间窗口内最多放行 max 次，窗口过后重置计数。
 *
 * 限制（为什么它只是"测试/演示用"）：
 *   - 进程内 Map：多实例部署时各自计数，不共享——生产环境要换成
 *     Redis 分布式限流（README 有说明）；
 *   - 固定窗口有"窗口边界突刺"问题（窗口末尾和开头可各用满一次）。
 *     对本演示足够；生产可换滑动窗口/令牌桶适配器，单元零改动。
 *
 * 本文件可被 AI 复用（读），但属于冻结区，禁止修改。
 * ============================================================================
 */

import type { RateLimiter } from "../../ports/rate-limiter";

export class FixedWindowRateLimiter implements RateLimiter {
  /** key → { 当前窗口已用次数, 窗口重置时间点 } */
  private readonly counts = new Map<string, { count: number; resetAt: number }>();

  /**
   * @param max      每个窗口最多放行次数
   * @param windowMs 窗口长度（毫秒）
   * @param now      时钟注入（测试可固定时间；默认真实时钟）
   */
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(key: string): Promise<boolean> {
    const t = this.now().getTime();
    const entry = this.counts.get(key);

    // 第一次访问，或窗口已过期 → 开新窗口
    if (!entry || t >= entry.resetAt) {
      this.counts.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }

    // 窗口内还有配额 → 消耗一次
    if (entry.count < this.max) {
      entry.count += 1;
      return true;
    }

    return false; // 超限
  }
}
