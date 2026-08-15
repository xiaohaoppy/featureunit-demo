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
  group: "auth-service",   // 当前服务组
  units: [],               // 单元列表（含冻结状态）
  selectedUnit: null,      // 左侧选中的单元名
  unitFiles: null,         // 选中单元的 4 文件内容
  unitFileTab: "contract", // 单元详情当前文件 tab
  aiDraft: null,           // AI 生成的草稿 {ts, md, checks, tsc}
  aiTab: "ts",             // 草稿预览 tab
  aiReviews: [],           // 10 项评审结果（true=通过 / false=打回 / null=未答）
  portDetail: null,        // 端口详情 {name, content, frozen}
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 通用：请求与消息（自动附带当前服务组）
// ---------------------------------------------------------------------------

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
// 服务组切换 / 新建
// ---------------------------------------------------------------------------

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
      fillWizardSelect();
      $("group-label").textContent = `${state.group} · 切换中…`;
    });
  } catch { /* 忽略 */ }
}

// ---------------------------------------------------------------------------
// 单元列表加载与渲染（左侧栏 + 概览卡片）
// ---------------------------------------------------------------------------

async function loadUnits() {
  try {
    const data = await api("/admin/api/units");
    state.units = data.units;
    $("group-label").textContent = `${data.group} · ${data.units.length} 个功能单元`;
    fillWizardSelect(); // 向导下拉与单元列表同步

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
// 单元详情：编辑模式（人编辑 + git 留痕）
// ---------------------------------------------------------------------------

const FROZEN_WARN = { contract: "契约（冻结区）", spec: "规格（冻结区）", test: "判据（冻结区）", impl: "实现（AI 写入区）" };

$("btn-edit-toggle").addEventListener("click", () => {
  if (!state.selectedUnit || !state.unitFiles) return;
  const editor = $("edit-editor");
  const editing = editor.style.display !== "none";
  if (editing) {
    // 退出编辑：丢弃未保存内容，回到只读视图
    editor.style.display = "none";
    $("file-content").style.display = "";
    $("btn-edit-toggle").textContent = "编辑当前文件";
    return;
  }
  $("edit-content").value = state.unitFiles[state.unitFileTab] ?? "";
  $("edit-warning-file").textContent = `：${FILE_LABELS[state.unitFileTab]}（${FROZEN_WARN[state.unitFileTab] ?? ""}）`;
  $("file-content").style.display = "none";
  editor.style.display = "block";
  $("btn-edit-toggle").textContent = "取消编辑";
});

$("btn-edit-cancel").addEventListener("click", () => {
  $("edit-editor").style.display = "none";
  $("file-content").style.display = "";
  $("btn-edit-toggle").textContent = "编辑当前文件";
});

$("btn-edit-save").addEventListener("click", async () => {
  const note = $("edit-note").value.trim();
  if (!note) {
    alert("请填写修改说明（会写进 git 提交信息）");
    return;
  }
  const btn = $("btn-edit-save");
  btn.disabled = true;
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/files`, {
      method: "PUT",
      body: JSON.stringify({ file: state.unitFileTab, content: $("edit-content").value, note }),
    });
    // 保存成功：刷新只读视图 + 更新本地状态
    state.unitFiles[state.unitFileTab] = $("edit-content").value;
    $("edit-editor").style.display = "none";
    $("file-content").style.display = "";
    $("btn-edit-toggle").textContent = "编辑当前文件";
    $("edit-note").value = "";
    $("file-content").textContent = state.unitFiles[state.unitFileTab];
    alert(r.message);
    loadUnits(); // 冻结状态可能变化
  } catch (err) {
    alert(`保存失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 单元详情：接线检查（组合根/HTTP/manifest 是否已接入）
// ---------------------------------------------------------------------------

$("btn-wiring").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  const box = $("wiring-result");
  box.style.display = "block";
  box.innerHTML = "检查中…";
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/wiring`);
    let html = `<div class="msg ${r.allOk ? "ok" : "warn"}">${r.allOk ? "✅ 已完整接线" : "⚠️ 尚未完全接线"}</div>`;
    html += `<div class="check-list">` + r.checks.map((x) => `<div class="check-row"><span class="mark">${x.ok ? "✅" : "❌"}</span><span>${escapeHtml(x.label)}</span></div>`).join("") + `</div>`;

    if (!r.allOk) {
      // 未接线 → 拉取一键接线 diff，展示"确认落盘"按钮
      try {
        const p = await api(`/admin/api/units/${state.selectedUnit}/wiring/preview`);
        if (p.alreadyWired) {
          html += `<div class="msg ok">已接线，无需改动。</div>`;
        } else if (p.files.length) {
          html += `<div class="msg warn">以下是机器生成的接线改动（<b>人审阅后点「确认接线」才落盘</b>）：</div>`;
          for (const f of p.files) {
            html += `<div style="font-weight:600;margin:8px 0 4px">${escapeHtml(f.path)}</div>`;
            html += `<pre class="code" style="max-height:300px">${escapeHtml(f.diffText)}</pre>`;
          }
          html += `<div class="row" style="margin-top:10px"><button class="btn" id="btn-wire-apply">确认接线（落盘 + git 提交）</button><input type="text" id="wire-note" placeholder="接线说明（可选）" style="flex:1" /></div>`;
        } else {
          html += `<div class="msg err">无法生成接线改动（锚点缺失），请人工编辑组合根。</div>`;
        }
      } catch (e2) {
        html += `<div class="msg err">接线预览失败：${escapeHtml(e2.message)}</div>`;
      }
    }
    box.innerHTML = html;

    // 绑定确认接线按钮
    const applyBtn = $("btn-wire-apply");
    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        applyBtn.disabled = true;
        try {
          const res = await api(`/admin/api/units/${state.selectedUnit}/wiring/apply`, {
            method: "POST",
            body: JSON.stringify({ note: ($("wire-note")?.value ?? "").trim() }),
          });
          box.innerHTML = `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`;
          await loadUnits();
        } catch (e3) {
          box.innerHTML = `<div class="msg err">${escapeHtml(e3.message)}</div>`;
        }
      });
    }
  } catch (err) {
    box.innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  }
});

// ---------------------------------------------------------------------------
// 新建功能单元（直接调 API，不再去终端）
// ---------------------------------------------------------------------------

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
// 试玩：业务冒烟（注册/登录/查我/登出/改密/改邮箱/找回密码）
// ---------------------------------------------------------------------------

/** 试玩操作清单：操作名 → { method, path, 示例请求体 } */
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

// 试玩会话 cookie（前端内存态，模拟浏览器）
let playCookie = null;

function fillPlayOps() {
  const sel = $("play-op");
  sel.innerHTML = Object.keys(PLAY_OPS).map((k) => `<option>${k}</option>`).join("");
}

$("play-op").addEventListener("change", () => {
  const op = PLAY_OPS[$("play-op").value];
  $("play-body").value = op.body ? JSON.stringify(op.body, null, 2) : "";
  $("play-output").textContent = "填写请求体后点击「发送」。";
});

$("btn-play-send").addEventListener("click", async () => {
  const op = PLAY_OPS[$("play-op").value];
  let data;
  try {
    data = $("play-body").value.trim() ? JSON.parse($("play-body").value) : undefined;
  } catch {
    alert("请求体不是合法 JSON");
    return;
  }
  try {
    const r = await api("/admin/api/play", {
      method: "POST",
      body: JSON.stringify({ method: op.method, path: op.path, data, cookie: playCookie ?? undefined }),
    });
    $("play-output").textContent = `HTTP ${r.status}\n${r.body}`;
    // 显示当前存储模式（配置面板切换后自动跟随）
    $("play-storage").textContent = `存储模式：${r.storageMode ?? "memory"}（「配置」面板可切换，保存后本面板自动生效）`;
    // 登录/登出/改密/改邮箱会设置或清除 cookie——模拟浏览器行为
    if (r.setCookie) {
      const m = /sid=([^;]+)/.exec(r.setCookie);
      playCookie = m ? `sid=${m[1]}` : playCookie;
      $("play-cookie").textContent = `会话 cookie：${playCookie}`;
    }
    if (op.path === "/api/logout" || op.path === "/api/change-password" || op.path === "/api/change-email" || op.path === "/api/password-reset") {
      playCookie = null;
      $("play-cookie").textContent = "会话 cookie：无（该操作已使会话失效）";
    }
  } catch (err) {
    $("play-output").textContent = `请求失败：${err.message}`;
  }
});

$("btn-play-clear").addEventListener("click", () => {
  playCookie = null;
  $("play-cookie").textContent = "会话 cookie：无";
});

// ---------------------------------------------------------------------------
// 配置管理（密钥打码 / 显示切换 / 保存到本地文件）
// ---------------------------------------------------------------------------

/** 当前配置表单状态（key → 输入框元素）。 */
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

      // 有固定选项的配置项（如存储模式）渲染为下拉选择；其余为文本框
      let control;
      if (Array.isArray(item.options) && item.options.length) {
        const sel = document.createElement("select");
        sel.style.cssText = "flex:1.2;font-family:var(--mono)";
        sel.innerHTML = item.options
          .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}${o === item.fallback ? "（默认）" : ""}</option>`)
          .join("");
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

$("btn-config-save").addEventListener("click", async () => {
  const values = {};
  for (const [key, input] of Object.entries(configInputs)) {
    values[key] = input.value.trim(); // 空字符串 = 删除该 key
  }
  try {
    const r = await api("/admin/api/config", { method: "PUT", body: JSON.stringify({ values }) });
    $("config-msg").innerHTML = `<div class="msg ok">✅ 已保存到本地配置文件（不进入 git）</div>`;
    // 重新加载面板（显示新来源标注）
    await loadConfigPanel();
  } catch (err) {
    $("config-msg").innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  }
});

// ---------------------------------------------------------------------------
// 单元详情：AI 生成判据 / 冻结判据 / AI 实现（自动迭代）
// ---------------------------------------------------------------------------

function aiWorkOut(text) {
  const box = $("ai-work-output");
  box.style.display = "block";
  box.textContent = text;
}

$("btn-judge").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  // 已冻结的判据会被后端拒绝——前端提前确认，避免困惑
  const current = state.unitFiles?.test ?? "";
  if (current.includes("冻结记录")) {
    alert("该单元判据已冻结——不允许被 AI 生成覆盖（纪律守卫）。如需修改请走契约演进流程。");
    return;
  }
  const btn = $("btn-judge");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/judge`, {
      method: "POST", body: JSON.stringify({ mock: true }),
    });
    aiWorkOut(`判据草稿已生成（${r.invariants.length} 条不变量 → 对应测试骨架）\n\n请切到 impl.test.ts 查看，逐条补全断言后点「确认判据（冻结）」。`);
    // 刷新单元详情，切到 test 文件
    const data = await api(`/admin/api/units/${state.selectedUnit}`);
    state.unitFiles = data.files;
    state.unitFileTab = "test";
    renderUnitDetail();
  } catch (err) {
    aiWorkOut(`生成失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "AI 生成判据";
  }
});

