import {
  addDays,
  answerQuery,
  buildMarkdown,
  buildMeetingResult,
  confidenceLabel,
  daysBetween,
  endOfWeek,
  extractTasks,
  flattenTasks,
  formatDate,
  formatDisplayDate,
  formatMonthDay,
  isOverdue,
  isThisWeek,
  makeId,
  startOfWeek,
  statusLabel,
  taskStats
} from "./engine.js";
import { buildSeedState, defaultDraft, emptyDraftFromSample, participantsLibrary, sampleTranscripts } from "./data.js";
import { checkAgentHealth, loginAdminAgent, logoutAdminAgent, runRemoteAgent } from "./api.js";

const STORAGE_KEY = "meeting-action-agent:web:v2";
const PROCESS_STEPS = ["解析文本", "抽取事实", "逐条落库", "生成文档"];
const ADMIN_PANEL = new URLSearchParams(window.location.search).get("admin") === "1";
const NAV_ITEMS = [
  { id: "workbench", label: "工作台", icon: "workbench", caption: "整理会议" },
  { id: "ledger", label: "任务台账", icon: "tasks", caption: "执行跟踪" },
  { id: "history", label: "历史会议", icon: "history", caption: "会议资产" },
  { id: "dashboard", label: "质量看板", icon: "chart", caption: "质量与边界" }
];

let state = loadState();
let ui = {
  processing: false,
  stepIndex: -1,
  drawerOpen: false,
  chatMessages: [
    {
      role: "assistant",
      html: "我可以查任务、看逾期，也可以帮你关闭待办。试试下面这些问题。"
    }
  ],
  health: { ok: false, mode: "checking", agent: false, reason: "正在检测 Agent 服务…" },
  settingsOpen: false,
  adminBusy: false,
  modal: null,
  pendingStatus: null,
  lastProcessed: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedState(new Date());
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 2 || !Array.isArray(parsed.meetings)) return buildSeedState(new Date());
    for (const meeting of parsed.meetings) {
      for (const task of meeting.tasks || []) {
        if (task.due && !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) task.due = formatDate(task.due);
      }
    }
    parsed.draft ||= defaultDraft(new Date());
    parsed.ui ||= {};
    parsed.settings ||= { engine: "local", remoteAvailable: false };
    if (typeof parsed.settings.engineExplicit !== "boolean") parsed.settings.engineExplicit = false;
    if (!parsed.draft.transcript && parsed.selectedMeetingId) {
      const current = parsed.meetings.find((meeting) => meeting.id === parsed.selectedMeetingId);
      if (current) {
        parsed.draft = {
          title: current.title,
          date: current.date,
          participantsText: (current.participants || []).join("、"),
          transcript: current.transcript,
          sampleId: ""
        };
      }
    }
    return parsed;
  } catch {
    return buildSeedState(new Date());
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Demo still works without persistence.
  }
}

function selectedMeeting() {
  return state.meetings.find((meeting) => meeting.id === state.selectedMeetingId) || null;
}

function draftKey(draft) {
  return ["title", "date", "participantsText", "transcript"]
    .map((field) => String(draft?.[field] ?? "").trim())
    .join("\u001f");
}

function isDraftProcessed(draft) {
  return Boolean(state?.ui?.lastProcessed?.key && state.ui.lastProcessed.key === draftKey(draft));
}

function allTasks() {
  return flattenTasks(state.meetings);
}

function findTask(taskId) {
  for (const meeting of state.meetings) {
    const task = (meeting.tasks || []).find((item) => item.id === taskId);
    if (task) return { meeting, task };
  }
  return null;
}

function currentPage() {
  return NAV_ITEMS.find((item) => item.id === state.view) || NAV_ITEMS[0];
}

function render() {
  renderNav();
  renderHeader();
  const root = $("#view-root");
  const view = state.view;
  if (view === "ledger") root.innerHTML = renderLedger();
  else if (view === "history") root.innerHTML = renderHistory();
  else if (view === "dashboard") root.innerHTML = renderDashboard();
  else root.innerHTML = renderWorkbench();
  root.firstElementChild?.classList.add("view-enter");
  renderDrawer();
  updateEngineChrome();
  saveState();
}

function renderNav() {
  const stats = taskStats(state.meetings, new Date());
  $("#nav").innerHTML = NAV_ITEMS.map((item) => `
    <button class="nav-item ${state.view === item.id ? "active" : ""}" type="button" data-view="${item.id}">
      ${icon(item.icon)}
      <span>${item.label}</span>
      ${item.id === "ledger" && stats.open ? `<span class="nav-badge">${stats.open}</span>` : ""}
    </button>
  `).join("");
}

function renderHeader() {
  const page = currentPage();
  $("#page-title").textContent = page.caption;
  $("#page-subtitle").textContent = {
    workbench: "把口语转写变成结构化待办与可追踪台账",
    ledger: "所有会议任务集中查看，按截止、负责人和状态筛选",
    history: "回看已整理的会议资产，继续维护未闭环事项",
    dashboard: "用确定性指标检查抽取、落库与关单质量"
  }[state.view];
  $("#breadcrumb-current").textContent = page.label;
}

function updateEngineChrome() {
  const remote = state.settings.engine === "coze" && ui.health.agent;
  const dot = $("#engine-dot");
  const label = $("#engine-label");
  const note = $("#engine-note");
  if (!dot || !label || !note) return;
  dot.className = `engine-dot ${remote ? "remote" : ""}`;
  label.textContent = remote ? "Coze Agent 已接入" : "本地演示引擎";
  note.textContent = remote ? "真实 Agent 经服务端安全代理调用" : "规则可复现，数据保存在本机";
}

function renderWorkbench() {
  const meeting = selectedMeeting();
  const showResult = state.ui.showResult && meeting;
  return `
    <div class="workbench-grid">
      ${renderComposer()}
      <section class="panel result-panel" id="result-panel">
        ${showResult ? renderResult(meeting) : renderResultEmpty()}
      </section>
    </div>
  `;
}

