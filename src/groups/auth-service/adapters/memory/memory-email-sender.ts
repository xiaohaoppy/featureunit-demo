/**
 * ============================================================================
 * [角色] 适配器：MemoryEmailSender —— 邮件发送的内存实现（测试用）
 * ----------------------------------------------------------------------------
 * 一句话：不真发邮件，把发出的邮件记到 sent 数组里，供测试断言。
 *
 * 典型用法（找回密码端到端测试）：
 *   const mail = new MemoryEmailSender();
 *   ... 触发 request-password-reset ...
 *   const text = mail.sent.at(-1)!.text;   // 从邮件正文里提取重置链接/token
 *
 * 注意：本文件属于【测试基础设施】（冻结区），AI 实现任务中可读可复用，
 *       禁止修改。
 * ============================================================================
 */

import type { EmailMessage, EmailSender } from "../../ports/email-sender";

/** 已发送邮件的记录（追加时间戳，方便断言发送顺序）。 */
export interface SentEmail extends EmailMessage {
  sentAt: Date;
}

export class MemoryEmailSender implements EmailSender {
  /** 所有已发送的邮件，按发送顺序排列。测试从这里取邮件做断言。 */
  readonly sent: SentEmail[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message, sentAt: new Date() });
  }
}