$("btn-judge-freeze").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/judge/freeze`, {
      method: "POST", body: JSON.stringify({}),
    });
    aiWorkOut(`✅ ${r.message}`);
    await loadUnits();
  } catch (err) {
    aiWorkOut(`冻结失败：${err.message}`);
  }
});

$("btn-implement").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  const btn = $("btn-implement");
  btn.disabled = true;
  btn.textContent = "实现中（自动迭代）…";
  aiWorkOut("内置实现器启动：读契约+判据 → 生成 impl.ts → 跑判据 → 红则重试…\n");
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/implement`, {
      method: "POST", body: JSON.stringify({ mock: true, maxRounds: 5 }),
    });
    const lines = r.rounds.map((x) => `第 ${x.round} 轮 → ${x.ok ? "✅ 判据全绿" : "❌ 判据红：" + x.summary}`).join("\n");
    aiWorkOut(`${lines}\n\n${r.ok ? "✅ " : "⚠️ "}${r.message}`);
    if (r.ok) {
      const data = await api(`/admin/api/units/${state.selectedUnit}`);
      state.unitFiles = data.files;
      renderUnitDetail();
      await loadUnits();
    }
  } catch (err) {
    aiWorkOut(`实现失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "AI 实现（自动迭代）";
  }
});

// ---------------------------------------------------------------------------
// 向导：端到端进度
// ---------------------------------------------------------------------------

function fillWizardSelect() {
  const sel = $("wizard-unit");
  const prev = sel.value;
  sel.innerHTML = state.units.map((u) => `<option>${u.name}</option>`).join("");
  if (prev && state.units.some((u) => u.name === prev)) sel.value = prev;
  else if (state.units.length) sel.value = state.units[0].name;
}

$("btn-wizard-load").addEventListener("click", loadWizard);
$("wizard-unit").addEventListener("dblclick", loadWizard);

async function loadWizard() {
  const name = $("wizard-unit").value;
  if (!name) return;
  const body = $("wizard-body");
  body.innerHTML = "加载中…";
  try {
    const r = await api(`/admin/api/units/${name}/status`);
    body.innerHTML = `
      <div class="msg ${r.stepsDone === r.stepsTotal ? "ok" : "warn"}">
        进度 ${r.stepsDone}/${r.stepsTotal}${r.stepsDone === r.stepsTotal ? " ✅ 可上线" : "（按顺序完成下一步）"}
      </div>` +
      r.steps.map((s, i) => `
        <div class="review-item">
          <span class="idx">${String(i + 1).padStart(2)}/5</span>
          <span class="text">${s.done ? "✅" : "⬜"} ${escapeHtml(s.label)} — <span class="hint">${escapeHtml(s.hint)}</span></span>
        </div>`).join("");
  } catch (err) {
    body.innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// 端口依赖矩阵（单元 → 端口）
// ---------------------------------------------------------------------------

async function loadPortMatrix() {
  const box = $("ports-matrix");
  try {
    const r = await api("/admin/api/ports/map");
    if (!r.ports.length) {
      box.innerHTML = `<span class="hint">（无单元或无端口）</span>`;
      return;
    }
    // 表格：行 = 单元，列 = 端口，● = 依赖
    let html = `<table style="border-collapse:collapse;font-size:12.5px">
      <tr><th style="text-align:left;padding:4px 10px">单元 \\ 端口</th>${r.ports.map((p) => `<th style="padding:4px 8px;font-family:var(--mono)">${p}</th>`).join("")}</tr>`;
    for (const u of r.units) {
      html += `<tr><td style="padding:4px 10px;font-family:var(--mono)">${u.name}</td>` +
        r.ports.map((p) => `<td style="text-align:center;padding:4px 8px">${u.ports.includes(p) ? "●" : ""}</td>`).join("") + `</tr>`;
    }
    html += `</table>`;
    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = `<span class="msg err">${escapeHtml(err.message)}</span>`;
  }
}

// ---------------------------------------------------------------------------
// 提交历史 / 回滚
// ---------------------------------------------------------------------------

$("btn-history").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  const box = $("history-result");
  box.style.display = "block";
  box.innerHTML = "加载中…";
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/history`);
    if (!r.commits.length) {
      box.innerHTML = `<div class="msg warn">该单元还没有提交历史（先完成契约冻结/判据/实现）。</div>`;
      return;
    }
    box.innerHTML = `<div class="msg warn">该单元最近提交（点击回滚 = git revert，历史保留可追溯）：</div>` +
      `<div class="check-list">` +
      r.commits.map((c) => `<div class="review-item">
          <span class="idx">${c.hash.slice(0, 7)}</span>
          <span class="text">${escapeHtml(c.subject)}</span>
          <button class="btn ghost" style="padding:3px 10px" data-hash="${c.hash}">回滚</button>
        </div>`).join("") + `</div>`;
    box.querySelectorAll("[data-hash]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`确认回滚提交 ${btn.dataset.hash.slice(0, 7)}？将生成一次反向提交。`)) return;
        btn.disabled = true;
        try {
          const res = await api(`/admin/api/units/${state.selectedUnit}/rollback`, {
            method: "POST",
            body: JSON.stringify({ commit: btn.dataset.hash }),
          });
          box.innerHTML = `<div class="msg ${res.ok ? "ok" : "err"}">${escapeHtml(res.message)}</div>`;
          await loadUnits();
        } catch (err) {
          box.innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  }
});

