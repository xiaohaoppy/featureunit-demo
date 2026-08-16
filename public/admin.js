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

/** 请求（自动附带当前服务组）。 */
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

/** 检查清单渲染（✅/⚠️ 列表，机器初审/接线/错误码等共用）。 */
function renderChecks(checks) {
  return `<div class="check-list">${checks
    .map((c) => `<div class="check-row"><span class="mark">${c.ok ? "✅" : "⚠️"}</span><span>${escapeHtml(c.label)}</span></div>`)
    .join("")}</div>`;
}

/**
 * 共享文件编辑器（单元/端口详情共用）。
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
// 服务组：切换 / 新建
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
  const name = prompt("新服务组名（kebab-case，如 order-service）：", "order-service");
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  try {
    await api("/admin/api/groups", { method: "POST", body: JSON.stringify({ name }) });
    alert(`✓ 已创建服务组 ${name}（组骨架：ports/组合根/config/manifest/组判据）`);
    await loadGroups();
  } catch (err) {
    alert(`创建失败：${err.message}`);
  }
});

$("btn-new-unit").addEventListener("click", async () => {
  const name = prompt("新功能单元名（kebab-case，如 verify-2fa）：", "verify-2fa");
  if (!name || !/^[a-z0-9-]+$/.test(name)) return;
  try {
    await api("/admin/api/units", { method: "POST", body: JSON.stringify({ name }) });
    alert(`✓ 已生成功能单元 ${name}\n下一步：在「AI 契约生成」面板生成契约，或人工填写。`);
    await loadUnits();
  } catch (err) {
    alert(`创建失败：${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// 单元：列表 / 详情 / 编辑 / 判据 / 实现 / 接线 / 打包 / 历史 / 错误码
// ---------------------------------------------------------------------------

const FILE_LABELS = { contract: "contract.ts", spec: "spec.md", impl: "impl.ts", test: "impl.test.ts" };
const FROZEN_WARN = { contract: "契约（冻结区）", spec: "规格（冻结区）", test: "判据（冻结区）", impl: "实现（AI 写入区）" };

async function loadUnits() {
  try {
    const data = await api("/admin/api/units");
    state.units = data.units;
    $("group-label").textContent = `${data.group} · ${data.units.length} 个功能单元`;
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
          ${u.frozen ? `<span class="badge ok">已冻结</span>` : u.hasContract ? `<span class="badge warn">契约草稿</span>` : `<span class="badge mute">无契约</span>`}
          ${u.hasImpl ? `<span class="badge ok">实现</span>` : `<span class="badge err">无实现</span>`}
          ${u.hasTest ? `<span class="badge ok">判据</span>` : `<span class="badge warn">无判据</span>`}
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
    $("ai-name").value = name; // 契约生成自动带单元名
    loadUnitWizard();
  } catch (err) {
    $("unit-title").textContent = `加载失败：${err.message}`;
  }
}

/** 单元工作台：5 步进度条 + 各阶段状态（复用向导 status API）。 */
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
    $("state-contract").textContent = r.steps[0]?.done ? "✅ 已冻结" : "待生成";
    $("state-judge").textContent = r.steps[1]?.done ? "✅ 就绪" : "待生成";
    $("state-impl").textContent = r.steps[2]?.done ? "✅ 完成" : "待实现";
    $("state-wiring").textContent = r.steps[3]?.done ? "✅ 已接线" : "待接线";
  } catch { /* 忽略 */ }
}

function renderUnitDetail() {
  const u = state.units.find((x) => x.name === state.selectedUnit);
  $("unit-title").textContent = `单元详情：${state.selectedUnit}${u?.frozen ? "（已冻结）" : ""}`;
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
    warning: "冻结区文件（契约/判据/规格）由人编辑是允许的，但每次保存都会留下 git 记录——请填写修改说明。",
    save: async (content, note) =>
      api(`/admin/api/units/${state.selectedUnit}/files`, { method: "PUT", body: JSON.stringify({ file, content, note }) }),
    onSaved: async () => {
      state.unitFiles[file] = $("editor-content").value;
      renderUnitDetail();
      await loadUnits();
    },
  });
});

