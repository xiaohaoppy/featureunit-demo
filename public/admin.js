/**
 * ============================================================================
 * FeatureUnit 管理台前端（原生 JS，无框架、无构建链）
 * ----------------------------------------------------------------------------
 * 五个面板：概览 / 单元详情 / AI 契约生成 / Ticket / 源码浏览。
 * 所有数据来自 admin-server 的 /admin/api/* 接口。
 * ============================================================================
 */

"use strict";

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

const state = {
  units: [],               // 单元列表（含冻结状态）
  selectedUnit: null,      // 左侧选中的单元名
  unitFiles: null,         // 选中单元的 4 文件内容
  unitFileTab: "contract", // 单元详情当前文件 tab
  aiDraft: null,           // AI 生成的草稿 {ts, md, checks, tsc}
  aiTab: "ts",             // 草稿预览 tab
  aiReviews: [],           // 10 项评审结果（true=通过 / false=打回 / null=未答）
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 通用：请求与消息
// ---------------------------------------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `请求失败 (${res.status})`);
  return data;
}

function msg(el, text, kind = "ok") {
  el.innerHTML = `<div class="msg ${kind}">${escapeHtml(text)}</div>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

// ---------------------------------------------------------------------------
// Tab 切换
// ---------------------------------------------------------------------------

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// 单元列表加载与渲染（左侧栏 + 概览卡片）
// ---------------------------------------------------------------------------

async function loadUnits() {
  try {
    const data = await api("/admin/api/units");
    state.units = data.units;
    $("group-label").textContent = `${data.group} · ${data.units.length} 个功能单元`;

    // 左侧列表
    const ul = $("unit-list");
    ul.innerHTML = "";
    for (const u of data.units) {
      const li = document.createElement("li");
      li.dataset.name = u.name;
      li.innerHTML = `
        <span class="dot ${u.frozen ? "frozen" : u.hasContract ? "draft" : ""}"></span>
        <span class="name">${u.name}</span>`;
      li.addEventListener("click", () => selectUnit(u.name, li));
      ul.appendChild(li);
    }

    // 概览卡片
    const grid = $("overview-grid");
    grid.innerHTML = "";
    for (const u of data.units) {
      const cards = [
        u.frozen ? `<span class="badge ok">已冻结</span>` : u.hasContract ? `<span class="badge warn">契约草稿</span>` : `<span class="badge mute">无契约</span>`,
        u.hasImpl ? `<span class="badge ok">实现</span>` : `<span class="badge err">无实现</span>`,
        u.hasTest ? `<span class="badge ok">判据</span>` : `<span class="badge warn">无判据</span>`,
        u.hasSpec ? `<span class="badge mute">spec</span>` : ``,
      ].join("");
      grid.insertAdjacentHTML("beforeend", `
        <div class="unit-card" data-name="${u.name}">
          <h4>${u.name}</h4>
          <div class="badges">${cards}</div>
          <div class="meta">点击左侧列表查看详情</div>
        </div>`);
    }
  } catch (err) {
    $("group-label").textContent = `加载失败：${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// 单元详情
// ---------------------------------------------------------------------------

const FILE_LABELS = { contract: "contract.ts", spec: "spec.md", impl: "impl.ts", test: "impl.test.ts" };

async function selectUnit(name, li) {
  state.selectedUnit = name;
  document.querySelectorAll("#unit-list li").forEach((x) => x.classList.remove("active"));
  if (li) li.classList.add("active");

  try {
    const data = await api(`/admin/api/units/${name}`);
    state.unitFiles = data.files;
    state.unitFileTab = "contract";
    renderUnitDetail();
    // 同步刷新 ticket 下拉
    fillTicketSelect();
  } catch (err) {
    $("unit-title").textContent = `加载失败：${err.message}`;
  }
}

function renderUnitDetail() {
  const u = state.units.find((x) => x.name === state.selectedUnit);
  $("unit-title").textContent = `单元详情：${state.selectedUnit}${u?.frozen ? "（已冻结）" : ""}`;

  // 文件 tab
  const tabs = $("file-tabs");
  tabs.innerHTML = "";
  for (const [key, label] of Object.entries(FILE_LABELS)) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = key === state.unitFileTab ? "active" : "";
    btn.addEventListener("click", () => {
      state.unitFileTab = key;
      renderUnitDetail();
    });
    tabs.appendChild(btn);
  }

  const content = state.unitFiles[state.unitFileTab];
  $("file-content").textContent = content ?? `（文件缺失：${FILE_LABELS[state.unitFileTab]}）`;
  $("unit-test-summary").textContent = "";
  $("unit-test-output").style.display = "none";
}

// 运行单单元判据
$("btn-run-unit").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  const btn = $("btn-run-unit");
  btn.disabled = true;
  btn.textContent = "运行中…";
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/test`, { method: "POST" });
    $("unit-test-summary").textContent = r.summary;
    const out = $("unit-test-output");
    out.style.display = "block";
    out.textContent = r.output;
  } catch (err) {
    $("unit-test-summary").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "运行本单元判据";
  }
});

// 运行全部判据（总闸）
$("btn-run-all").addEventListener("click", async () => {
  const btn = $("btn-run-all");
  btn.disabled = true;
  btn.textContent = "运行中…";
  try {
    const r = await api("/admin/api/tests/all", { method: "POST" });
    $("overview-output").textContent = `[${r.ok ? "✅ 全部通过" : "❌ 有失败"}] ${r.summary}\n\n${r.output}`;
  } catch (err) {
    $("overview-output").textContent = `运行失败：${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "运行全部判据";
  }
});