// ---------------------------------------------------------------------------
// 错误码一致性检查（spec 声明 vs impl 抛出 vs errors.ts 定义）
// ---------------------------------------------------------------------------

$("btn-errorcodes").addEventListener("click", async () => {
  if (!state.selectedUnit) return;
  const box = $("errorcodes-result");
  box.style.display = "block";
  box.innerHTML = "检查中…";
  try {
    const r = await api(`/admin/api/units/${state.selectedUnit}/errorcodes`);
    const html = r.ok
      ? `<div class="msg ok">✅ 一致：spec 声明 ${r.declaredInSpec.length} 个错误码，impl 全部覆盖，且都已在 ports/errors.ts 定义。</div>`
      : `<div class="msg err">⚠️ 发现 ${r.problems.length} 处不一致：</div>` +
        `<div class="check-list">` + r.problems.map((p) => `<div class="check-row"><span class="mark">⚠️</span><span>${escapeHtml(p)}</span></div>`).join("") + `</div>`;
    box.innerHTML = html + `<div class="hint" style="margin-top:6px">spec 声明：${r.declaredInSpec.join(", ") || "（无）"} ｜ impl 抛出：${r.thrownInImpl.join(", ") || "（无）"}</div>`;
  } catch (err) {
    box.innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  }
});

