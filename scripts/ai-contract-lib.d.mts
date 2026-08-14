/**
 * ai-contract-lib.mjs 的类型声明（供 TypeScript 侧 —— admin-server —— 使用）。
 * 纯 JS 库没有自带类型，这里手工声明其导出签名。
 * 注意：声明必须与 ai-contract-lib.mjs 的实际导出保持一致。
 */

export const ROOT: string;
export const GROUPS_DIR: string;
export const GROUP: string;
export const REVIEW_ITEMS: string[];

export function unitDir(name: string): string;
export function pascal(kebab: string): string;
export function listUnits(): string[];
export function readUnitFiles(name: string): {
  contract: string | null;
  spec: string | null;
  impl: string | null;
  test: string | null;
};
export function mockDraft(
  name: string,
  requirement: string,
): { ts: string; md: string };
export function generateDraft(
  name: string,
  requirement: string,
  mock?: boolean,
): Promise<{ ts: string; md: string; source: "mock" | "live" }>;
export function machineCheck(
  name: string,
  ts: string,
  md: string,
): {
  checks: Array<{ label: string; ok: boolean }>;
  tsc: { ok: boolean; unitErrors: string[] };
};
export function freeze(
  name: string,
  meta?: {
    generation?: string;
    reviewer?: string;
    approved?: string;
  },
): { committed: boolean; message: string };
export function runUnitTest(name: string): {
  ok: boolean;
  summary: string;
  output: string;
};
export function runAllTests(): { ok: boolean; summary: string; output: string };
export function buildTicketText(name: string): string;
export function readSourceFile(relPath: string): string | null;
export function listSourceFiles(): string[];
