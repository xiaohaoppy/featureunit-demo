/**
 * ============================================================================
 * [角色] 适配器：ScryptPasswordHasher —— 真实密码哈希（scrypt，零依赖）
 * ----------------------------------------------------------------------------
 * 一句话：用 Node 内置 crypto 的 scrypt 做慢哈希 + 随机盐 + 常数时间比较。
 *         这是【真实可用】的实现，不是玩具——生产环境可直接用它，
 *         或换成 argon2/bcrypt 适配器（单元代码零改动）。
 *
 * 为什么自己写而不是引库：
 *   - Node 内置 scrypt 就是业界标准（RFC 7914），不需要 argon2 的原生依赖；
 *   - 本演示要保持依赖最小；换库时只需改这个文件。
 *
 * 存储格式（自描述，未来可平滑升级参数）：
 *   v1$scrypt$N$r$p$盐(base64)$哈希(base64)
 *
 * 安全要点（每一条都值得写进评审清单）：
 *   1. 随机盐（16 字节）——相同密码产生不同哈希，防彩虹表；
 *   2. 慢参数 N=2^14 ——单次哈希约几十毫秒，暴力破解成本陡增；
 *   3. timingSafeEqual ——常数时间比较，防时序侧信道；
 *   4. 格式不认识的哈希一律返回 false（verify 绝不抛错）。
 *
 * 本文件属于冻结区（适配器由人评审），AI 实现任务中可读，禁止修改。
 * ============================================================================
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "../ports/password-hasher";

/** scrypt 参数：N=16384(2^14), r=8, p=1 是 OWASP 推荐级别（内存约 16MB）。 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64; // 派生密钥长度 64 字节（512 位）

/** 把 scrypt 的回调 API 包成 Promise（避免 promisify 的类型体操）。 */
function scryptAsync(password: string, salt: Buffer, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N, r: R, p: P }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, KEY_LEN);
    return `v1$scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [version, algo, ns, rs, ps, saltB64, hashB64] = stored.split("$");

    // 格式校验：任何不认识的格式一律拒绝（而不是抛错——verify 语义是"是否匹配"）
    if (version !== "v1" || algo !== "scrypt" || !saltB64 || !hashB64) return false;

    try {
      const salt = Buffer.from(saltB64, "base64");
      const expected = Buffer.from(hashB64, "base64");
      const actual = await scryptAsync(password, salt, expected.length);
      // timingSafeEqual 要求两个 Buffer 等长——长度不同说明存储损坏，返回 false
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false; // 盐/哈希损坏、参数非法等任何异常 → 视为不匹配
    }
  }
}
