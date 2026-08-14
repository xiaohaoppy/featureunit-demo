/**
 * ai-contract-lib.mjs 的类型声明（供 TypeScript 侧 —— admin-server —— 使用）。
 * 纯 JS 库没有自带类型，这里手工声明其导出签名。
 * 注意：声明必须与 ai-contract-lib.mjs 的实际导出保持一致。
 */

export const ROOT: string;
export const GROUPS_DIR: string;
export const GROUP: string;
export const REVIEW_ITEMS: string[];
export const LOCAL_CONFIG_PATH: string;
export const CONFIG_KEYS: Array<{
  key: string;
  label: string;
  secret: boolean;
  fallback: string;
}>;

export function unitDir(name: string): string;
export function pascal(kebab: string): string;
export function camel(kebab: string): string;
export function listUnits(): string[];
export function readUnitFiles(name: string): {
  contract: string | null;
  spec: string | null;
  impl: string | null;
  test: string | null;
};
export function readLocalConfig(): Record<string, unknown>;
export function writeLocalConfig(values: Record<string, string>): Record<string, unknown>;
export function resolveConfigValue(key: string, fallback?: string): string;
export function createUnit(name: string): { name: string; dir: string };
export function saveUnitFile(
  name: string,
  file: "contract" | "spec" | "impl" | "test",
  content: string,
  note?: string,
): { saved: boolean; committed: boolean; message: string };
export function checkWiring(name: string): {
  name: string;
  checks: Array<{ label: string; ok: boolean }>;
  allOk: boolean;
};
export function generateWiring(name: string): {
  alreadyWired: boolean;
  files: Array<{ path: string; before: string; after: string; diffText: string }>;
};
export function applyWiring(
  name: string,
  note?: string,
): { ok: boolean; message: string; applied: number };
export function isJudgePlaceholder(test: string | null): boolean;
export function isImplStub(impl: string | null): boolean;
export function generateJudgeTest(
  name: string,
  mock?: boolean,
): Promise<{ name: string; test: string; invariants: string[] }>;
export function freezeJudge(
  name: string,
  reviewer?: string,
): { committed: boolean; message: string };
export function implementUnit(
  name: string,
  opts?: { mock?: boolean; maxRounds?: number },
): Promise<{
  ok: boolean;
  rounds: Array<{ round: number; ok: boolean; summary: string; tail: string }>;
  message: string;
}>;
export function unitStatus(name: string): {
  name: string;
  frozen: boolean;
  judgePlaceholder: boolean;
  judgeFrozen: boolean;
  implStub: boolean;
  wired: boolean;
  testsGreen: boolean;
  testSummary: string;
  steps: Array<{ id: string; label: string; done: boolean; hint: string }>;
  stepsDone: number;
  stepsTotal: number;
} | null;
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