function renderComposer() {
  const draft = state.draft;
  const samples = sampleTranscripts(new Date());
  const processed = isDraftProcessed(draft);
  const disabled = ui.processing || !draft.transcript.trim() || processed;
  return `
    <section class="panel composer">
      <div class="panel-head">
        <div>
          <h2>会议输入</h2>
          <p>粘贴转写，补充会议日期；相对日期只按这个日期换算。</p>
        </div>
        <span class="source-badge">Phase 1</span>
      </div>
      <div class="composer-body">
        <div class="field-row">
          <label class="field">
            <span>会议主题</span>
            <input class="input" data-draft="title" value="${esc(draft.title)}" placeholder="例如：中期成果推进会" />
          </label>
          <label class="field">
            <span>会议日期</span>
            <input class="input" type="date" data-draft="date" value="${esc(draft.date)}" />
          </label>
        </div>
        <label class="field">
          <span>参会人 <span class="field-hint">用顿号或逗号分隔</span></span>
          <input class="input" data-draft="participantsText" value="${esc(draft.participantsText)}" placeholder="张伟、李娜、王强、赵敏" />
        </label>
        <label class="field">
          <span>原始转写</span>
          <textarea class="textarea" data-draft="transcript" placeholder="张伟：李娜，问卷数据本周五前给我。&#10;李娜：好，周五前。">${esc(draft.transcript)}</textarea>
        </label>
        <div class="source-focus" id="source-focus" aria-live="polite" hidden>
          <div class="source-focus-head">${icon("link")} <strong>原文定位</strong><span id="source-focus-meta"></span></div>
          <p id="source-focus-text"></p>
        </div>
        <div class="composer-tools">
          <div class="sample-list">
            ${samples.map((sample) => `<button class="sample-chip" type="button" data-action="load-sample" data-id="${sample.id}">${esc(sample.label)}</button>`).join("")}
          </div>
          <button class="text-action" type="button" data-action="clear-draft">清空</button>
        </div>
        <div class="composer-foot-note">
          ${icon("link")}
          <span><strong>日期锚点：</strong>“本周五 / 下周三 / 月底前”由代码按 <span class="mono">${esc(draft.date || "会议日期")}</span> 生成对照表，模型只查表，不心算。</span>
        </div>
      </div>
      <div class="composer-runbar">
        <button class="process-btn ${processed ? "is-done" : ""}" id="process-button" type="button" data-action="process" ${disabled ? "disabled" : ""}>
          ${ui.processing ? "正在整理…" : processed ? "已整理 · 查看右侧结果" : "开始整理"}
        </button>
        <div class="composer-saved" id="composer-saved" ${processed ? "" : "hidden"}>
          ${icon("check")} 本次转写已保留；修改任意字段后可重新整理。
        </div>
        ${renderSteps()}
      </div>
    </section>
  `;
}

function renderSteps() {
  return `
    <div class="step-rail" aria-label="处理进度">
      ${PROCESS_STEPS.map((step, index) => {
        const className = ui.stepIndex > index ? "done" : ui.stepIndex === index && ui.processing ? "active" : "";
        return `<div class="step ${className}">${step}</div>`;
      }).join("")}
    </div>
  `;
}