// ---------------------------------------------------------------------------
// AI 契约生成
// ---------------------------------------------------------------------------

// ① 生成草稿
$("btn-ai-generate").addEventListener("click", async () => {
  const name = $("ai-name").value.trim();
  const requirement = $("ai-req").value.trim();
  const mock = $("ai-mode").value === "mock";
  $("ai-msg").innerHTML = "";
  if (!name || !requirement) {
    msg($("ai-msg"), "请填写功能单元名和一句话需求", "err");
    return;
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    msg($("ai-msg"), "功能单元名只允许小写字母/数字/连字符（kebab-case）", "err");
    return;
  }

  const btn = $("btn-ai-generate");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    const draft = await api("/admin/api/ai/generate", {
      method: "POST",
      body: JSON.stringify({ name, requirement, mock }),
    });
    state.aiDraft = { name, ...draft };
    state.aiTab = "ts";
    state.aiReviews = Array(10).fill(null); // 10 项评审全部未答

    // 机器初审清单
    const checks = $("ai-checks");
    checks.innerHTML = draft.checks
      .map((c) => `<div class="check-row"><span class="mark">${c.ok ? "✅" : "⚠️"}</span><span>${escapeHtml(c.label)}</span></div>`)
      .join("");

    // 草稿预览（ts / md 两个 tab）
    const ftabs = $("ai-file-tabs");
    ftabs.innerHTML = "";
    for (const [key, label] of [["ts", "contract.ts（草稿）"], ["md", "spec.md（草稿）"]]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = key === state.aiTab ? "active" : "";
      b.addEventListener("click", () => { state.aiTab = key; renderAiDraft(); });
      ftabs.appendChild(b);
    }
    renderAiDraft();

    // 评审清单（10 项 y/n）
    const list = $("ai-review-list");
    list.innerHTML = "";
    state.aiReviews.forEach((_, i) => {
      const row = document.createElement("div");
      row.className = "review-item";
      row.innerHTML = `
        <span class="idx">${String(i + 1).padStart(2)}/10</span>
        <span class="text">${escapeHtml(draft.reviewItems?.[i] ?? "")}</span>
        <span class="choice">
          <button data-y="1">通过</button>
          <button data-y="0">打回</button>
        </span>`;
      row.querySelector('[data-y="1"]').addEventListener("click", () => setReview(i, true));
      row.querySelector('[data-y="0"]').addEventListener("click", () => setReview(i, false));
      list.appendChild(row);
    });

    $("ai-draft-card").style.display = "block";
    $("ai-review-card").style.display = "block";
    $("ai-freeze-msg").innerHTML = "";
    msg($("ai-msg"), `草稿已生成（${draft.source === "mock" ? "演示模式" : "真实 AI"}）。请逐条评审，全部"通过"才可冻结。`, "warn");
  } catch (err) {
    msg($("ai-msg"), err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "① 生成草稿";
  }
});