// —— 运行本单元判据 ——
$("btn-run-unit").addEventListener("click", () =>
  withBusy($("btn-run-unit"), "运行中…", async () => {
    const r = await api(`/admin/api/units/${state.selectedUnit}/test`, { method: "POST" });
    $("unit-test-summary").textContent = r.summary;
    const out = $("unit-test-output");
    out.style.display = "block";
    out.textContent = r.output;
  }));

// —— 运行全部判据 ——
$("btn-run-all").addEventListener("click", () =>
  withBusy($("btn-run-all"), "运行中…", async () => {
    const r = await api("/admin/api/tests/all", { method: "POST" });
    panel($("overview-output"), `[${r.ok ? "✅ 全部通过" : "❌ 有失败"}] ${r.summary}\n\n${r.output}`);
  }));

// —— 接线检查 + 一键接线（含 AI 打包按钮复用同一输出区）——
async function loadWiringAndPack(kind) {
  const box = kind === "wiring" ? $("wiring-result") : $("pack-result");
  panel(box, "加载中…");
  const r = await api(`/admin/api/units/${state.selectedUnit}/wiring`);
  let html = `<div class="msg ${r.allOk ? "ok" : "warn"}">${r.allOk ? "✅ 已完整接线" : "⚠️ 尚未完全接线"}</div>`;
  html += renderChecks(r.checks);

  if (!r.allOk) {
    try {
      const p = await api(`/admin/api/units/${state.selectedUnit}/wiring/preview`);
      if (p.alreadyWired) {
        html += `<div class="msg ok">已接线，无需改动。</div>`;
      } else if (p.files.length) {
        html += `<div class="msg warn">机器生成的接线改动（<b>人审阅后确认才落盘</b>）：</div>`;
        html += p.files.map((f) => `<div style="font-weight:600;margin:8px 0 4px">${escapeHtml(f.path)}</div><pre class="code" style="max-height:260px">${escapeHtml(f.diffText)}</pre>`).join("");
        html += `<div class="row" style="margin-top:10px"><button class="btn" id="btn-wire-apply">确认接线（落盘 + git 提交）</button></div>`;
      } else {
        html += `<div class="msg err">无法生成接线改动（锚点缺失），请人工编辑组合根。</div>`;
      }
    } catch (e2) {
      html += `<div class="msg err">接线预览失败：${escapeHtml(e2.message)}</div>`;
    }
  }
  panel(box, html);
  const applyBtn = $("btn-wire-apply");
  if (applyBtn) {
    applyBtn.addEventListener("click", () =>
      withBusy(applyBtn, "落盘中…", async () => {
        const res = await api(`/admin/api/units/${state.selectedUnit}/wiring/apply`, {
          method: "POST", body: JSON.stringify({ note: "管理台接线确认" }),
        });
        panel(box, `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`);
        await loadUnits();
      }));
  }
}

$("btn-wiring").addEventListener("click", () => loadWiringAndPack("wiring"));

// —— AI 打包（Agent-E）：预演 → 确认落盘 ——
$("btn-pack").addEventListener("click", () =>
  withBusy($("btn-pack"), "AI 打包中…", async () => {
    const box = $("pack-result");
    panel(box, "AI 打包中（mock=规则生成+tsc 预演）…");
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
            method: "POST", body: JSON.stringify({ note: "AI 打包（Agent-E）确认" }),
          });
          panel(box, `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`);
          await loadUnits();
        }));
    }
  }));

// —— AI 生成判据 / 冻结 ——
function aiWorkOut(text) {
  const box = $("ai-work-output");
  box.style.display = "block";
  box.textContent = text;
}

$("btn-judge").addEventListener("click", () => {
  if (!state.selectedUnit) return;
  if ((state.unitFiles?.test ?? "").includes("冻结记录")) {
    alert("该单元判据已冻结——不允许被 AI 生成覆盖（纪律守卫）。如需修改请走契约演进流程。");
    return;
  }
  withBusy($("btn-judge"), "生成中…", async () => {
    const r = await api(`/admin/api/units/${state.selectedUnit}/judge`, { method: "POST", body: JSON.stringify({ mock: true }) });
    aiWorkOut(`判据草稿已生成（${r.invariants.length} 条不变量 → 对应测试骨架）\n\n请切到 impl.test.ts 查看，逐条补全断言后点「确认判据（冻结）」。`);
    const data = await api(`/admin/api/units/${state.selectedUnit}`);
    state.unitFiles = data.files;
    state.unitFileTab = "test";
    renderUnitDetail();
  });
});