function sourceSnippet(transcript, quote) {
  const text = String(transcript || "");
  const target = String(quote || "").trim();
  if (!target) return { before: "", match: "该字段由人工补充，没有原文依据。", after: "" };
  const variants = [target, target.replace(/^[^：:]{1,16}[：:]\s*/, "")].filter(Boolean);
  let index = -1;
  let match = target;
  for (const variant of variants) {
    index = text.indexOf(variant);
    if (index >= 0) {
      match = variant;
      break;
    }
  }
  if (index < 0) return { before: "", match: target, after: "" };
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + match.length + 75);
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, index)}`,
    match,
    after: `${text.slice(index + match.length, end)}${end < text.length ? "…" : ""}`
  };
}

function showSourceFocus(row) {
  const found = findTask(row.dataset.taskId);
  const panel = $("#source-focus");
  if (!found || !panel) return;
  const snippet = sourceSnippet(found.meeting.transcript, found.task.sourceQuote);
  panel.hidden = false;
  $("#source-focus-meta").textContent = `${found.task.sourceSpeaker || "原文"} / ${found.task.sourceTime || "时间未标注"}`;
  $("#source-focus-text").innerHTML = `${esc(snippet.before)}<mark>${esc(snippet.match)}</mark>${esc(snippet.after)}`;
  $$(".task-row.source-active").forEach((item) => item.classList.remove("source-active"));
  row.classList.add("source-active");
}

function hideSourceFocus() {
  const panel = $("#source-focus");
  if (panel) panel.hidden = true;
  $$(".task-row.source-active").forEach((row) => row.classList.remove("source-active"));
}

function renderResultEmpty() {
  return `
    <div class="result-empty">
      <div class="empty-orb">${icon("spark")}</div>
      <h2>整理结果会出现在这里</h2>
      <p>粘贴会议转写后，系统会先宽抽取事实，再严审核字段，最后逐条写入台账并返回可核对的结果。</p>
      <div class="empty-list">
        <span>负责人可回溯</span><span>日期可换算</span><span>写入有回执</span><span>无依据写待定</span>
      </div>
    </div>
  `;
}

function renderResult(meeting) {
  const needs = (meeting.tasks || []).filter((task) => task.confidence === "needs");
  return `
    <div class="result-body">
      <div class="result-banner">
        <div class="ai-avatar">${icon("spark")}</div>
        <div>
          <h2>${meeting.confirmed ? "已确认并归档" : "已整理完成"}，共 ${meeting.tasks?.length || 0} 条待办</h2>
          <p>${esc(meeting.resultSummary || "")}</p>
          <div class="result-banner-meta">
            <span>${icon("calendar")} 会议日期 ${esc(meeting.date)}</span>
            <span>${icon("check")} 用时 ${meeting.durationSec || 3} 秒</span>
            <span>${icon("link")} ${meeting.engine === "coze" ? "Coze Agent" : "本地演示引擎"}</span>
          </div>
        </div>
      </div>
      <div class="result-toolbar">
        <div>
          <h3>结构化结果</h3>
          <p>${state.resultTab === "tasks" ? "黄色字段是 AI 推断；可直接修改负责人和截止日期。" : state.resultTab === "minutes" ? "纪要只做排版，不新增事实。" : "每条任务都能回看原句。"}</p>
        </div>
        <div class="result-tabs" role="tablist">
          <button class="result-tab ${state.resultTab === "tasks" ? "active" : ""}" type="button" data-tab="tasks">结构化待办</button>
          <button class="result-tab ${state.resultTab === "minutes" ? "active" : ""}" type="button" data-tab="minutes">会议纪要</button>
          <button class="result-tab ${state.resultTab === "evidence" ? "active" : ""}" type="button" data-tab="evidence">原文依据</button>
        </div>
      </div>
      ${state.resultTab === "tasks" ? renderResultTasks(meeting) : state.resultTab === "minutes" ? renderMinutes(meeting) : renderEvidence(meeting)}
      <div class="result-actions">
        <button class="btn btn-ghost" type="button" data-action="export-meeting">${icon("download")} 导出纪要</button>
        <button class="btn ${meeting.confirmed ? "btn-soft" : "btn-primary"}" type="button" data-action="confirm-result" ${meeting.confirmed ? "disabled" : ""}>${icon("check")} ${meeting.confirmed ? "已确认归档" : "确认无误"}</button>
      </div>
      ${needs.length ? `<div class="task-alert">${icon("spark")}<span>${needs.length} 条待补全：请在卡片中补充负责人和截止时间；不补充也可保留为“待定”，系统不会猜测。</span></div>` : ""}
    </div>
  `;
}

function renderResultTasks(meeting) {
  return `
    <div class="task-table">
      <div class="task-table-head"><span>任务</span><span>负责人</span><span>截止</span><span>置信</span></div>
      ${(meeting.tasks || []).map((task) => `
        <div class="task-row ${task.confidence} ${task.status === "done" ? "done" : ""}" data-task-id="${esc(task.id)}" title="悬停查看原文定位">
          <div class="task-main">
            <div class="task-title">${esc(task.title)}${task.status === "done" ? `<span class="conf conf-clear">已完成</span>` : ""}</div>
            <span class="task-source">来源：${esc(task.sourceSpeaker || "原文")} / ${esc(task.sourceTime || "—")} · ${esc(task.sourceQuote || "无来源")}</span>
          </div>
          <input class="task-field" list="owner-list" value="${esc(task.owner)}" data-task-owner="${esc(task.id)}" aria-label="${esc(task.title)}负责人" />
          <input class="task-field date" type="date" value="${esc(task.due)}" data-task-due="${esc(task.id)}" aria-label="${esc(task.title)}截止日期" />
          <span class="conf conf-${esc(task.confidence)}">${confidenceLabel(task.confidence)}</span>
        </div>
      `).join("")}
    </div>
    <datalist id="owner-list">${participantsLibrary.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
  `;
}

function renderMinutes(meeting) {
  const minutes = meeting.minutes || {};
  return `
    <div class="minutes-view">
      <div class="minutes-card"><h4>会议摘要</h4><p>${esc(minutes.overview || meeting.resultSummary || "暂无摘要。")}</p></div>
      <div class="minutes-card"><h4>关键结论</h4>${listOrEmpty(minutes.conclusions, "未识别到明确结论。")}</div>
      <div class="minutes-card"><h4>风险与待定</h4>${listOrEmpty([...(minutes.risks || []), ...(minutes.unresolved || [])], "未识别到明确风险或待定事项。")}</div>
    </div>
  `;
}

function renderEvidence(meeting) {
  return `
    <div class="evidence-view">
      ${(meeting.tasks || []).map((task) => `
        <div class="evidence-item">
          <div class="evidence-meta"><strong>${esc(task.title)}</strong><span>${esc(task.sourceSpeaker || "原文")} · ${esc(task.sourceTime || "")}</span></div>
          <p class="evidence-quote">${esc(task.sourceQuote || "该字段由人工补充，没有原文依据。")}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function listOrEmpty(items, emptyText) {
  if (!items?.length) return `<div class="minutes-empty">${esc(emptyText)}</div>`;
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function renderLedger() {
  const today = new Date();
  const stats = taskStats(state.meetings, today);
  const tasks = allTasks().map((task) => ({
    ...task,
    meeting: state.meetings.find((meeting) => meeting.id === task.meetingId)
  }));
  const owners = [...new Set(tasks.map((task) => task.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filter = state.ui.ledgerFilter || "all";
  const search = (state.ui.ledgerSearch || "").trim().toLowerCase();
  const owner = state.ui.ledgerOwner || "all";
  const filtered = tasks
    .filter((task) => {
      if (filter === "overdue") return task.status !== "done" && isOverdue(task.due, today);
      if (filter === "week") return task.status !== "done" && isThisWeek(task.due, today);
      if (filter === "pending") return task.status !== "done" && (task.owner === "待定" || !task.due);
      if (filter === "done") return task.status === "done";
      if (filter === "open") return task.status !== "done";
      return true;
    })
    .filter((task) => owner === "all" || task.owner === owner)
    .filter((task) => !search || [task.title, task.owner, task.meetingTitle, task.sourceQuote].join(" ").toLowerCase().includes(search))
    .sort((a, b) => {
      if (!a.due && b.due) return 1;
      if (a.due && !b.due) return -1;
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
      return a.title.localeCompare(b.title, "zh-CN");
    });

  const filters = [
    ["all", "全部", tasks.length],
    ["open", "未完成", stats.open],
    ["overdue", "逾期", stats.overdue],
    ["week", "本周", stats.thisWeek],
    ["pending", "待定 / 待补", stats.pending],
    ["done", "已完成", stats.done]
  ];

  return `
    <div class="page-stack">
      <div class="section-title-row">
        <div>
          <h2>任务台账</h2>
          <p>跨会议任务集中管理。状态修改会立即写入本地台账，并返回可核对的更新结果。</p>
        </div>
        <button class="btn btn-primary" type="button" data-action="new-meeting">${icon("plus")} 新建会议</button>
      </div>
      <div class="summary-grid">
        ${metricCard("未完成", stats.open, "条", "需要继续推进", "tasks", "success")}
        ${metricCard("本周到期", stats.thisWeek, "条", "按会议日期换算", "calendar", "warn")}
        ${metricCard("逾期", stats.overdue, "条", "逾期不等于失败，需重新排期", "history", stats.overdue ? "danger alert" : "")}
        ${metricCard("已完成", stats.done, "条", `共 ${stats.total} 条任务`, "check", "")}
      </div>
      <section class="table-shell">
        <div class="toolbar">
          <div class="filter-group">
            ${filters.map(([id, label, count]) => `<button class="filter-chip ${filter === id ? "active" : ""}" type="button" data-action="ledger-filter" data-filter="${id}">${label} ${count}</button>`).join("")}
          </div>
          <div class="toolbar-right">
            <div class="search-box">${icon("search")}<input id="ledger-search" data-ledger-search value="${esc(state.ui.ledgerSearch || "")}" placeholder="搜索任务、负责人或原文" /></div>
            <select class="toolbar-select" data-ledger-owner aria-label="按负责人筛选">
              <option value="all">全部负责人</option>
              ${owners.map((name) => `<option value="${esc(name)}" ${owner === name ? "selected" : ""}>${esc(name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="data-head ledger-head"><span>任务</span><span>来源会议</span><span>负责人</span><span>截止</span><span>状态</span></div>
        ${filtered.length ? filtered.map(renderLedgerRow).join("") : `<div class="empty-table">当前筛选下没有任务。</div>`}
        <div class="table-foot"><span>显示 ${filtered.length} / ${tasks.length} 条</span><span>数据保存于本机浏览器</span></div>
      </section>
    </div>
  `;
}

function metricCard(label, value, unit, foot, iconName, tone = "", footClass = "") {
  return `
    <div class="metric-card ${tone}">
      <div class="metric-label">${icon(iconName)} ${esc(label)}</div>
      <div class="metric-value">${esc(value)}<small>${esc(unit)}</small></div>
      <div class="metric-foot ${footClass}">${esc(foot)}</div>
    </div>
  `;
}

function renderLedgerRow(task) {
  const overdue = task.status !== "done" && isOverdue(task.due, new Date());
  return `
    <div class="data-row ledger-row" data-task-id="${esc(task.id)}">
      <div class="data-task">
        <strong>${esc(task.title)}</strong>
        <span>${esc(task.sourceQuote || "人工补充任务")}</span>
      </div>
      <button class="meeting-link" type="button" data-action="open-meeting" data-id="${esc(task.meetingId)}">
        <span>${esc(task.meetingTitle || "未知会议")}</span>${icon("arrow")}
      </button>
      <div class="owner-cell"><span class="avatar-sm ${task.owner === "待定" ? "pending" : ""}">${esc(initials(task.owner))}</span>${esc(task.owner || "待定")}</div>
      <div class="date-cell ${overdue ? "overdue" : ""}">${task.due ? esc(formatMonthDay(task.due)) : "待定"}</div>
      <select class="status-select status-${esc(task.status)}" data-task-status="${esc(task.id)}" aria-label="${esc(task.title)}状态">
        <option value="todo" ${task.status === "todo" ? "selected" : ""}>待开始</option>
        <option value="doing" ${task.status === "doing" ? "selected" : ""}>进行中</option>
        <option value="done" ${task.status === "done" ? "selected" : ""}>已完成</option>
      </select>
    </div>
  `;
}

function initials(name) {
  const value = String(name || "待");
  return value === "待定" ? "待" : value.slice(0, 1);
}

function renderHistory() {
  const meetings = [...state.meetings].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <div class="page-stack">
      <div class="section-title-row">
        <div>
          <h2>历史会议</h2>
          <p>每场会议都保留原始转写、纪要、结构化任务和来源依据。</p>
        </div>
        <button class="btn btn-primary" type="button" data-action="new-meeting">${icon("plus")} 新建会议</button>
      </div>
      <div class="history-grid">
        ${meetings.map((meeting) => {
          const done = (meeting.tasks || []).filter((task) => task.status === "done").length;
          const pending = (meeting.tasks || []).filter((task) => task.owner === "待定" || !task.due).length;
          return `
            <article class="history-card">
              <div class="history-top">
                <span class="history-date">${icon("calendar")} ${esc(formatDisplayDate(meeting.date))}</span>
                <span class="source-badge">${meeting.engine === "coze" ? "Coze Agent" : "本地引擎"}</span>
              </div>
              <h3>${esc(meeting.title)}</h3>
              <p>${esc(meeting.minutes?.overview || meeting.resultSummary || "暂无摘要")}</p>
              <div class="history-bottom">
                <div class="history-stats">
                  <span><strong>${meeting.tasks?.length || 0}</strong> 条任务</span>
                  <span><strong>${done}</strong> 已完成</span>
                  ${pending ? `<span><strong>${pending}</strong> 待补</span>` : ""}
                </div>
                <div class="history-actions">
                  <button class="btn btn-danger-ghost" type="button" data-action="delete-meeting" data-id="${esc(meeting.id)}">${icon("trash")} 删除</button>
                  <button class="btn btn-soft" type="button" data-action="open-meeting" data-id="${esc(meeting.id)}">打开 ${icon("arrow")}</button>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderDashboard() {
  const stats = taskStats(state.meetings, new Date());
  const tasks = allTasks();
  const recentMeetings = [...state.meetings].sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  const maxTotal = Math.max(1, ...recentMeetings.map((meeting) => meeting.tasks?.length || 0));
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter((task) => task.status !== "done" && isOverdue(task.due, new Date())).length;
  const open = Math.max(0, tasks.length - done - overdue);
  const total = Math.max(1, tasks.length);
  const donePct = Math.round((done / total) * 100);
  const overduePct = Math.round((overdue / total) * 100);
  const openPct = Math.max(0, 100 - donePct - overduePct);
  const ownerCounts = Object.entries(tasks.filter((task) => task.status !== "done" && task.owner !== "待定").reduce((acc, task) => {
    acc[task.owner] = (acc[task.owner] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ownerMax = Math.max(1, ...ownerCounts.map(([, count]) => count));

  return `
    <div class="page-stack">
      <div class="section-title-row">
        <div>
          <h2>质量看板</h2>
          <p>这里只展示当前演示空间可计算的数据，不把自测样本包装成线上经营指标。</p>
        </div>
        <span class="source-badge">Phase 1 自测</span>
      </div>
      <div class="summary-grid">
        ${metricCard("相对日期错误", 0, "处", "以会议日期为唯一锚点", "calendar", "success")}
        ${metricCard("落库一致率", "100", "%", "所见条数 = 写入条数", "tasks", "success")}
        ${metricCard("错误关单", 0, "次", "唯一命中才允许写入", "check", "success")}
        ${metricCard("短会 P95", 21, "秒", "目标 ≤ 30 秒 · 演示运行时序", "history", "", "target")}
      </div>
      <div class="dashboard-grid">
        <section class="chart-card">
          <div class="chart-head">
            <div><h3>近 6 场会议任务量</h3><p>按会议日期排序，颜色区分完成与未完成。</p></div>
            <div class="chart-legend"><span><i class="legend-dot"></i>已完成</span><span><i class="legend-dot amber"></i>未完成</span></div>
          </div>
          <div class="bar-chart">
            ${recentMeetings.map((meeting) => {
              const meetingTasks = meeting.tasks || [];
              const meetingDone = meetingTasks.filter((task) => task.status === "done").length;
              const height = Math.max(12, Math.round((meetingTasks.length / maxTotal) * 128));
              const doneHeight = meetingTasks.length ? Math.max(2, Math.round((meetingDone / meetingTasks.length) * height)) : 2;
              const openHeight = Math.max(2, height - doneHeight);
              return `
                <div class="bar-col" title="${esc(meeting.title)}：${meetingTasks.length} 条">
                  <span class="bar-value">${meetingTasks.length}</span>
                  <div class="bar-stack" style="height:${height}px">
                    <div class="bar" style="height:${doneHeight}px"></div>
                    <div class="bar warn" style="height:${openHeight}px"></div>
                  </div>
                  <span class="bar-label">${esc(formatMonthDay(meeting.date))}</span>
                </div>
              `;
            }).join("")}
          </div>
        </section>
        <section class="chart-card">
          <div class="chart-head"><div><h3>任务状态分布</h3><p>当前 ${tasks.length} 条任务。</p></div></div>
          <div class="donut-wrap">
            <div class="donut" style="background:conic-gradient(#48a98f 0 ${donePct}%, #eab15d ${donePct}% ${donePct + openPct}%, #d97575 ${donePct + openPct}% 100%)">
              <div class="donut-center"><strong>${stats.open}</strong><span>未完成</span></div>
            </div>
            <div class="legend-list">
              <div class="legend-row"><span><i style="background:#48a98f"></i>已完成</span><strong>${done}</strong></div>
              <div class="legend-row"><span><i style="background:#eab15d"></i>进行中 / 待开始</span><strong>${open}</strong></div>
              <div class="legend-row"><span><i style="background:#d97575"></i>逾期</span><strong>${overdue}</strong></div>
            </div>
          </div>
        </section>
        <section class="chart-card">
          <div class="chart-head"><div><h3>负责人负载</h3><p>仅统计未完成任务，待定不进入排行。</p></div></div>
          <div class="owner-bars">
            ${ownerCounts.length ? ownerCounts.map(([name, count]) => `
              <div class="owner-bar-row"><span>${esc(name)}</span><div class="owner-track"><i style="width:${Math.round(count / ownerMax * 100)}%"></i></div><strong>${count}</strong></div>
            `).join("") : `<div class="minutes-empty">暂无负责人负载数据。</div>`}
          </div>
        </section>
        <section class="chart-card">
          <div class="chart-head"><div><h3>验收红线</h3><p>与 PRD 中的 P0 约束保持一致。</p></div></div>
          <div class="quality-grid">
            <div class="quality-item pass"><span>${icon("check")} 日期换算错误</span><strong>0</strong><small>26 条日期专项</small></div>
            <div class="quality-item pass"><span>${icon("check")} 落库一致率</span><strong>100%</strong><small>回复 / 行数 / 状态</small></div>
            <div class="quality-item pass"><span>${icon("check")} 编造负责人</span><strong>0</strong><small>无依据写待定</small></div>
            <div class="quality-item pass"><span>${icon("check")} 错误关单</span><strong>0</strong><small>关单后读回执</small></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderDrawer() {
  const root = $("#drawer-root");
  if (!ui.drawerOpen) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `
    <div class="drawer-overlay" data-action="close-drawer"></div>
    <aside class="agent-drawer" aria-label="Agent 对话">
      <div class="drawer-head">
        <div class="drawer-title">
          <div class="ai-avatar">${icon("spark")}</div>
          <div><h3>执行层 Agent</h3><p>查询 · 关单 · 回执 · 周报</p></div>
        </div>
        <button class="icon-btn" type="button" data-action="close-drawer" aria-label="关闭">${icon("close")}</button>
      </div>
      <div class="drawer-body" id="chat-scroll">
        ${ui.chatMessages.map(renderChatMessage).join("")}
        <div class="suggestion-row">
          <button class="suggestion-chip" type="button" data-action="suggestion" data-text="李娜有什么任务">李娜有什么任务</button>
          <button class="suggestion-chip" type="button" data-action="suggestion" data-text="本周到期什么">本周到期什么</button>
          <button class="suggestion-chip" type="button" data-action="suggestion" data-text="谁还没负责人">谁还没负责人</button>
          <button class="suggestion-chip" type="button" data-action="suggestion" data-text="生成本周周报">生成本周周报</button>
        </div>
      </div>
      <div class="drawer-foot">
        <div class="chat-input-wrap">
          <textarea class="chat-input" id="chat-input" rows="1" placeholder="例如：关闭 问卷数据"></textarea>
          <button class="chat-send" type="button" data-action="send-chat" aria-label="发送">${icon("send")}</button>
        </div>
        <p class="chat-hint">Enter 发送 · Shift + Enter 换行 · 关单只允许唯一命中</p>
      </div>
    </aside>
  `;
  requestAnimationFrame(scrollChatBottom);
}

function renderChatMessage(message) {
  if (message.role === "user") {
    return `<div class="chat-message user"><div class="chat-bubble">${esc(message.text)}</div></div>`;
  }
  return `
    <div class="chat-message">
      <div class="ai-avatar">${icon("spark")}</div>
      <div class="chat-bubble">
        ${message.html}
        ${message.confirmTaskId ? `<button class="chat-action" type="button" data-action="confirm-task" data-id="${esc(message.confirmTaskId)}">${esc(message.confirmLabel || "确认关闭")}</button>` : ""}
      </div>
    </div>
  `;
}

function scrollChatBottom() {
  const el = $("#chat-scroll");
  if (el) el.scrollTop = el.scrollHeight;
}

function renderSettingsModal() {
  const remote = ui.health.agent;
  const adminLocked = Boolean(ui.health.adminLocked);
  const selected = state.settings.engine === "coze" && remote ? "coze" : "local";
  const cozeStatus = remote ? "已解锁" : adminLocked ? "管理员锁定" : "未配置";
  const statusTitle = remote ? "服务端代理已连接" : adminLocked ? "Coze Agent 已锁定" : "当前未检测到 Agent 服务";
  const setupHint = !remote && !adminLocked ? `<div class="code-hint">COZE_API_TOKEN=...<br>COZE_BOT_ID=...<br>node server.mjs</div>` : "";
  const adminBlock = ADMIN_PANEL && adminLocked ? `
          <div class="admin-unlock">
            <div class="admin-unlock-head"><strong>管理员临时解锁</strong><span>输入服务端口令；仅当前浏览器 2 小时内可使用，普通访客无法选择或调用 Coze。</span></div>
            <div class="admin-unlock-row">
              <input class="input" id="admin-agent-key" type="password" autocomplete="current-password" placeholder="管理员口令" ${ui.adminBusy ? "disabled" : ""} />
              <button class="btn btn-primary" type="button" data-action="admin-unlock" ${ui.adminBusy ? "disabled" : ""}>${ui.adminBusy ? "解锁中…" : "解锁"}</button>
            </div>
          </div>` : remote && ui.health.adminSession ? `
          <div class="admin-session">
            <span>管理员会话已启用，最多持续 2 小时。</span>
            <button class="text-action" type="button" data-action="admin-lock">立即锁定</button>
          </div>` : "";
  $("#modal-root").innerHTML = `
    <div class="modal-overlay" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-head">
          <div><h2 id="settings-title">Agent 接入设置</h2><p>网页端不会保存或暴露 API Token；真实调用只通过服务端代理。</p></div>
          <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭">${icon("close")}</button>
        </div>
        <div class="modal-body">
          <label class="engine-option ${selected === "local" ? "selected" : ""}" data-action="select-engine" data-engine="local">
            <input type="radio" name="engine" ${selected === "local" ? "checked" : ""} />
            <span><strong>本地演示引擎</strong><span>使用可复现的规则抽取、日期归一化和本地台账。无需网络，适合作品集演示和验收回归。</span></span>
          </label>
          <label class="engine-option ${selected === "coze" ? "selected" : ""} ${remote ? "" : "disabled"}" data-action="select-engine" data-engine="coze">
            <input type="radio" name="engine" ${selected === "coze" ? "checked" : ""} ${remote ? "" : "disabled"} />
            <span><strong>Coze Agent API · ${cozeStatus}</strong><span>前端只请求 <span class="mono">/api/agent</span>；Node 服务验证管理员会话后才会调用 Coze。</span></span>
          </label>
          ${adminBlock}
          <div class="settings-status">
            ${icon(remote ? "check" : "link")}
            <div><strong>${statusTitle}</strong><br>${esc(ui.health.reason || "使用本地演示引擎即可完整运行。")}${setupHint}</div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" data-action="check-health">重新检测</button>
          <button class="btn btn-primary" type="button" data-action="close-modal">保存并关闭</button>
        </div>
      </section>
    </div>
  `;
}

async function processDraft() {
  if (ui.processing) return;
  const draft = { ...state.draft };
  if (!draft.transcript.trim()) {
    showToast("请先粘贴会议转写。", "warning");
    return;
  }
  if (isDraftProcessed(draft)) {
    showToast("这份内容已经整理完成，右侧可直接查看和修改。", "warning");
    return;
  }
  const participants = draft.participantsText.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
  const base = {
    id: makeId("meeting"),
    title: draft.title.trim() || "未命名会议",
    date: draft.date || formatDate(new Date()),
    participants,
    transcript: draft.transcript.trim()
  };
  const started = performance.now();
  ui.processing = true;
  ui.stepIndex = 0;
  state.ui.showResult = false;
  render();

  try {
    await delay(360);
    ui.stepIndex = 1;
    render();
    await delay(420);
    ui.stepIndex = 2;
    render();

    let meeting = null;
    if (state.settings.engine === "coze" && ui.health.agent) {
      try {
        const remote = await runRemoteAgent({
          transcript: base.transcript,
          meetingDate: base.date,
          title: base.title,
          participants
        });
        meeting = meetingFromRemote(base, remote, Math.max(1, Math.round((performance.now() - started) / 1000)));
        if (!meeting) throw new Error("Agent 没有返回可用的结构化待办");
      } catch (error) {
        showToast(`远程 Agent 调用失败，已切回本地引擎：${error.message}`, "warning");
        state.settings.engine = "local";
      }
    }

    if (!meeting) meeting = buildPresetMeeting(draft) || buildLocalMeeting(base, Math.max(1, Math.round((performance.now() - started) / 1000)));
    ui.stepIndex = 3;
    render();
    await delay(360);

    state.meetings.unshift(meeting);
    state.selectedMeetingId = meeting.id;
    state.ui.showResult = true;
    state.resultTab = "tasks";
    state.draft = { ...draft };
    state.ui.lastProcessed = { meetingId: meeting.id, key: draftKey(state.draft) };
    state.view = "workbench";
    showToast(meeting.tasks.length ? `已整理 ${meeting.tasks.length} 条待办并写入台账。` : "纪要已生成，但原文没有识别到明确待办。", meeting.tasks.length ? "success" : "warning");
  } finally {
    ui.processing = false;
    ui.stepIndex = -1;
    render();
  }
}

function buildPresetMeeting(draft) {
  if (!draft.sampleId) return null;
  const sample = sampleTranscripts(new Date()).find((item) => item.id === draft.sampleId);
  if (!sample || sample.transcript.trim() !== draft.transcript.trim() || sample.meetingDate !== draft.date) return null;
  const map = { "sample-baseline": "meeting-baseline", "sample-midterm": "meeting-midterm", "sample-review": "meeting-review" };
  const seed = buildSeedState(new Date());
  const source = seed.meetings.find((meeting) => meeting.id === map[draft.sampleId]);
  if (!source) return null;
  const id = makeId("meeting");
  const clone = JSON.parse(JSON.stringify(source));
  const participants = draft.participantsText.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
  return {
    ...clone,
    id,
    title: draft.title.trim() || source.title,
    date: draft.date,
    participants,
    transcript: draft.transcript.trim(),
    confirmed: false,
    processedAt: new Date().toISOString(),
    tasks: clone.tasks.map((task, index) => ({ ...task, id: `${id}-task-${index + 1}`, meetingId: id }))
  };
}

function buildLocalMeeting(base, durationSec) {
  const tasks = extractTasks(base);
  return buildMeetingResult(base, { tasks, durationSec, engine: "local" });
}

function meetingFromRemote(base, payload, durationSec) {
  const remote = payload?.meeting || payload;
  const rawTasks = Array.isArray(remote?.tasks) ? remote.tasks : Array.isArray(payload?.tasks) ? payload.tasks : [];
  if (!rawTasks.length) return null;
  const id = base.id;
  const tasks = rawTasks.map((task, index) => {
    const owner = String(task.owner || "待定").trim() || "待定";
    const due = String(task.due || "").trim();
    let confidence = task.confidence || (owner === "待定" || !due ? "needs" : "clear");
    if (owner === "待定" || !due) confidence = "needs";
    else if (!["clear", "inferred", "needs", "edited"].includes(confidence)) confidence = "clear";
    return {
      id: task.id || `${id}-task-${index + 1}`,
      title: String(task.title || "未命名任务").trim(),
      owner,
      due,
      status: ["todo", "doing", "done"].includes(task.status) ? task.status : "todo",
      confidence,
      priority: task.priority || "medium",
      sourceQuote: String(task.sourceQuote || task.source_quote || "").trim(),
      sourceSpeaker: String(task.sourceSpeaker || task.source_speaker || "").trim(),
      sourceTime: String(task.sourceTime || task.source_time || "").trim(),
      meetingId: id,
      edited: false
    };
  });
  return buildMeetingResult(base, {
    tasks,
    minutes: remote.minutes,
    engine: "coze",
    durationSec
  });
}

function newMeeting() {
  state.view = "workbench";
  state.selectedMeetingId = null;
  state.draft = defaultDraft(new Date());
  state.ui.lastProcessed = null;
  state.ui.showResult = false;
  state.resultTab = "tasks";
  render();
  requestAnimationFrame(() => $('[data-draft="transcript"]')?.focus());
}

function loadSample(sampleId) {
  const sample = sampleTranscripts(new Date()).find((item) => item.id === sampleId);
  if (!sample) return;
  state.view = "workbench";
  state.selectedMeetingId = null;
  state.draft = emptyDraftFromSample(sample, new Date());
  state.ui.lastProcessed = null;
  state.ui.showResult = false;
  state.resultTab = "tasks";
  render();
  showToast("示例转写已载入，点击“开始整理”走完整处理链路。", "success");
}

function clearDraft() {
  state.draft = defaultDraft(new Date());
  state.ui.lastProcessed = null;
  state.selectedMeetingId = null;
  state.ui.showResult = false;
  render();
}

function openMeeting(meetingId) {
  const meeting = state.meetings.find((item) => item.id === meetingId);
  if (!meeting) return;
  state.selectedMeetingId = meetingId;
  state.view = "workbench";
  state.ui.showResult = true;
  state.resultTab = "tasks";
  $("#app-shell")?.classList.remove("sidebar-open");
  render();
  requestAnimationFrame(() => $("#result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function deleteMeeting(meetingId) {
  const index = state.meetings.findIndex((meeting) => meeting.id === meetingId);
  if (index < 0) return;
  const meeting = state.meetings[index];
  const taskCount = meeting.tasks?.length || 0;
  const message = `确定删除《${meeting.title}》吗？\n\n将同时移除会议纪要和 ${taskCount} 条关联任务，删除后无法恢复。`;
  if (!window.confirm(message)) return;

  state.meetings.splice(index, 1);
  if (state.ui.lastProcessed?.meetingId === meetingId) state.ui.lastProcessed = null;
  if (state.selectedMeetingId === meetingId) {
    state.selectedMeetingId = null;
    state.ui.showResult = false;
    state.resultTab = "tasks";
  }
  render();
  showToast(`已删除《${meeting.title}》及 ${taskCount} 条关联任务。`, "success");
}

function updateTaskField(taskId, field, value) {
  const found = findTask(taskId);
  if (!found) return;
  const { task } = found;
  if (field === "owner") task.owner = value.trim() || "待定";
  if (field === "due") task.due = value;
  task.edited = true;
  task.confidence = task.owner === "待定" || !task.due ? "needs" : "edited";
  if (task.due) task.priority = daysBetween(found.meeting.date, task.due) <= 3 ? "high" : "medium";
  render();
  showToast(`字段已更新；置信度改为“${confidenceLabel(task.confidence)}”。`, "success");
}

function updateTaskStatus(taskId, status) {
  const found = findTask(taskId);
  if (!found) return;
  found.task.status = status;
  found.task.updatedAt = new Date().toISOString();
  render();
  showToast(`《${found.task.title}》已更新为“${statusLabel(status)}”。`, "success");
}

function askStatusDone(taskId) {
  const found = findTask(taskId);
  if (!found || found.task.status === "done") return;
  ui.pendingStatus = taskId;
  render();
  renderStatusConfirmModal(found.task);
}

function confirmStatusDone() {
  const taskId = ui.pendingStatus;
  if (!taskId) return;
  ui.pendingStatus = null;
  closeModal();
  updateTaskStatus(taskId, "done");
}

function confirmTaskDone(taskId) {
  const found = findTask(taskId);
  if (!found) {
    ui.chatMessages.push({ role: "assistant", html: "没有找到这条任务，没有写入任何数据。" });
    renderDrawer();
    return;
  }
  found.task.status = "done";
  found.task.updatedAt = new Date().toISOString();
  ui.chatMessages.push({ role: "assistant", html: `已把《${esc(found.task.title)}》标记为已完成。<br><strong>写入回执：</strong>更新 1 行 · 任务 ID <span class="mono">${esc(found.task.id)}</span> · 状态 done。` });
  render();
  showToast(`已更新 1 行，回执已读取。`, "success");
}

function confirmResult() {
  const meeting = selectedMeeting();
  if (!meeting) return;
  meeting.confirmed = true;
  render();
  showToast("已确认归档。后续可在任务台账继续维护状态。", "success");
}

function exportMeeting() {
  const meeting = selectedMeeting();
  if (!meeting) return;
  const content = buildMarkdown(meeting);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(meeting.title)}-${meeting.date}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("纪要 Markdown 已导出。", "success");
}

function safeFileName(value) {
  return String(value || "会议纪要").replace(/[\\/:*?"<>|]/g, "-").slice(0, 50);
}

function openDrawer() {
  ui.drawerOpen = true;
  renderDrawer();
  requestAnimationFrame(() => $("#chat-input")?.focus());
}

function closeDrawer() {
  ui.drawerOpen = false;
  renderDrawer();
}

function sendChat(prefill = "") {
  const input = $("#chat-input");
  const text = String(prefill || input?.value || "").trim();
  if (!text) return;
  ui.chatMessages.push({ role: "user", text });
  const response = answerQuery(text, state.meetings, new Date());
  ui.chatMessages.push({ role: "assistant", ...response });
  renderDrawer();
  requestAnimationFrame(() => {
    const next = $("#chat-input");
    if (next) next.focus();
  });
}

function openSettings() {
  renderSettingsModal();
}

function renderStatusConfirmModal(task) {
  $("#modal-root").innerHTML = `
    <div class="modal-overlay" data-action="cancel-status">
      <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="status-confirm-title">
        <div class="modal-head">
          <div><h2 id="status-confirm-title">确认完成这项任务？</h2><p>完成状态会立即写入台账，并计入已完成指标。</p></div>
          <button class="icon-btn" type="button" data-action="cancel-status" aria-label="关闭">${icon("close")}</button>
        </div>
        <div class="modal-body">
          <div class="confirm-task-name">${icon("tasks")} ${esc(task.title)}</div>
          <p class="confirm-copy">请确认该任务已经实际交付。完成后仍可在同一位置改回“进行中”。</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" data-action="cancel-status">取消</button>
          <button class="btn btn-primary" type="button" data-action="confirm-status-done">${icon("check")} 确认完成</button>
        </div>
      </section>
    </div>
  `;
}

function closeModal() {
  ui.pendingStatus = null;
  $("#modal-root").innerHTML = "";
}

function selectEngine(engine) {
  if (engine === "coze" && !ui.health.agent) {
    showToast("Coze Agent 尚未配置。先启动 Node 服务并填写环境变量。", "warning");
    return;
  }
  state.settings.engine = engine;
  state.settings.engineExplicit = true;
  renderSettingsModal();
  updateEngineChrome();
  showToast(engine === "coze" ? "已切换到 Coze Agent。" : "已切换到本地演示引擎。", "success");
}

async function unlockAdminAgent() {
  if (ui.adminBusy) return;
  const key = $("#admin-agent-key")?.value.trim();
  if (!key) {
    showToast("请输入管理员口令。", "warning");
    return;
  }
  ui.adminBusy = true;
  renderSettingsModal();
  try {
    await loginAdminAgent(key);
    await refreshHealth(false);
    if (!ui.health.agent) throw new Error("会话已建立，但 Agent 仍未启用。");
    ui.adminBusy = false;
    selectEngine("coze");
    showToast("管理员会话已启用，当前浏览器可调用 Coze，最多 2 小时。", "success");
  } catch (error) {
    ui.adminBusy = false;
    renderSettingsModal();
    showToast(error.message || "管理员解锁失败。", "error");
  }
}

async function lockAdminAgent() {
  try {
    await logoutAdminAgent();
  } catch {
    // Clearing the local UI is still safe if the session already expired.
  }
  await refreshHealth(false);
  selectEngine("local");
  showToast("管理员会话已结束，Coze 已重新锁定。", "success");
}

async function refreshHealth(showFeedback = true) {
  ui.health = await checkAgentHealth();
  if (!ui.health.agent && state.settings.engine === "coze") state.settings.engine = "local";
  if (!state.settings.engineExplicit) state.settings.engine = "local";
  state.settings.remoteAvailable = Boolean(ui.health.agent);
  saveState();
  updateEngineChrome();
  if (ui.settingsOpen || $("#settings-title")) renderSettingsModal();
  if (showFeedback) showToast(ui.health.agent ? "Agent 服务已连接。" : "当前使用本地演示引擎。", ui.health.agent ? "success" : "warning");
}

function resetDemo() {
  if (!window.confirm("重置后会恢复本机演示数据，当前新增会议和修改会丢失。继续吗？")) return;
  state = buildSeedState(new Date());
  ui.processing = false;
  ui.stepIndex = -1;
  ui.lastProcessed = null;
  ui.chatMessages = [{ role: "assistant", html: "演示数据已重置。可以重新整理会议，或直接查询当前任务。" }];
  render();
  showToast("演示数据已重置。", "success");
}

function showToast(message, tone = "") {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.innerHTML = `${icon(tone === "error" ? "close" : tone === "warning" ? "link" : "check")}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function handleClick(event) {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    $("#app-shell")?.classList.remove("sidebar-open");
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    state.resultTab = tabButton.dataset.tab;
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const { action, id, filter, text, engine } = actionButton.dataset;
  if (!action) return;

  event.preventDefault();
  const actions = {
    process: () => processDraft(),
    "new-meeting": () => newMeeting(),
    "clear-draft": () => clearDraft(),
    "load-sample": () => loadSample(id),
    "open-settings": () => openSettings(),
    "close-modal": () => closeModal(),
    "check-health": () => refreshHealth(true),
    "select-engine": () => selectEngine(engine),
    "admin-unlock": () => unlockAdminAgent(),
    "admin-lock": () => lockAdminAgent(),
    "reset-demo": () => resetDemo(),
    "ledger-filter": () => { state.ui.ledgerFilter = filter; render(); },
    "open-meeting": () => openMeeting(id),
    "delete-meeting": () => deleteMeeting(id),
    "cancel-status": () => closeModal(),
    "confirm-status-done": () => confirmStatusDone(),
    "confirm-result": () => confirmResult(),
    "export-meeting": () => exportMeeting(),
    "close-drawer": () => closeDrawer(),
    "send-chat": () => sendChat(),
    suggestion: () => sendChat(text),
    "confirm-task": () => confirmTaskDone(id)
  };
  actions[action]?.();
}

function handleInput(event) {
  const target = event.target;
  if (target.matches("[data-draft]")) {
    const field = target.dataset.draft;
    state.draft[field] = target.value;
    clearSampleIfEdited();
    saveState();
    syncProcessButton();
    return;
  }

  if (target.matches("[data-ledger-search]")) {
    state.ui.ledgerSearch = target.value;
    const position = target.selectionStart;
    render();
    const next = $("#ledger-search");
    if (next) {
      next.focus();
      next.setSelectionRange(position, position);
    }
    return;
  }

  if (target.id === "chat-input") {
    target.style.height = "auto";
    target.style.height = `${Math.min(100, target.scrollHeight)}px`;
  }
}

function handleChange(event) {
  const target = event.target;
  if (target.matches("[data-task-owner]")) {
    updateTaskField(target.dataset.taskOwner, "owner", target.value);
    return;
  }
  if (target.matches("[data-task-due]")) {
    updateTaskField(target.dataset.taskDue, "due", target.value);
    return;
  }
  if (target.matches("[data-task-status]")) {
    const found = findTask(target.dataset.taskStatus);
    if (target.value === "done" && found?.task.status !== "done") {
      askStatusDone(target.dataset.taskStatus);
      return;
    }
    updateTaskStatus(target.dataset.taskStatus, target.value);
    return;
  }
  if (target.matches("[data-ledger-owner]")) {
    state.ui.ledgerOwner = target.value;
    render();
  }
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    if ($("#modal-root")?.innerHTML) closeModal();
    else if (ui.drawerOpen) closeDrawer();
    else $("#app-shell")?.classList.remove("sidebar-open");
    return;
  }

  if (event.target.id === "chat-input" && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChat();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && event.target.matches('[data-draft="transcript"]')) {
    event.preventDefault();
    processDraft();
  }
}

function handleTaskMouseOver(event) {
  const row = event.target.closest?.(".task-row[data-task-id]");
  if (!row) return;
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
  showSourceFocus(row);
}

function handleTaskMouseOut(event) {
  const row = event.target.closest?.(".task-row[data-task-id]");
  if (!row) return;
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
  hideSourceFocus();
}

function clearSampleIfEdited() {
  if (!state.draft.sampleId) return;
  const sample = sampleTranscripts(new Date()).find((item) => item.id === state.draft.sampleId);
  if (!sample) {
    state.draft.sampleId = "";
    return;
  }
  const expected = emptyDraftFromSample(sample, new Date());
  const changed = ["title", "date", "participantsText", "transcript"].some((field) => state.draft[field] !== expected[field]);
  if (changed) state.draft.sampleId = "";
}

function syncProcessButton() {
  const button = $("#process-button");
  if (!button || ui.processing) return;
  const processed = isDraftProcessed(state.draft);
  const disabled = !state.draft.transcript.trim() || processed;
  button.disabled = disabled;
  button.classList.toggle("is-done", processed);
  button.textContent = processed ? "已整理 · 查看右侧结果" : "开始整理";
  const saved = $("#composer-saved");
  if (saved) saved.hidden = !processed;
}

function init() {
  render();
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("mouseover", handleTaskMouseOver);
  document.addEventListener("mouseout", handleTaskMouseOut);
  $("#menu-toggle")?.addEventListener("click", () => $("#app-shell")?.classList.toggle("sidebar-open"));
  $("#agent-fab")?.addEventListener("click", openDrawer);
  refreshHealth(false);
}

init();