function renderAiDraft() {
  const content = state.aiTab === "ts" ? state.aiDraft.ts : state.aiDraft.md;
  $("ai-draft-content").textContent = content;
  $("ai-file-tabs").querySelectorAll("button").forEach((b, i) => {
    b.className = (i === 0 && state.aiTab === "ts") || (i === 1 && state.aiTab === "md") ? "active" : "";
  });
}

function setReview(i, ok) {
  state.aiReviews[i] = ok;
  const rows = $("ai-review-list").children;
  const row = rows[i];
  row.querySelector('[data-y="1"]').className = ok ? "on-y" : "";
  row.querySelector('[data-y="0"]').className = ok === false ? "on-n" : "";
}

// ④ 冻结
$("btn-ai-freeze").addEventListener("click", async () => {
  if (!state.aiDraft) return;
  const unanswered = state.aiReviews.filter((x) => x === null).length;
  if (unanswered > 0) {
    msg($("ai-freeze-msg"), `还有 ${unanswered} 项未评审（必须逐条给出"通过/打回"）`, "err");
    return;
  }
  const hasNo = state.aiReviews.includes(false);
  if (hasNo) {
    msg($("ai-freeze-msg"), "存在「打回」项——不能冻结。可先修改草稿（人工编辑文件）再重新生成评审。", "err");
    return;
  }
  try {
    const r = await api("/admin/api/ai/freeze", {
      method: "POST",
      body: JSON.stringify({ name: state.aiDraft.name, reviews: state.aiReviews }),
    });
    msg($("ai-freeze-msg"), r.frozen ? `✅ ${r.message}` : "未冻结", r.frozen ? "ok" : "err");
    loadUnits(); // 刷新冻结状态
  } catch (err) {
    msg($("ai-freeze-msg"), err.message, "err");
  }
});

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

function fillTicketSelect() {
  const sel = $("ticket-unit");
  const prev = sel.value;
  sel.innerHTML = state.units.map((u) => `<option>${u.name}</option>`).join("");
  if (prev && state.units.some((u) => u.name === prev)) sel.value = prev;
}

$("btn-ticket-load").addEventListener("click", async () => {
  const name = $("ticket-unit").value;
  if (!name) return;
  try {
    const r = await api(`/admin/api/ticket/${name}`);
    $("ticket-content").textContent = r.ticket;
  } catch (err) {
    $("ticket-content").textContent = `加载失败：${err.message}`;
  }
});

$("btn-ticket-copy").addEventListener("click", async () => {
  const text = $("ticket-content").textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板不可用时回退：选中文本
    const range = document.createRange();
    range.selectNodeContents($("ticket-content"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

// ---------------------------------------------------------------------------
// 源码浏览
// ---------------------------------------------------------------------------

$("btn-source-load").addEventListener("click", async () => {
  const file = $("source-file").value;
  if (!file) return;
  try {
    const r = await api(`/admin/api/source?file=${encodeURIComponent(file)}`);
    $("source-content").textContent = r.content;
  } catch (err) {
    $("source-content").textContent = `加载失败：${err.message}`;
  }
});

async function loadSourceList() {
  try {
    const r = await api("/admin/api/source/list");
    $("source-file").innerHTML = r.files.map((f) => `<option>${f}</option>`).join("");
  } catch { /* 忽略：面板内会提示 */ }
}

// ---------------------------------------------------------------------------
// 新功能单元
// ---------------------------------------------------------------------------

$("btn-new-unit").addEventListener("click", () => {
  const name = prompt("新功能单元名（kebab-case，如 verify-2fa）：", "verify-2fa");
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  // 通过管理 API 调用脚手架（先检查单元是否存在——生成操作由 CLI 完成更安全，
  // 这里引导用户在终端执行；保持界面与 CLI 同一事实来源）
  alert(`请在终端执行：\n\n  npm run feat -- new ${name}\n\n生成后点击"刷新"。`);
});

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

$("btn-refresh").addEventListener("click", loadUnits);

loadUnits();
loadSourceList();