// ---------------------------------------------------------------------------
// 端口统一管理（列表/详情/新建）
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
        <div class="badges">
          <span class="badge mute">📌 依赖 ${p.usedBy.length} 单元</span>
          <span class="badge mute">🔧 适配器 ${p.adapters.length}</span>
        </div>
        <div class="hint" style="margin-top:6px">${p.usedBy.map((u) => `<code>${escapeHtml(u)}</code>`).join(" ")}</div>`;
      card.addEventListener("click", async () => {
        $("port-detail-card").style.display = "block";
        $("port-edit-editor").style.display = "none";
        $("port-detail-content").style.display = "";
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

$("btn-port-create").addEventListener("click", async () => {
  const name = $("port-new-name").value.trim();
  const description = $("port-new-desc").value.trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    $("port-msg").innerHTML = `<div class="msg err">端口名只允许小写字母/数字/连字符</div>`;
    return;
  }
  try {
    const r = await api("/admin/api/ports", { method: "POST", body: JSON.stringify({ name, description }) });
    $("port-msg").innerHTML = `<div class="msg ok">✅ 已创建端口 ${r.interfaceName}（冻结区模板，请人工填写接口方法）</div>`;
    $("port-new-name").value = "";
    $("port-new-desc").value = "";
    await loadPorts();
  } catch (err) {
    $("port-msg").innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  }
});

// AI 生成端口草稿（Agent-D）→ 机器初审 → 人确认冻结
let portAiState = null;

$("btn-port-ai").addEventListener("click", async () => {
  const name = $("port-new-name").value.trim();
  const description = $("port-new-desc").value.trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    $("port-msg").innerHTML = `<div class="msg err">请先填写端口名（kebab-case）</div>`;
    return;
  }
  const btn = $("btn-port-ai");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    const r = await api("/admin/api/ports/generate", {
      method: "POST",
      body: JSON.stringify({ name, description, mock: $("port-ai-mock").checked }),
    });
    portAiState = r;
    $("port-ai-card").style.display = "block";
    $("port-ai-checks").innerHTML = r.checks
      .map((c) => `<div class="check-row"><span class="mark">${c.ok ? "✅" : "⚠️"}</span><span>${escapeHtml(c.label)}</span></div>`)
      .join("");
    $("port-ai-content").textContent = r.content;
    $("port-ai-hint").textContent = r.machineOk
      ? "机器初审全部通过——请人审阅后确认冻结。"
      : "机器初审发现纪律问题——请审阅并修正后确认（或打回人工编辑）。";
  } catch (err) {
    $("port-msg").innerHTML = `<div class="msg err">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 AI 生成（Agent-D）";
  }
});

