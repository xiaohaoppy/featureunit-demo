/**
 * ============================================================================
 * [角色] 适配器：FileUserStore —— 用户存储的 JSON 文件实现（演示"适配器可替换"）
 * ----------------------------------------------------------------------------
 * 一句话：把用户数据持久化到本地 JSON 文件。零依赖、真实可用，
 *         用来证明"换存储 = 只换适配器，单元与组合根零改动"。
 *
 * 生产环境请替换为 Postgres 适配器（README 有示例说明）：
 *   替换点只有 buildDeps() 里的一行，7 个功能单元完全无感。
 *
 * 实现说明：
 *   - 原子写：先写临时文件再 rename，避免进程中断写坏数据；
 *   - 每次操作全量读写（O(n)）——演示够用，生产要换数据库；
 *   - 数据目录自动创建。
 *
 * 本文件属于冻结区（适配器由人评审），AI 实现任务中可读，禁止修改。
 * ============================================================================
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { User, UserStore } from "../ports/user-store";

export class FileUserStore implements UserStore {
  constructor(private readonly filePath: string) {}

  /** 读取全部用户（文件不存在 = 空库）。 */
  private async load(): Promise<User[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as User[];
    } catch {
      return []; // 文件不存在或损坏 → 按空库处理（演示级别；生产应有损坏告警）
    }
  }

  /** 原子写入：临时文件 + rename，防写一半。 */
  private async save(users: User[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(users, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }

  async findByEmail(email: string): Promise<User | null> {
    return (await this.load()).find((u) => u.email === email) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return (await this.load()).find((u) => u.id === id) ?? null;
  }

  async create(user: User): Promise<void> {
    const users = await this.load();
    users.push(user);
    await this.save(users);
  }

  async updatePasswordHash(id: string, hash: string): Promise<void> {
    const users = await this.load();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return; // 幂等：不存在静默忽略
    users[idx] = { ...users[idx]!, passwordHash: hash };
    await this.save(users);
  }
}