$("btn-judge-freeze").addEventListener("click", () =>
  withBusy($("btn-judge-freeze"), "冻结中…", async () => {
    const r = await api(`/admin/api/units/${state.selectedUnit}/judge/freeze`, { method: "POST", body: JSON.stringify({}) });
    aiWorkOut(`✅ ${r.message}`);
    await loadUnits();
  }));

// —— AI 实现（自动迭代）——
$("btn-implement").addEventListener("click", () =>
  withBusy($("btn-implement"), "实现中（自动迭代）…", async () => {
    aiWorkOut("内置实现器启动：读契约+判据 → 生成 impl.ts → 跑判据 → 红则重试…\n");
    const r = await api(`/admin/api/units/${state.selectedUnit}/implement`, { method: "POST", body: JSON.stringify({ mock: true, maxRounds: 5 }) });
    aiWorkOut(`${r.rounds.map((x) => `第 ${x.round} 轮 → ${x.ok ? "✅ 判据全绿" : "❌ 判据红：" + x.summary}`).join("\n")}\n\n${r.ok ? "✅ " : "⚠️ "}${r.message}`);
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
      panel(box, `<div class="msg warn">该单元还没有提交历史。</div>`);
      return;
    }
    panel(box, `<div class="msg warn">该单元最近提交（点击回滚 = git revert，历史保留）：</div>` +
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

// —— 错误码一致性检查 ——
$("btn-errorcodes").addEventListener("click", () =>
  withBusy($("btn-errorcodes"), "检查中…", async () => {
    const box = $("errorcodes-result");
    const r = await api(`/admin/api/units/${state.selectedUnit}/errorcodes`);
    panel(box, r.ok
      ? `<div class="msg ok">✅ 一致：spec 声明 ${r.declaredInSpec.length} 个错误码，impl 全部覆盖，且都已在 ports/errors.ts 定义。</div>`
      : `<div class="msg err">⚠️ 发现 ${r.problems.length} 处不一致：</div>` + renderChecks(r.problems.map((p) => ({ label: p, ok: false }))) +
        `<div class="hint" style="margin-top:6px">spec：${r.declaredInSpec.join(", ") || "（无）"} ｜ impl：${r.thrownInImpl.join(", ") || "（无）"}</div>`);
  }));

// ---------------------------------------------------------------------------
// AI 契约生成
// ---------------------------------------------------------------------------

$("btn-ai-generate").addEventListener("click", () => {
  const name = $("ai-name").value.trim();
  const requirement = $("ai-req").value.trim();
  const mock = $("ai-mode").value === "mock";
  $("ai-msg").innerHTML = "";
  if (!name || !requirement) return msg($("ai-msg"), "请填写功能单元名和一句话需求", "err");
  if (!/^[a-z0-9-]+$/.test(name)) return msg($("ai-msg"), "功能单元名只允许小写字母/数字/连字符", "err");

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
    msg($("ai-msg"), `草稿已生成（${draft.source === "mock" ? "演示模式" : "真实 AI"}）。请逐条评审，全部"通过"才可冻结。`, "warn");
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
  withBusy($("btn-ai-freeze-confirm"), "冻结中…", async () => {
    if (!state.aiDraft) return;
    const unanswered = state.aiReviews.filter((x) => x === null).length;
    if (unanswered > 0) return msg($("ai-freeze-msg"), `还有 ${unanswered} 项未评审`, "err");
    if (state.aiReviews.includes(false)) return msg($("ai-freeze-msg"), "存在「打回」项——不能冻结", "err");
    const r = await api("/admin/api/ai/freeze", { method: "POST", body: JSON.stringify({ name: state.aiDraft.name, reviews: state.aiReviews }) });
    msg($("ai-freeze-msg"), r.frozen ? `✅ ${r.message}` : "未冻结", r.frozen ? "ok" : "err");
    loadUnits();
  }));

// ---------------------------------------------------------------------------
// Ticket / 源码浏览 / 试玩 / 向导
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ticket（并入单元工作台）
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

const PLAY_OPS = {
  "注册 register": { method: "POST", path: "/api/register", body: { email: "demo@b.com", password: "secret123" } },
  "登录 login": { method: "POST", path: "/api/login", body: { email: "demo@b.com", password: "secret123" } },
  "查我 me": { method: "GET", path: "/api/me" },
  "登出 logout": { method: "POST", path: "/api/logout" },
  "修改密码 change-password": { method: "POST", path: "/api/change-password", body: { currentPassword: "secret123", newPassword: "newpass456" } },
  "修改邮箱 change-email": { method: "POST", path: "/api/change-email", body: { currentPassword: "secret123", newEmail: "new@b.com" } },
  "找回密码-请求 request-reset": { method: "POST", path: "/api/password-reset/request", body: { email: "demo@b.com" } },
  "找回密码-重置 reset": { method: "POST", path: "/api/password-reset", body: { token: "REPLACE_ME", newPassword: "resetpass9" } },
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
    $("play-storage").textContent = `存储模式：${r.storageMode ?? "memory"}（「配置」面板可切换，保存后本面板自动生效）`;
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
    { icon: "🔌", title: "数据接口", desc: "接口清单 / AI 生成（Agent-D）/ 冻结", goto: "ports" },
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
// 端口：清单 / 详情 / 编辑 / AI 生成 / 冻结
// ---------------------------------------------------------------------------

async function loadPorts() {
  const grid = $("port-grid");
  grid.innerHTML = "加载中…";
  try {
    const r = await api("/admin/api/ports");
    if (!r.ports.length) {
      grid.innerHTML = `<span class="hint">（该组还没有端口）</span>`;
      return;
    }
    grid.innerHTML = "";
    for (const p of r.ports) {
      const card = document.createElement("div");
      card.className = "unit-card";
      card.innerHTML = `
        <h4>${escapeHtml(p.name)} <code style="color:var(--muted);font-size:11px">${escapeHtml(p.interfaceName)}</code></h4>
        <div class="hint" style="margin:6px 0">${escapeHtml(p.description)}</div>
        <div class="badges"><span class="badge mute">📌 依赖 ${p.usedBy.length} 单元</span><span class="badge mute">🔧 适配器 ${p.adapters.length}</span></div>
        <div class="hint" style="margin-top:6px">${p.usedBy.map((u) => `<code>${escapeHtml(u)}</code>`).join(" ")}</div>`;
      card.addEventListener("click", async () => {
        $("port-detail-card").style.display = "block";
        $("port-detail-title").textContent = `端口详情：${p.name}（${p.interfaceName}）`;
        $("port-detail-content").textContent = "加载中…";
        try {
          const src = await api(`/admin/api/source?file=ports/${p.name}.ts`);
          const frozen = src.content.includes("冻结记录");
          state.portDetail = { name: p.name, content: src.content, frozen };
          $("port-detail-status").textContent = frozen ? "🔒 已冻结（编辑将 git 留痕）" : "📄 草稿（未冻结）";
          const adapterLine = p.adapters.length
            ? `\n\n—— 适配器实现：\n${p.adapters.map((a) => `  ${a}`).join("\n")}`
            : "\n\n—— ⚠️ 暂无适配器实现（单元将无法注入该端口）";
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
  if (!name || !/^[a-z0-9-]+$/.test(name)) return portNewMsg("端口名只允许小写字母/数字/连字符");
  withBusy($("btn-port-create"), "创建中…", async () => {
    const r = await api("/admin/api/ports", { method: "POST", body: JSON.stringify({ name, description }) });
    portNewMsg(`✅ 已创建端口 ${r.interfaceName}（冻结区模板，请人工填写接口方法）`, "ok");
    $("port-new-name").value = "";
    $("port-new-desc").value = "";
    await loadPorts();
  });
});

let portAiState = null;

$("btn-port-ai").addEventListener("click", () => {
  const name = $("port-new-name").value.trim();
  const description = $("port-new-desc").value.trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) return portNewMsg("请先填写端口名（kebab-case）");
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
      ? "机器初审全部通过——请人审阅后确认冻结。"
      : "机器初审发现纪律问题——请审阅并修正后确认（或打回人工编辑）。";
  });
});

$("btn-port-freeze").addEventListener("click", () =>
  withBusy($("btn-port-freeze"), "冻结中…", async () => {
    if (!portAiState) return;
    const r = await api(`/admin/api/ports/${portAiState.name}/freeze`, { method: "POST", body: JSON.stringify({}) });
    $("port-ai-hint").textContent = `✅ ${r.message}`;
    $("port-ai-card").style.display = "none";
    portAiState = null;
    await loadPorts();
  }));

// —— 端口编辑（共享编辑器）——
$("btn-port-edit").addEventListener("click", () => {
  if (!state.portDetail) return;
  editor.open({
    title: `编辑端口 ${state.portDetail.name}${state.portDetail.frozen ? "（已冻结）" : "（草稿）"}`,
    content: state.portDetail.content,
    warning: "端口是冻结区文件——人编辑允许，但每次保存强制 git 留痕，请填写修改说明。",
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
// 流水线（超级向导）
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
    html = `<div class="msg warn">端口草稿（Agent-D）——机器初审：</div>${renderChecks(art.port.checks)}<pre class="code" style="max-height:200px">${escapeHtml(art.port.content)}</pre>`;
  }
  if (pipe.step === "contract" && art.draft) {
    html = `<div class="msg warn">契约草稿（Agent-A）——机器初审：</div>${renderChecks(art.machine.checks)}<pre class="code" style="max-height:200px">${escapeHtml(art.draft.ts.slice(0, 1200))}</pre>`;
  }
  if (pipe.step === "judge" && art.judge) {
    html = `<div class="msg warn">判据骨架（Agent-B，${art.judge.invariants.length} 条不变量）——占位判据不允许冻结，请先在「单元详情」补全断言</div><pre class="code" style="max-height:200px">${escapeHtml(art.judge.test.slice(0, 1000))}</pre>`;
  }
  if (pipe.step === "implement" && art.impl) {
    html = `<div class="msg warn">实现器结果（Agent-C，${art.impl.rounds.length} 轮）：</div>` +
      `<div class="check-list">${art.impl.rounds.map((r) => `<div class="check-row"><span class="mark">${r.ok ? "✅" : "❌"}</span><span>第 ${r.round} 轮：${escapeHtml(r.summary)}</span></div>`).join("")}</div>` +
      `<div class="msg ${art.impl.ok ? "ok" : "warn"}">${escapeHtml(art.impl.message)}</div>`;
  }
  if (pipe.step === "wiring" && art.wiring) {
    html = `<div class="msg warn">打包草稿（Agent-E）：${escapeHtml(art.wiring.source)}</div>`;
    if (art.wiring.preflight) html += `<div class="msg ${art.wiring.preflight.ok ? "ok" : "err"}">${escapeHtml(art.wiring.preflight.summary)}</div>`;
    if (art.wiring.checks) html += renderChecks(art.wiring.checks);
  }
  if (pipe.step === "done") html = `<div class="msg ok">🎉 流水线完成。请运行总闸并冒烟验证。</div>`;
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
// 端口矩阵 / 配置
// ---------------------------------------------------------------------------

async function loadPortMatrix() {
  const box = $("ports-matrix");
  try {
    const r = await api("/admin/api/ports/map");
    if (!r.ports.length) {
      box.innerHTML = `<span class="hint">（无单元或无端口）</span>`;
      return;
    }
    box.innerHTML = `<table style="border-collapse:collapse;font-size:12.5px">
      <tr><th style="text-align:left;padding:4px 10px">单元 \\ 端口</th>${r.ports.map((p) => `<th style="padding:4px 8px;font-family:var(--mono)">${p}</th>`).join("")}</tr>
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
  }));

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