$("btn-port-freeze").addEventListener("click", async () => {
  if (!portAiState) return;
  const btn = $("btn-port-freeze");
  btn.disabled = true;
  try {
    const r = await api(`/admin/api/ports/${portAiState.name}/freeze`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    $("port-ai-hint").textContent = `✅ ${r.message}`;
    $("port-ai-card").style.display = "none";
    portAiState = null;
    await loadPorts();
  } catch (err) {
    $("port-ai-hint").textContent = `冻结失败：${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// 端口编辑（人编辑 + git 留痕）
$("btn-port-edit").addEventListener("click", () => {
  if (!state.portDetail) return;
  $("port-edit-content").value = state.portDetail.content;
  $("port-edit-note").value = "";
  $("port-detail-content").style.display = "none";
  $("port-edit-editor").style.display = "block";
});

$("btn-port-edit-cancel").addEventListener("click", () => {
  $("port-edit-editor").style.display = "none";
  $("port-detail-content").style.display = "";
});

$("btn-port-edit-save").addEventListener("click", async () => {
  const note = $("port-edit-note").value.trim();
  if (!note) {
    alert("请填写修改说明（会写进 git 提交信息）");
    return;
  }
  const btn = $("btn-port-edit-save");
  btn.disabled = true;
  try {
    const r = await api(`/admin/api/ports/${state.portDetail.name}`, {
      method: "PUT",
      body: JSON.stringify({ content: $("port-edit-content").value, note }),
    });
    state.portDetail.content = $("port-edit-content").value;
    $("port-edit-editor").style.display = "none";
    $("port-detail-content").style.display = "";
    $("port-detail-content").textContent = state.portDetail.content;
    alert(r.message);
    await loadPorts(); // 刷新描述（可能变了）
  } catch (err) {
    alert(`保存失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

$("btn-refresh").addEventListener("click", () => {
  loadUnits();
  loadPortMatrix();
  loadPorts();
});

loadGroups();
fillPlayOps();
fillWizardSelect();
loadUnits();
loadSourceList();
loadPortMatrix();
loadPorts();
loadConfigPanel();
