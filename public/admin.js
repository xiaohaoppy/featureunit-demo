/**
 * ============================================================================
 * FeatureUnit 管理台前端（原生 JS，无框架、无构建链）
 * ----------------------------------------------------------------------------
 * 结构（本次重构合并要点）：
 *   工具层   → withBusy（按钮忙碌包装）/ renderChecks（检查清单）/ editor（共享编辑器）
 *   数据层   → 各 loadXxx()（统一 api + 渲染模式）
 *   面板层   → 9 个 tab 的交互逻辑
 * 合并前 1221 行 → 重构后约 800 行；行为不变。
 * ============================================================================
 */

"use strict";

// ---------------------------------------------------------------------------
// 状态与工具层
// ---------------------------------------------------------------------------

const state = {
  group: "auth-service",
  units: [],
  selectedUnit: null,
  unitFiles: null,
  unitFileTab: "contract",
  aiDraft: null,
  aiTab: "ts",
  aiReviews: [],
  portDetail: null,
};

const $ = (id) => document.getElementById(id);

/** 请求（自动附带当前业务系统）。 */
async function api(path, opts = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}group=${encodeURIComponent(state.group)}`, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `请求失败 (${res.status})`);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

/** 面板容器写入（显示 + 内容）。 */
function panel(el, html) {
  el.style.display = "block";
  el.innerHTML = html;
}

/** 消息写入。 */
function msg(el, text, kind = "ok") {
  el.innerHTML = `<div class="msg ${kind}">${escapeHtml(text)}</div>`;
}

/** 按钮忙碌包装：禁用 + 加载文案 + try/finally 恢复。 */
async function withBusy(btn, busyText, fn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

/** 检查清单渲染（✅/⚠️ 列表，自动检查/接入/错误编号等共用）。 */
function renderChecks(checks) {
  return `<div class="check-list">${checks
    .map((c) => `<div class="check-row"><span class="mark">${c.ok ? "✅" : "⚠️"}</span><span>${escapeHtml(c.label)}</span></div>`)
    .join("")}</div>`;
}

/**
 * 共享文件编辑器（功能/数据接口详情共用）。
 * 用法：editor.open({ title, content, warning, save: async (content, note) => result })
 * save 返回 { message }；保存成功自动关闭并调用 onSaved()。
 */
const editor = {
  saveFn: null,
  onSaved: null,
  open({ title, content, warning, save, onSaved }) {
    $("editor-title").textContent = title;
    $("editor-content").value = content;
    $("editor-warning").textContent = warning ?? "";
    $("editor-warning").style.display = warning ? "block" : "none";
    $("editor-note").value = "";
    this.saveFn = save;
    this.onSaved = onSaved ?? null;
    $("editor-overlay").style.display = "flex";
    $("editor-content").focus();
  },
  close() {
    $("editor-overlay").style.display = "none";
  },
};

$("btn-editor-save").addEventListener("click", async () => {
  const note = $("editor-note").value.trim();
  if (!note) {
    alert("请填写修改说明（会写进 git 提交信息）");
    return;
  }
  await withBusy($("btn-editor-save"), "保存中…", async () => {
    const r = await editor.saveFn($("editor-content").value, note);
    editor.close();
    alert(r.message);
    if (editor.onSaved) await editor.onSaved();
  });
});

$("btn-editor-cancel").addEventListener("click", () => editor.close());

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
// 业务系统：切换 / 新建
// ---------------------------------------------------------------------------

async function loadGroups() {
  try {
    const r = await fetch("/admin/api/groups").then((x) => x.json());
    const sel = $("group-select");
    sel.innerHTML = r.groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    sel.value = r.groups.includes(state.group) ? state.group : r.groups[0];
    sel.addEventListener("change", () => {
      state.group = sel.value;
      state.selectedUnit = null;
      loadUnits();
      loadSourceList();
      loadPortMatrix();
      loadPorts();
      $("group-label").textContent = `${state.group} · 切换中…`;
    });
  } catch { /* 忽略 */ }
}

$("btn-new-group").addEventListener("click", async () => {
  const name = prompt("新业务系统名（kebab-case，如 order-service）：", "order-service");
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  try {
    await api("/admin/api/groups", { method: "POST", body: JSON.stringify({ name }) });
    alert(`✓ 已创建业务系统 ${name}（组骨架：ports/组合根/config/manifest/组验收测试）`);
    await loadGroups();
  } catch (err) {
    alert(`创建失败：${err.message}`);
  }
});

$("btn-new-unit").addEventListener("click", async () => {
  const name = prompt("新功能名（kebab-case，如 verify-2fa）：", "verify-2fa");
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  try {
    await api("/admin/api/units", { method: "POST", body: JSON.stringify({ name }) });
    alert(`✓ 已生成功能 ${name}\n下一步：在「AI 功能规格生成」面板生成功能规格，或人工填写。`);
    await loadUnits();
  } catch (err) {
    alert(`创建失败：${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// 功能：列表 / 详情 / 编辑 / 验收测试 / 实现 / 接入 / 接入 / 历史 / 错误编号
// ---------------------------------------------------------------------------

const FILE_LABELS = { contract: "contract.ts", spec: "spec.md", impl: "impl.ts", test: "impl.test.ts" };
const FROZEN_WARN = { contract: "功能规格（定稿区）", spec: "规格（定稿区）", test: "验收测试（定稿区）", impl: "实现（AI 写入区）" };

async function loadUnits() {
  try {
    const data = await api("/admin/api/units");
    state.units = data.units;
    $("group-label").textContent = `${data.group} · ${data.units.length} 个功能`;
    renderQuickGrid();

    const ul = $("unit-list");
    ul.innerHTML = "";
    for (const u of data.units) {
      const li = document.createElement("li");
      li.dataset.name = u.name;
      li.innerHTML = `<span class="dot ${u.frozen ? "frozen" : u.hasContract ? "draft" : ""}"></span><span class="name">${u.name}</span>`;
      li.addEventListener("click", () => selectUnit(u.name, li));
      ul.appendChild(li);
    }

    $("overview-grid").innerHTML = data.units.map((u) => `
      <div class="unit-card">
        <h4>${u.name}</h4>
        <div class="badges">
          ${u.frozen ? `<span class="badge ok">已定稿</span>` : u.hasContract ? `<span class="badge warn">功能规格草稿</span>` : `<span class="badge mute">无功能规格</span>`}
          ${u.hasImpl ? `<span class="badge ok">实现</span>` : `<span class="badge err">无实现</span>`}
          ${u.hasTest ? `<span class="badge ok">验收测试</span>` : `<span class="badge warn">无验收测试</span>`}
        </div>
        <div class="meta">点击左侧列表查看详情</div>
      </div>`).join("");
  } catch (err) {
    $("group-label").textContent = `加载失败：${err.message}`;
  }
}

async function selectUnit(name, li) {
  state.selectedUnit = name;
  document.querySelectorAll("#unit-list li").forEach((x) => x.classList.remove("active"));
  if (li) li.classList.add("active");
  try {
    const data = await api(`/admin/api/units/${name}`);
    state.unitFiles = data.files;
    state.unitFileTab = "contract";
    renderUnitDetail();
    $("ai-name").value = name; // 功能规格生成自动带功能名
    loadUnitWizard();
  } catch (err) {
    $("unit-title").textContent = `加载失败：${err.message}`;
  }
}

/** 功能工作台：5 步进度条 + 各阶段状态（复用向导 status API）。 */
async function loadUnitWizard() {
  if (!state.selectedUnit) return;
  $("unit-wizard-card").style.display = "block";
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/status`);
    $("unit-wizard").innerHTML = r.steps.map((s, i) => {
      const isNow = !s.done && (i === 0 || r.steps[i - 1].done);
      return `<div class="w-step ${s.done ? "done" : isNow ? "now" : ""}">${s.done ? "✅" : isNow ? "▶️" : "⬜"} ${escapeHtml(s.label)}</div>`;
    }).join("");
    $("unit-wizard-hint").textContent = r.steps.map((s) => (s.done ? "" : `▶ ${s.hint}`)).filter(Boolean).join(" ｜ ") || "✅ 全部完成";
    // 各阶段状态徽标
    $("state-contract").textContent = r.steps[0]?.done ? "✅ 已定稿" : "待生成";
    $("state-judge").textContent = r.steps[1]?.done ? "✅ 就绪" : "待生成";
    $("state-impl").textContent = r.steps[2]?.done ? "✅ 完成" : "待实现";
    $("state-wiring").textContent = r.steps[3]?.done ? "✅ 已接入" : "待接入";
  } catch { /* 忽略 */ }
}

function renderUnitDetail() {
  const u = state.units.find((x) => x.name === state.selectedUnit);
  $("unit-title").textContent = `功能详情：${state.selectedUnit}${u?.frozen ? "（已定稿）" : ""}`;
  $("file-tabs").innerHTML = Object.entries(FILE_LABELS)
    .map(([key, label]) => `<button class="${key === state.unitFileTab ? "active" : ""}" data-file="${key}">${label}</button>`)
    .join("");
  $("file-tabs").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => { state.unitFileTab = b.dataset.file; renderUnitDetail(); });
  });
  $("file-content").textContent = state.unitFiles[state.unitFileTab] ?? `（文件缺失：${FILE_LABELS[state.unitFileTab]}）`;
  $("unit-test-summary").textContent = "";
  $("unit-test-output").style.display = "none";
}

// —— 编辑当前文件（共享编辑器）——
$("btn-edit-toggle").addEventListener("click", () => {
  if (!state.selectedUnit || !state.unitFiles) return;
  const file = state.unitFileTab;
  editor.open({
    title: `编辑 ${state.selectedUnit}/${FILE_LABELS[file]}（${FROZEN_WARN[file] ?? ""}）`,
    content: state.unitFiles[file] ?? "",
    warning: "定稿区文件（功能规格/验收测试/规格）由人编辑是允许的，但每次保存都会留下 git 记录——请填写修改说明。",
    save: async (content, note) =>
      api(`/admin/api/units/${state.selectedUnit}/files`, { method: "PUT", body: JSON.stringify({ file, content, note }) }),
    onSaved: async () => {
      state.unitFiles[file] = $("editor-content").value;
      renderUnitDetail();
      await loadUnits();
    },
  });
});

// —— 运行本功能验收测试 ——
$("btn-run-unit").addEventListener("click", () =>
  withBusy($("btn-run-unit"), "运行中…", async () => {
    const r = await api(`/admin/api/units/${state.selectedUnit}/test`, { method: "POST" });
    $("unit-test-summary").textContent = r.summary;
    const out = $("unit-test-output");
    out.style.display = "block";
    out.textContent = r.output;
  }));

// —— 运行全部验收测试 ——
$("btn-run-all").addEventListener("click", () =>
  withBusy($("btn-run-all"), "运行中…", async () => {
    const r = await api("/admin/api/tests/all", { method: "POST" });
    panel($("overview-output"), `[${r.ok ? "✅ 全部通过" : "❌ 有失败"}] ${r.summary}\n\n${r.output}`);
  }));

// —— 接入检查 + 一键接入（含 AI 接入按钮复用同一输出区）——
async function loadWiringAndPack(kind) {
  const box = kind === "wiring" ? $("wiring-result") : $("pack-result");
  panel(box, "加载中…");
  const r = await api(`/admin/api/units/${state.selectedUnit}/wiring`);
  let html = `<div class="msg ${r.allOk ? "ok" : "warn"}">${r.allOk ? "✅ 已完整接入" : "⚠️ 尚未完全接入"}</div>`;
  html += renderChecks(r.checks);

  if (!r.allOk) {
    try {
      const p = await api(`/admin/api/units/${state.selectedUnit}/wiring/preview`);
      if (p.alreadyWired) {
        html += `<div class="msg ok">已接入，无需改动。</div>`;
      } else if (p.files.length) {
        html += `<div class="msg warn">机器生成的接入改动（<b>人审阅后确认才落盘</b>）：</div>`;
        html += p.files.map((f) => `<div style="font-weight:600;margin:8px 0 4px">${escapeHtml(f.path)}</div><pre class="code" style="max-height:260px">${escapeHtml(f.diffText)}</pre>`).join("");
        html += `<div class="row" style="margin-top:10px"><button class="btn" id="btn-wire-apply">确认接入（落盘 + git 提交）</button></div>`;
      } else {
        html += `<div class="msg err">无法生成接入改动（锚点缺失），请人工编辑组合根。</div>`;
      }
    } catch (e2) {
      html += `<div class="msg err">接入预览失败：${escapeHtml(e2.message)}</div>`;
    }
  }
  panel(box, html);
  const applyBtn = $("btn-wire-apply");
  if (applyBtn) {
    applyBtn.addEventListener("click", () =>
      withBusy(applyBtn, "落盘中…", async () => {
        const res = await api(`/admin/api/units/${state.selectedUnit}/wiring/apply`, {
          method: "POST", body: JSON.stringify({ note: "管理台接入确认" }),
        });
        panel(box, `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`);
        await loadUnits();
      }));
  }
}

$("btn-wiring").addEventListener("click", () => loadWiringAndPack("wiring"));

// —— 🤖 自动接入：预演 → 确认落盘 ——
$("btn-pack").addEventListener("click", () =>
  withBusy($("btn-pack"), "AI 接入中…", async () => {
    const box = $("pack-result");
    panel(box, "AI 接入中（mock=规则生成+编译预检）…");
    const r = await api(`/admin/api/units/${state.selectedUnit}/wiring/ai`, {
      method: "POST", body: JSON.stringify({ mock: true }),
    });
    let html = `<div class="msg ${r.preflight.ok ? "ok" : "err"}">${escapeHtml(r.preflight.summary)}</div><div class="hint">来源：${escapeHtml(r.source)}</div>`;
    html += r.files.map((f) => `<div style="font-weight:600;margin:8px 0 4px">${escapeHtml(f.path)}</div><pre class="code" style="max-height:220px">${escapeHtml(f.diffText)}</pre>`).join("");
    if (r.preflight.ok && !r.preflight.alreadyWired) {
      html += `<div class="row" style="margin-top:10px"><button class="btn" id="btn-pack-apply">确认落盘（git 提交）</button><span class="hint">预演已通过 tsc</span></div>`;
    }
    panel(box, html);
    const applyBtn = $("btn-pack-apply");
    if (applyBtn) {
      applyBtn.addEventListener("click", () =>
        withBusy(applyBtn, "落盘中…", async () => {
          const res = await api(`/admin/api/units/${state.selectedUnit}/wiring/apply`, {
            method: "POST", body: JSON.stringify({ note: "🤖 自动接入确认" }),
          });
          panel(box, `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`);
          await loadUnits();
        }));
    }
  }));

// —— AI 生成验收测试 / 定稿 ——
function aiWorkOut(text) {
  const box = $("ai-work-output");
  box.style.display = "block";
  box.textContent = text;
}

$("btn-judge").addEventListener("click", () => {
  if (!state.selectedUnit) return;
  if ((state.unitFiles?.test ?? "").includes("定稿记录")) {
    alert("该功能验收测试已定稿——不允许被 AI 生成覆盖（纪律守卫）。如需修改请走功能规格演进流程。");
    return;
  }
  withBusy($("btn-judge"), "生成中…", async () => {
    const r = await api(`/admin/api/units/${state.selectedUnit}/judge`, { method: "POST", body: JSON.stringify({ mock: true }) });
    aiWorkOut(`验收测试草稿已生成（${r.invariants.length} 条不变量 → 对应测试骨架）\n\n请切到 impl.test.ts 查看，逐条补全断言后点「确认验收测试（定稿）」。`);
    const data = await api(`/admin/api/units/${state.selectedUnit}`);
    state.unitFiles = data.files;
    state.unitFileTab = "test";
    renderUnitDetail();
  });
});

$("btn-judge-freeze").addEventListener("click", () =>
  withBusy($("btn-judge-freeze"), "定稿中…", async () => {
    const r = await api(`/admin/api/units/${state.selectedUnit}/judge/freeze`, { method: "POST", body: JSON.stringify({}) });
    aiWorkOut(`✅ ${r.message}`);
    await loadUnits();
  }));

// —— AI 实现（自动迭代）——
$("btn-implement").addEventListener("click", () =>
  withBusy($("btn-implement"), "实现中（自动迭代）…", async () => {
    aiWorkOut("内置实现器启动：读功能规格+验收测试 → 生成 impl.ts → 跑验收测试 → 红则重试…\n");
    const r = await api(`/admin/api/units/${state.selectedUnit}/implement`, { method: "POST", body: JSON.stringify({ mock: true, maxRounds: 5 }) });
    aiWorkOut(`${r.rounds.map((x) => `第 ${x.round} 轮 → ${x.ok ? "✅ 验收测试全绿" : "❌ 验收测试红：" + x.summary}`).join("\n")}\n\n${r.ok ? "✅ " : "⚠️ "}${r.message}`);
    if (r.ok) {
      const data = await api(`/admin/api/units/${state.selectedUnit}`);
      state.unitFiles = data.files;
      renderUnitDetail();
      await loadUnits();
    }
  }));

// —— 提交历史 / 回滚 ——
$("btn-history").addEventListener("click", () =>
  withBusy($("btn-history"), "加载中…", async () => {
    const box = $("history-result");
    const r = await api(`/admin/api/units/${state.selectedUnit}/history`);
    if (!r.commits.length) {
      panel(box, `<div class="msg warn">该功能还没有提交历史。</div>`);
      return;
    }
    panel(box, `<div class="msg warn">该功能最近提交（点击回滚 = git revert，历史保留）：</div>` +
      `<div class="check-list">` +
      r.commits.map((c) => `<div class="review-item"><span class="idx">${c.hash.slice(0, 7)}</span><span class="text">${escapeHtml(c.subject)}</span><button class="btn ghost" style="padding:3px 10px" data-hash="${c.hash}">回滚</button></div>`).join("") +
      `</div>`);
    box.querySelectorAll("[data-hash]").forEach((btn) => {
      btn.addEventListener("click", () =>
        withBusy(btn, "回滚中…", async () => {
          if (!confirm(`确认回滚提交 ${btn.dataset.hash.slice(0, 7)}？将生成一次反向提交。`)) return;
          const res = await api(`/admin/api/units/${state.selectedUnit}/rollback`, { method: "POST", body: JSON.stringify({ commit: btn.dataset.hash }) });
          panel(box, `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`);
          await loadUnits();
        }));
    });
  }));

// —— 错误编号一致性检查 ——
$("btn-errorcodes").addEventListener("click", () =>
  withBusy($("btn-errorcodes"), "检查中…", async () => {
    const box = $("errorcodes-result");
    const r = await api(`/admin/api/units/${state.selectedUnit}/errorcodes`);
    panel(box, r.ok
      ? `<div class="msg ok">✅ 一致：spec 声明 ${r.declaredInSpec.length} 个错误编号，impl 全部覆盖，且都已在 ports/errors.ts 定义。</div>`
      : `<div class="msg err">⚠️ 发现 ${r.problems.length} 处不一致：</div>` + renderChecks(r.problems.map((p) => ({ label: p, ok: false }))) +
        `<div class="hint" style="margin-top:6px">spec：${r.declaredInSpec.join(", ") || "（无）"} ｜ impl：${r.thrownInImpl.join(", ") || "（无）"}</div>`);
  }));

// ---------------------------------------------------------------------------
// AI 功能规格生成
// ---------------------------------------------------------------------------

$("btn-ai-generate").addEventListener("click", () => {
  const name = $("ai-name").value.trim();
  const requirement = $("ai-req").value.trim();
  const mock = $("ai-mode").value === "mock";
  $("ai-msg").innerHTML = "";
  if (!name || !requirement) return msg($("ai-msg"), "请填写功能名和一句话需求", "err");
  if (!/^[a-z0-9-]+$/.test(name)) return msg($("ai-msg"), "功能名只允许小写字母/数字/连字符", "err");

  withBusy($("btn-ai-generate"), "生成中…", async () => {
    const draft = await api("/admin/api/ai/generate", { method: "POST", body: JSON.stringify({ name, requirement, mock }) });
    state.aiDraft = { name, ...draft };
    state.aiTab = "ts";
    state.aiReviews = Array(10).fill(null);

    $("ai-checks").innerHTML = renderChecks(draft.checks);
    $("ai-file-tabs").innerHTML = [["ts", "contract.ts（草稿）"], ["md", "spec.md（草稿）"]]
      .map(([key, label]) => `<button class="${key === state.aiTab ? "active" : ""}" data-aitab="${key}">${label}</button>`)
      .join("");
    $("ai-file-tabs").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => { state.aiTab = b.dataset.aitab; renderAiDraft(); });
    });
    renderAiDraft();

    $("ai-review-list").innerHTML = state.aiReviews.map((_, i) => `
      <div class="review-item">
        <span class="idx">${String(i + 1).padStart(2)}/10</span>
        <span class="text">${escapeHtml(draft.reviewItems?.[i] ?? "")}</span>
        <span class="choice">
          <button data-y="1">通过</button><button data-y="0">打回</button>
        </span>
      </div>`).join("");
    $("ai-review-list").querySelectorAll("button").forEach((btn, i) => {
      btn.addEventListener("click", () => setReview(i, btn.dataset.y === "1"));
    });

    $("ai-draft-card").style.display = "block";
    $("ai-review-card").style.display = "block";
    $("ai-freeze-msg").innerHTML = "";
    msg($("ai-msg"), `草稿已生成（${draft.source === "mock" ? "演示模式" : "真实 AI"}）。请逐条评审，全部"通过"才可定稿。`, "warn");
  });
});

function renderAiDraft() {
  $("ai-draft-content").textContent = state.aiTab === "ts" ? state.aiDraft.ts : state.aiDraft.md;
}

function setReview(i, ok) {
  state.aiReviews[i] = ok;
  const row = $("ai-review-list").children[i];
  row.querySelector('[data-y="1"]').className = ok ? "on-y" : "";
  row.querySelector('[data-y="0"]').className = ok === false ? "on-n" : "";
}

$("btn-ai-freeze-confirm").addEventListener("click", () =>
  withBusy($("btn-ai-freeze-confirm"), "定稿中…", async () => {
    if (!state.aiDraft) return;
    const unanswered = state.aiReviews.filter((x) => x === null).length;
    if (unanswered > 0) return msg($("ai-freeze-msg"), `还有 ${unanswered} 项未评审`, "err");
    if (state.aiReviews.includes(false)) return msg($("ai-freeze-msg"), "存在「打回」项——不能定稿", "err");
    const r = await api("/admin/api/ai/freeze", { method: "POST", body: JSON.stringify({ name: state.aiDraft.name, reviews: state.aiReviews }) });
    msg($("ai-freeze-msg"), r.frozen ? `✅ ${r.message}` : "未定稿", r.frozen ? "ok" : "err");
    loadUnits();
  }));

// ---------------------------------------------------------------------------
// 任务单 / 代码浏览浏览 / 业务测试 / 向导
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 任务单（并入功能工作台）
// ---------------------------------------------------------------------------

$("btn-ticket").addEventListener("click", () =>
  withBusy($("btn-ticket"), "生成中…", async () => {
    if (!state.selectedUnit) return;
    const r = await api(`/admin/api/ticket/${state.selectedUnit}`);
    $("ticket-content").textContent = r.ticket;
    $("ticket-result").style.display = "block";
  }));

$("btn-ticket-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("ticket-content").textContent);
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("ticket-content"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

async function loadSourceList() {
  try {
    const r = await api("/admin/api/source/list");
    $("source-file").innerHTML = r.files.map((f) => `<option>${f}</option>`).join("");
  } catch { /* 忽略 */ }
}

$("btn-source-load").addEventListener("click", () =>
  withBusy($("btn-source-load"), "加载中…", async () => {
    const r = await api(`/admin/api/source?file=${encodeURIComponent($("source-file").value)}`);
    $("source-content").textContent = r.content;
  }));

// 业务冒烟操作（空框架）：登录/注册等业务已移除，目前仅健康检查可测；
// 第一个功能接入后，请在这里补充对应的端到端冒烟操作。
const PLAY_OPS = {
  "健康检查 health": { method: "GET", path: "/api/health" },
};

let playCookie = null;

function fillPlayOps() {
  $("play-op").innerHTML = Object.keys(PLAY_OPS).map((k) => `<option>${k}</option>`).join("");
}

$("play-op").addEventListener("change", () => {
  const op = PLAY_OPS[$("play-op").value];
  $("play-body").value = op.body ? JSON.stringify(op.body, null, 2) : "";
  $("play-output").textContent = "填写请求体后点击「发送」。";
});

$("btn-play-send").addEventListener("click", () =>
  withBusy($("btn-play-send"), "发送中…", async () => {
    const op = PLAY_OPS[$("play-op").value];
    let data;
    try {
      data = $("play-body").value.trim() ? JSON.parse($("play-body").value) : undefined;
    } catch {
      return alert("请求体不是合法 JSON");
    }
    const r = await api("/admin/api/play", { method: "POST", body: JSON.stringify({ method: op.method, path: op.path, data, cookie: playCookie ?? undefined }) });
    $("play-output").textContent = `HTTP ${r.status}\n${r.body}`;
    $("play-storage").textContent = r.status === 404
      ? "还没有业务——先用 🏠 开始页说一句话创建你的第一个功能（存储模式：" + (r.storageMode ?? "memory") + "）"
      : "✅ 业务已就绪（存储模式：" + (r.storageMode ?? "memory") + "）";
    if (r.setCookie) {
      const m = /sid=([^;]+)/.exec(r.setCookie);
      playCookie = m ? `sid=${m[1]}` : playCookie;
      $("play-cookie").textContent = `会话 cookie：${playCookie}`;
    }
    if (["/api/logout", "/api/change-password", "/api/change-email", "/api/password-reset"].includes(op.path)) {
      playCookie = null;
      $("play-cookie").textContent = "会话 cookie：无（该操作已使会话失效）";
    }
  }));

$("btn-play-clear").addEventListener("click", () => {
  playCookie = null;
  $("play-cookie").textContent = "会话 cookie：无";
});

/** 快速入口卡片（开始页）：一键跳转到对应 tab。 */
function renderQuickGrid() {
  const cards = [
    { icon: "📦", title: "继续开发", desc: `选择左侧功能，在「功能开发」页按 4 阶段推进（共 ${state.units.length} 个）`, goto: "unit" },
    { icon: "🔌", title: "数据接口", desc: "接口清单 / AI 生成接口/ 定稿", goto: "ports" },
    { icon: "🧪", title: "业务测试", desc: "注册/登录/查我，验证业务", goto: "play" },
    { icon: "⚙️", title: "配置", desc: "存储模式（memory/file/sqlite）/ AI 密钥", goto: "config" },
  ];
  $("quick-grid").innerHTML = cards.map((c) => `
    <div class="unit-card" data-goto="${c.goto}">
      <h4>${c.icon} ${c.title}</h4>
      <div class="hint" style="margin:6px 0">${escapeHtml(c.desc)}</div>
      <div class="meta">点击进入 →</div>
    </div>`).join("");
  $("quick-grid").querySelectorAll("[data-goto]").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      const btn = document.querySelector(`.tabs button[data-tab="${card.dataset.goto}"]`);
      btn.classList.add("active");
      $("panel-" + card.dataset.goto).classList.add("active");
    });
  });
}

// ---------------------------------------------------------------------------
// 数据接口：清单 / 详情 / 编辑 / AI 生成 / 定稿
// ---------------------------------------------------------------------------

async function loadPorts() {
  const grid = $("port-grid");
  grid.innerHTML = "加载中…";
  try {
    const r = await api("/admin/api/ports");
    if (!r.ports.length) {
      grid.innerHTML = `<span class="hint">（该组还没有数据接口）</span>`;
      return;
    }
    grid.innerHTML = "";
    for (const p of r.ports) {
      const card = document.createElement("div");
      card.className = "unit-card";
      card.innerHTML = `
        <h4>${escapeHtml(p.name)} <code style="color:var(--muted);font-size:11px">${escapeHtml(p.interfaceName)}</code></h4>
        <div class="hint" style="margin:6px 0">${escapeHtml(p.description)}</div>
        <div class="badges"><span class="badge mute">📌 依赖 ${p.usedBy.length} 功能</span><span class="badge mute">🔧 实现 ${p.adapters.length}</span></div>
        <div class="hint" style="margin-top:6px">${p.usedBy.map((u) => `<code>${escapeHtml(u)}</code>`).join(" ")}</div>`;
      card.addEventListener("click", async () => {
        $("port-detail-card").style.display = "block";
        $("port-detail-title").textContent = `数据接口详情：${p.name}（${p.interfaceName}）`;
        $("port-detail-content").textContent = "加载中…";
        try {
          const src = await api(`/admin/api/source?file=ports/${p.name}.ts`);
          const frozen = src.content.includes("定稿记录");
          state.portDetail = { name: p.name, content: src.content, frozen };
          $("port-detail-status").textContent = frozen ? "🔒 已定稿（编辑将 git 留痕）" : "📄 草稿（未定稿）";
          const adapterLine = p.adapters.length
            ? `\n\n—— 实现实现：\n${p.adapters.map((a) => `  ${a}`).join("\n")}`
            : "\n\n—— ⚠️ 暂无实现实现（功能将无法注入该数据接口）";
          $("port-detail-content").textContent = src.content + adapterLine;
        } catch (err) {
          $("port-detail-content").textContent = `加载失败：${err.message}`;
        }
      });
      grid.appendChild(card);
    }
  } catch (err) {
    grid.innerHTML = `<span class="msg err">${escapeHtml(err.message)}</span>`;
  }
}

function portNewMsg(text, kind = "err") {
  $("port-msg").innerHTML = `<div class="msg ${kind}">${escapeHtml(text)}</div>`;
}

$("btn-port-create").addEventListener("click", () => {
  const name = $("port-new-name").value.trim();
  const description = $("port-new-desc").value.trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) return portNewMsg("数据接口名只允许小写字母/数字/连字符");
  withBusy($("btn-port-create"), "创建中…", async () => {
    const r = await api("/admin/api/ports", { method: "POST", body: JSON.stringify({ name, description }) });
    portNewMsg(`✅ 已创建数据接口 ${r.interfaceName}（定稿区模板，请人工填写接口方法）`, "ok");
    $("port-new-name").value = "";
    $("port-new-desc").value = "";
    await loadPorts();
  });
});

let portAiState = null;

$("btn-port-ai").addEventListener("click", () => {
  const name = $("port-new-name").value.trim();
  const description = $("port-new-desc").value.trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) return portNewMsg("请先填写数据接口名（kebab-case）");
  withBusy($("btn-port-ai"), "生成中…", async () => {
    const r = await api("/admin/api/ports/generate", {
      method: "POST",
      body: JSON.stringify({ name, description, mock: $("port-ai-mock").checked }),
    });
    portAiState = r;
    $("port-ai-card").style.display = "block";
    $("port-ai-checks").innerHTML = renderChecks(r.checks);
    $("port-ai-content").textContent = r.content;
    $("port-ai-hint").textContent = r.machineOk
      ? "自动检查全部通过——请人审阅后确认定稿。"
      : "自动检查发现纪律问题——请审阅并修正后确认（或打回人工编辑）。";
  });
});

$("btn-port-freeze").addEventListener("click", () =>
  withBusy($("btn-port-freeze"), "定稿中…", async () => {
    if (!portAiState) return;
    const r = await api(`/admin/api/ports/${portAiState.name}/freeze`, { method: "POST", body: JSON.stringify({}) });
    $("port-ai-hint").textContent = `✅ ${r.message}`;
    $("port-ai-card").style.display = "none";
    portAiState = null;
    await loadPorts();
  }));

// —— 数据接口编辑（共享编辑器）——
$("btn-port-edit").addEventListener("click", () => {
  if (!state.portDetail) return;
  editor.open({
    title: `编辑数据接口 ${state.portDetail.name}${state.portDetail.frozen ? "（已定稿）" : "（草稿）"}`,
    content: state.portDetail.content,
    warning: "数据接口是定稿区文件——人编辑允许，但每次保存强制 git 留痕，请填写修改说明。",
    save: async (content, note) =>
      api(`/admin/api/ports/${state.portDetail.name}`, { method: "PUT", body: JSON.stringify({ content, note }) }),
    onSaved: async () => {
      state.portDetail.content = $("editor-content").value;
      $("port-detail-content").textContent = state.portDetail.content;
      await loadPorts();
    },
  });
});

// ---------------------------------------------------------------------------
// 自动开发（超级向导）
// ---------------------------------------------------------------------------

let pipe = null;

function renderPipeline() {
  if (!pipe) return;
  $("pipe-body").style.display = "block";
  const steps = pipe.artifact?.steps ?? [];
  const currentIdx = steps.findIndex((s) => s.id === pipe.step);
  $("pipe-steps").innerHTML = steps
    .map((s, i) => `<span style="margin-right:10px">${i < currentIdx ? "✅" : i === currentIdx ? "▶️" : "⬜"} ${escapeHtml(s.label)}</span>`)
    .join("");
  $("pipe-log").textContent = pipe.log.join("\n");

  const art = pipe.artifact ?? {};
  let html = "";
  if (pipe.step === "plan" && art.plan) {
    html = `<div class="msg warn">规划方案（请确认或打回）：</div><div class="check-list">${art.plan.reasons.map((r) => `<div class="check-row"><span class="mark">📋</span><span>${escapeHtml(r)}</span></div>`).join("")}</div>`;
  }
  if (pipe.step === "port" && art.port) {
    html = `<div class="msg warn">数据接口草稿（AI 助手-D）——自动检查：</div>${renderChecks(art.port.checks)}<pre class="code" style="max-height:200px">${escapeHtml(art.port.content)}</pre>`;
  }
  if (pipe.step === "contract" && art.draft) {
    html = `<div class="msg warn">功能规格草稿（AI 助手-A）——自动检查：</div>${renderChecks(art.machine.checks)}<pre class="code" style="max-height:200px">${escapeHtml(art.draft.ts.slice(0, 1200))}</pre>`;
  }
  if (pipe.step === "judge" && art.judge) {
    html = `<div class="msg warn">验收测试骨架（AI 助手-B，${art.judge.invariants.length} 条不变量）——占位验收测试不允许定稿，请先在「功能详情」补全断言</div><pre class="code" style="max-height:200px">${escapeHtml(art.judge.test.slice(0, 1000))}</pre>`;
  }
  if (pipe.step === "implement" && art.impl) {
    html = `<div class="msg warn">实现器结果（AI 助手-C，${art.impl.rounds.length} 轮）：</div>` +
      `<div class="check-list">${art.impl.rounds.map((r) => `<div class="check-row"><span class="mark">${r.ok ? "✅" : "❌"}</span><span>第 ${r.round} 轮：${escapeHtml(r.summary)}</span></div>`).join("")}</div>` +
      `<div class="msg ${art.impl.ok ? "ok" : "warn"}">${escapeHtml(art.impl.message)}</div>`;
  }
  if (pipe.step === "wiring" && art.wiring) {
    html = `<div class="msg warn">接入草稿（AI 助手-E）：${escapeHtml(art.wiring.source)}</div>`;
    if (art.wiring.preflight) html += `<div class="msg ${art.wiring.preflight.ok ? "ok" : "err"}">${escapeHtml(art.wiring.preflight.summary)}</div>`;
    if (art.wiring.checks) html += renderChecks(art.wiring.checks);
  }
  if (pipe.step === "done") html = `<div class="msg ok">🎉 自动开发完成。请运行总闸并冒烟验证。</div>`;
  $("pipe-artifact").innerHTML = html;
  $("pipe-actions").style.display = pipe.step === "done" ? "none" : "";
}

$("btn-pipe-start").addEventListener("click", () => {
  const requirement = $("pipe-req").value.trim();
  if (requirement.length < 4) return msg($("pipe-msg"), "请用一句话描述功能需求（至少 4 字）", "err");
  withBusy($("btn-pipe-start"), "分析中…", async () => {
    pipe = await api("/admin/api/pipeline/start", { method: "POST", body: JSON.stringify({ requirement, mock: $("pipe-mock").checked }) });
    $("pipe-msg").innerHTML = "";
    renderPipeline();
  });
});

$("btn-pipe-confirm").addEventListener("click", () =>
  withBusy($("btn-pipe-confirm"), "处理中…", async () => {
    if (!pipe || pipe.step === "done") return;
    pipe = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: true }) });
    renderPipeline();
    if (pipe.error) msg($("pipe-msg"), pipe.error, "err");
  }));

$("btn-pipe-reject").addEventListener("click", () =>
  withBusy($("btn-pipe-reject"), "处理中…", async () => {
    if (!pipe || pipe.step === "done") return;
    pipe = await api("/admin/api/pipeline/confirm", { method: "POST", body: JSON.stringify({ approved: false }) });
    renderPipeline();
  }));

// ---------------------------------------------------------------------------
// 首次使用引导（onboarding）：安装后带用户走完前 4 步
// ---------------------------------------------------------------------------

/** 跳转到指定 tab（供引导按钮复用）。 */
function goto(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`.tabs button[data-tab="${tab}"]`).classList.add("active");
  $("panel-" + tab).classList.add("active");
}

/**
 * 分步教学引导（onboarding）：安装后一次教一步（6 步），
 * 每步：说明 + 操作跳转 + 上一步/下一步；AI 配置完成自动标记。
 */
async function renderOnboarding() {
  const box = $("onboarding");
  if (!box) return;
  const finished = localStorage.getItem("fu-tutorial") === "done";

  // AI 是否就绪（第 2 步完成检查）
  let aiReady = false;
  try {
    const cfg = await api("/admin/api/config");
    aiReady = cfg.values.find((v) => v.key === "AI_API_KEY")?.hasValue ?? false;
  } catch { /* 忽略 */ }

  if (finished && aiReady) {
    box.innerHTML = "";
    return;
  }

  // 当前步骤（默认 1；已配置 AI 则从第 2 步开始）
  let step = parseInt(localStorage.getItem("fu-tutorial-step") ?? "1", 10);
  if (step === 1 && aiReady) step = 2;
  if (step > 6) step = 6;

  const STEPS = [
    {
      icon: "👋", title: "欢迎使用 FeatureUnit",
      body: "这是一个<b>让 AI 放心写代码</b>的框架：<br>你只说一句话 → 系统自动规划（业务系统/数据接口/功能）→ 逐步 AI 生成 → <b>机器验收测试把关</b> → <b>你确认</b>（每步都进 git，可追溯）。",
      action: null,
    },
    {
      icon: "⚙️", title: "第 1 步：配置 AI",
      body: aiReady
        ? "✅ AI 已配置。<br>模型列表是<b>自动获取</b>的（保存时从 API 拉取）；推理等级：low=快省 / medium=平衡 / high=深度推理。"
        : "填入 API Key（打码保存，不进 git）、选模型与推理等级。<br>没有 Key 也可以——用<b>演示模式（mock）</b>走完全相同的流程。",
      goto: "config", gotoText: "去配置 →", done: aiReady,
    },
    {
      icon: "🗣️", title: "第 2 步：说一句话，创建第一个功能",
      body: "在<b>下方输入框</b>描述需求（如：支持用户收藏商品）→ 「开始自动开发」。<br>系统会走 7 步自动开发：规划 → 数据接口 → 功能规格 → 验收测试 → 实现 → 接入 → 完成，<b>每步你确认或打回</b>。",
      action: "start", actionText: "去输入 →",
    },
    {
      icon: "📦", title: "第 3 步：认识功能工作台",
      body: "每个功能按 <b>4 阶段</b>推进：<br>① 功能规格（AI 生成 + 10 项评审 + 定稿）② 验收测试（AI 生成 + 补全断言 + 定稿）③ 实现（AI 自动迭代，验收测试全绿才提交）④ 接入与工具（AI 接入 + 编译预检 + 回滚/错误编号检查）。<br>顶部进度条显示走到哪一步。",
      goto: "unit", gotoText: "去看工作台 →",
    },
    {
      icon: "🧪", title: "第 4 步：试试业务",
      body: "用<b>内置业务测试</b>验证你创建的功能（注册/登录/查我…），cookie 自动流转，无需另起服务。<br>还没有业务时会提示你：先回「开始」页创建第一个功能。",
      goto: "play", gotoText: "去业务测试 →",
    },
    {
      icon: "🎉", title: "完成！接下来呢？",
      body: "你已经学会核心循环：<b>说一句话 → 逐步生成 → 逐步确认</b>。<br>更深入的用法见 docs/：使用手册（USAGE）、教程（TUTORIAL）、指南（GUIDE）。",
      action: null,
    },
  ];

  const s = STEPS[step - 1];
  box.innerHTML = `
    <div class="card" style="border-color:var(--accent); background:linear-gradient(180deg,#fff,var(--accent-weak))">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div class="logo" style="width:40px;height:40px;font-size:18px">FU</div>
        <div style="flex:1">
          <h2 style="margin:0">${s.icon} ${escapeHtml(s.title)}</h2>
          <div class="hint">${step} / ${STEPS.length} 步</div>
        </div>
        <button class="btn ghost" id="btn-tut-close" title="关闭引导">✕</button>
      </div>
      <div class="msg warn" style="margin:8px 0 12px">${s.body}</div>
      <div class="row">
        <button class="btn ghost" id="btn-tut-prev" ${step === 1 ? "disabled" : ""}>← 上一步</button>
        ${s.goto ? `<button class="btn" id="btn-tut-goto">${s.gotoText ?? "去完成 →"}</button>` : ""}
        ${s.action === "start" ? `<button class="btn" id="btn-tut-goto" data-focus="pipe-req">去输入 →</button>` : ""}
        <button class="btn" id="btn-tut-next">${step === STEPS.length ? "🎉 开始使用" : "下一步 →"}</button>
      </div>
    </div>`;

  // 操作
  const close = () => {
    localStorage.setItem("fu-tutorial", "done");
    box.innerHTML = "";
  };
  $("btn-tut-close")?.addEventListener("click", close);
  $("btn-tut-prev")?.addEventListener("click", () => {
    localStorage.setItem("fu-tutorial-step", String(Math.max(1, step - 1)));
    renderOnboarding();
  });
  $("btn-tut-next")?.addEventListener("click", () => {
    if (step >= STEPS.length) return close();
    localStorage.setItem("fu-tutorial-step", String(step + 1));
    renderOnboarding();
  });
  $("btn-tut-goto")?.addEventListener("click", () => {
    if (s.goto) goto(s.goto);
    if (s.action === "start") {
      goto("start");
      $("pipe-req")?.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// 数据接口矩阵 / 配置
// ---------------------------------------------------------------------------

async function loadPortMatrix() {
  const box = $("ports-matrix");
  try {
    const r = await api("/admin/api/ports/map");
    if (!r.ports.length) {
      box.innerHTML = `<span class="hint">（无功能或无数据接口）</span>`;
      return;
    }
    box.innerHTML = `<table style="border-collapse:collapse;font-size:12.5px">
      <tr><th style="text-align:left;padding:4px 10px">功能 \\ 数据接口</th>${r.ports.map((p) => `<th style="padding:4px 8px;font-family:var(--mono)">${p}</th>`).join("")}</tr>
      ${r.units.map((u) => `<tr><td style="padding:4px 10px;font-family:var(--mono)">${u.name}</td>${r.ports.map((p) => `<td style="text-align:center;padding:4px 8px">${u.ports.includes(p) ? "●" : ""}</td>`).join("")}</tr>`).join("")}
    </table>`;
  } catch (err) {
    box.innerHTML = `<span class="msg err">${escapeHtml(err.message)}</span>`;
  }
}

const configInputs = {};

async function loadConfigPanel() {
  try {
    const r = await api("/admin/api/config");
    $("config-path").textContent = `写入位置：${r.localPath}`;
    const list = $("config-list");
    list.innerHTML = "";
    for (const item of r.values) {
      const row = document.createElement("div");
      row.className = "review-item";
      row.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:600">${escapeHtml(item.label)} <code style="color:var(--muted)">${item.key}</code></div>
          <div class="hint">来源：${item.source}${item.secret && item.hasValue ? " · 密钥已打码" : ""}</div>
        </div>`;
      let control;
      if (Array.isArray(item.options) && item.options.length) {
        const sel = document.createElement("select");
        sel.style.cssText = "flex:1.2;font-family:var(--mono)";
        sel.innerHTML = item.options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}${o === item.fallback ? "（默认）" : ""}</option>`).join("");
        if (item.hasValue && item.options.includes(item.value)) sel.value = item.value;
        control = sel;
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.style.cssText = "flex:1.2;font-family:var(--mono)";
        input.placeholder = item.secret ? "留空 = 删除该密钥" : `默认值：${item.fallback}`;
        if (!item.secret && item.hasValue) input.value = item.value;
        if (item.secret) input.placeholder = item.hasValue ? "已配置（保存时留空 = 删除）" : "未配置（粘贴密钥）";
        control = input;
      }
      row.appendChild(control);
      configInputs[item.key] = control;
      list.appendChild(row);
    }
  } catch (err) {
    $("config-path").textContent = `加载失败：${err.message}`;
  }
}

$("btn-config-save").addEventListener("click", () =>
  withBusy($("btn-config-save"), "保存中…", async () => {
    const values = {};
    for (const [key, input] of Object.entries(configInputs)) values[key] = input.value.trim();
    await api("/admin/api/config", { method: "PUT", body: JSON.stringify({ values }) });
    $("config-msg").innerHTML = `<div class="msg ok">✅ 已保存到本地配置文件（不进入 git）</div>`;
    await loadConfigPanel();
renderOnboarding();  }));

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

$("btn-refresh").addEventListener("click", () => {
  loadUnits();
  loadPortMatrix();
  loadPorts();
});

fillPlayOps();
loadGroups();
loadUnits();
loadSourceList();
loadPortMatrix();
loadPorts();
loadConfigPanel();
renderOnboarding();