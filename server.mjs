import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScheduleState, normalizeTimeZone, parseOpenWindows, zonedDayKey } from "./lib/schedule.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 4173);
const COZE_API_BASE = (process.env.COZE_API_BASE || "https://api.coze.cn").replace(/\/$/, "");
const COZE_API_TOKEN = process.env.COZE_API_TOKEN || "";
const COZE_BOT_ID = process.env.COZE_BOT_ID || "";
const AGENT_CONFIGURED = Boolean(COZE_API_TOKEN && COZE_BOT_ID);
const PUBLIC_AGENT_ENABLED = process.env.PUBLIC_AGENT_ENABLED === "true";
const ADMIN_AGENT_KEY = process.env.ADMIN_AGENT_KEY || "";
const ADMIN_BOOTSTRAP_KEY_HASH = "2ca7e4a6e46552325872046be7aca89afdf5dc07cfc809d488dd19d6e9f86953";
const ADMIN_KEY_CONFIGURED = Boolean(ADMIN_AGENT_KEY || ADMIN_BOOTSTRAP_KEY_HASH);
const AGENT_TIMEZONE = normalizeTimeZone(process.env.AGENT_TIMEZONE);
const AGENT_OPEN_WINDOWS = parseOpenWindows(process.env.AGENT_OPEN_WINDOWS || "");
const AGENT_DAILY_LIMIT = positiveNumber(process.env.AGENT_DAILY_LIMIT, 50);
const AGENT_RATE_LIMIT_PER_IP = positiveNumber(process.env.AGENT_RATE_LIMIT_PER_IP, 3);
const AGENT_RATE_WINDOW_MS = positiveNumber(process.env.AGENT_RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000;
const AGENT_MANUAL_OPEN_MINUTES = Math.min(240, positiveNumber(process.env.AGENT_MANUAL_OPEN_MINUTES, 30));
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ADMIN_COOKIE = "maa_admin";
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const publicAgentUsage = new Map();
let publicAgentDaily = { day: "", count: 0 };
let manualPublicOpenUntil = 0;

function loadDotEnv(file) {
  try {
    const content = readFileSync(file, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/health") return health(req, res);
    if (url.pathname === "/api/agent" && req.method === "POST") return agent(req, res);
    if (url.pathname === "/api/admin/login" && req.method === "POST") return adminLogin(req, res);
    if (url.pathname === "/api/admin/logout" && req.method === "POST") return adminLogout(req, res);
    if (url.pathname === "/api/admin/public-agent" && req.method === "POST") return adminPublicAgent(req, res);
    if (url.pathname.startsWith("/api/")) return json(res, 404, { ok: false, error: "接口不存在" });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "Method not allowed" });
    return serveStatic(url.pathname, req, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: "服务端发生异常", detail: error.message });
  }
});

function health(req, res) {
  const adminSession = hasAdminSession(req);
  const schedule = publicSchedule();
  const publicReady = schedule.open && schedule.quotaAvailable;
  const agentReady = AGENT_CONFIGURED && (adminSession || publicReady);
  let reason;
  if (!AGENT_CONFIGURED) {
    reason = "未配置 COZE_API_TOKEN / COZE_BOT_ID，当前使用本地演示引擎。";
  } else if (adminSession) {
    reason = "管理员会话已连接，当前浏览器可临时调用 Coze Agent。";
  } else if (schedule.manualOpen) {
    reason = schedule.quotaAvailable
      ? "管理员已手动开放所有人调用。"
      : "管理员已手动开放，但今日公开调用额度已用完。";
  } else if (!PUBLIC_AGENT_ENABLED) {
    reason = ADMIN_KEY_CONFIGURED
      ? "远程 Agent 已锁定；仅管理员可临时解锁。"
      : "远程 Agent 已关闭，当前使用本地演示引擎。";
  } else if (!schedule.windows.length) {
    reason = "已启用定时开放，但尚未配置开放时段，当前使用本地演示引擎。";
  } else if (!schedule.open) {
    reason = schedule.nextOpenAt
      ? `Agent 当前未开放；下次开放：${schedule.nextOpenAt}。`
      : "Agent 当前未开放，且没有后续开放时段。";
  } else if (!schedule.quotaAvailable) {
    reason = "今日公开调用额度已用完，当前使用本地演示引擎。";
  } else {
    reason = "Agent 正在定时开放，访客可直接调用。";
  }
  return json(res, 200, {
    ok: true,
    mode: agentReady ? "coze" : "demo",
    agent: agentReady,
    provider: agentReady ? "coze" : "local",
    adminLocked: Boolean(AGENT_CONFIGURED && ADMIN_KEY_CONFIGURED && !agentReady),
    adminEnabled: Boolean(AGENT_CONFIGURED && ADMIN_KEY_CONFIGURED),
    adminSession,
    publicOpen: schedule.open,
    publicQuotaAvailable: schedule.quotaAvailable,
    manualOpen: schedule.manualOpen,
    manualOpenUntil: schedule.manualOpenUntil,
    schedule,
    reason
  });
}

async function agent(req, res) {
  if (!AGENT_CONFIGURED) {
    return json(res, 503, {
      ok: false,
      error: "Agent 未配置：请设置 COZE_API_TOKEN 和 COZE_BOT_ID 后重启服务。"
    });
  }
  const adminSession = hasAdminSession(req);
  const schedule = publicSchedule();
  if (!adminSession && !schedule.open) {
    return json(res, 403, {
      ok: false,
      error: schedule.nextOpenAt
        ? `Agent 当前未开放；下次开放：${schedule.nextOpenAt}。`
        : "远程 Agent 已锁定：当前不在开放时段。",
      schedule
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }

  const transcript = String(body.transcript || "").trim();
  const meetingDate = String(body.meetingDate || "").trim();
  if (!transcript) return json(res, 400, { ok: false, error: "transcript 不能为空" });
  if (transcript.length > 60000) return json(res, 413, { ok: false, error: "单次转写过长，请按 90 分钟以内切分后重试。" });

  if (!adminSession) {
    const quota = consumePublicAgentQuota(clientIp(req));
    if (!quota.ok) {
      return json(res, quota.status, { ok: false, error: quota.error, schedule: quota.schedule });
    }
  }

  const prompt = buildPrompt({
    transcript,
    meetingDate,
    title: String(body.title || "").trim(),
    participants: Array.isArray(body.participants) ? body.participants : []
  });

  try {
    const content = await callCoze(prompt);
    const parsed = parseAgentJson(content);
    return json(res, 200, {
      ok: true,
      provider: "coze",
      meeting: normalizeAgentResult(parsed, meetingDate),
      meta: { rawLength: content.length }
    });
  } catch (error) {
    console.error("Coze agent error:", error.message);
    return json(res, 502, {
      ok: false,
      error: "Coze Agent 调用失败",
      detail: error.message,
      raw: error.raw ? String(error.raw).slice(0, 3000) : undefined
    });
  }
}

async function adminLogin(req, res) {
  if (!AGENT_CONFIGURED || !ADMIN_KEY_CONFIGURED) {
    return json(res, 503, { ok: false, error: "管理员解锁尚未配置。" });
  }
  if (!isSameOrigin(req)) {
    return json(res, 403, { ok: false, error: "仅允许从本站发起管理员解锁。" });
  }
  const ip = clientIp(req);
  if (!allowAdminAttempt(ip)) {
    return json(res, 429, { ok: false, error: "尝试次数过多，请十分钟后再试。" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
  if (!adminKeyMatches(String(body.key || ""))) {
    return json(res, 401, { ok: false, error: "管理员口令错误。" });
  }

  adminLoginAttempts.delete(ip);
  const token = randomBytes(32).toString("base64url");
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  res.setHeader("Set-Cookie", adminCookie(req, token, Math.floor(ADMIN_SESSION_TTL_MS / 1000)));
  return json(res, 200, { ok: true, expiresIn: Math.floor(ADMIN_SESSION_TTL_MS / 1000) });
}

function adminLogout(req, res) {
  const token = parseCookies(req.headers.cookie || "")[ADMIN_COOKIE];
  if (token) adminSessions.delete(token);
  res.setHeader("Set-Cookie", adminCookie(req, "", 0));
  return json(res, 200, { ok: true });
}

async function adminPublicAgent(req, res) {
  if (!AGENT_CONFIGURED) {
    return json(res, 503, { ok: false, error: "Agent 尚未配置。" });
  }
  if (!hasAdminSession(req)) {
    return json(res, 401, { ok: false, error: "请先登录管理员会话。" });
  }
  if (!isSameOrigin(req)) {
    return json(res, 403, { ok: false, error: "仅允许从本站操作。" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }

  const open = Boolean(body.open);
  if (open) {
    const requestedMinutes = Number(body.minutes);
    const minutes = Number.isFinite(requestedMinutes) && requestedMinutes > 0
      ? Math.min(240, requestedMinutes)
      : AGENT_MANUAL_OPEN_MINUTES;
    manualPublicOpenUntil = Date.now() + minutes * 60 * 1000;
  } else {
    manualPublicOpenUntil = 0;
  }

  const schedule = publicSchedule();
  return json(res, 200, {
    ok: true,
    manualOpen: schedule.manualOpen,
    manualOpenUntil: schedule.manualOpenUntil,
    schedule
  });
}

function hasAdminSession(req) {
  const token = parseCookies(req.headers.cookie || "")[ADMIN_COOKIE];
  if (!token) return false;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function safeEqual(value, expected) {
  const left = createHash("sha256").update(value).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function adminKeyMatches(value) {
  if (ADMIN_AGENT_KEY) return safeEqual(value, ADMIN_AGENT_KEY);
  const actual = createHash("sha256").update(value).digest();
  const expected = Buffer.from(ADMIN_BOOTSTRAP_KEY_HASH, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function publicSchedule(now = new Date()) {
  const day = zonedDayKey(now, AGENT_TIMEZONE);
  if (publicAgentDaily.day !== day) publicAgentDaily = { day, count: 0 };
  const scheduled = getScheduleState({
    enabled: PUBLIC_AGENT_ENABLED,
    windows: AGENT_OPEN_WINDOWS,
    timeZone: AGENT_TIMEZONE,
    now,
    dailyLimit: AGENT_DAILY_LIMIT,
    dailyCount: publicAgentDaily.count
  });
  const manualOpen = manualPublicOpenUntil > now.getTime();
  if (!manualOpen) manualPublicOpenUntil = 0;
  return {
    ...scheduled,
    scheduledOpen: scheduled.open,
    manualOpen,
    manualOpenUntil: manualOpen ? new Date(manualPublicOpenUntil).toISOString() : null,
    open: scheduled.open || manualOpen,
    currentWindow: manualOpen ? "管理员手动开放" : scheduled.currentWindow
  };
}

function consumePublicAgentQuota(ip) {
  const schedule = publicSchedule();
  if (!schedule.open) {
    return {
      ok: false,
      status: 403,
      error: schedule.nextOpenAt
        ? `Agent 当前未开放；下次开放：${schedule.nextOpenAt}。`
        : "Agent 当前不在开放时段。",
      schedule
    };
  }
  if (!schedule.quotaAvailable) {
    return {
      ok: false,
      status: 429,
      error: "今日公开调用额度已用完，请稍后再试或联系管理员。",
      schedule
    };
  }

  const now = Date.now();
  let record = publicAgentUsage.get(ip);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + AGENT_RATE_WINDOW_MS };
  }
  if (record.count >= AGENT_RATE_LIMIT_PER_IP) {
    return {
      ok: false,
      status: 429,
      error: `调用过于频繁：每 ${Math.round(AGENT_RATE_WINDOW_MS / 60000)} 分钟最多 ${AGENT_RATE_LIMIT_PER_IP} 次。`,
      schedule
    };
  }

  record.count += 1;
  publicAgentUsage.set(ip, record);
  publicAgentDaily.count += 1;
  return { ok: true, schedule: publicSchedule() };
}

function allowAdminAttempt(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const record = adminLoginAttempts.get(ip);
  if (!record || record.resetAt <= now) {
    adminLoginAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= 5) return false;
  record.count += 1;
  return true;
}

function adminCookie(req, value, maxAge) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = forwardedProto === "https" || Boolean(req.socket.encrypted);
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function buildPrompt({ transcript, meetingDate, title, participants }) {
  return `你是“会议行动助手”的结构化抽取节点。只输出一个合法 JSON 对象，不要 Markdown、代码围栏或解释。

会议日期 meetingDate：${meetingDate}
会议主题：${title || "未填写"}
参会人：${participants.join("、") || "从转写中识别"}

输出 JSON 结构：
{
  "title": "会议主题",
  "minutes": {
    "overview": "2-4 句会议摘要",
    "conclusions": ["关键结论"],
    "risks": ["明确风险"],
    "unresolved": ["悬而未决事项"]
  },
  "tasks": [
    {
      "title": "任务动作 + 对象",
      "owner": "负责人；没有依据写待定",
      "due": "YYYY-MM-DD；无法解析写空字符串",
      "status": "todo",
      "confidence": "clear | inferred | needs",
      "priority": "high | medium | low",
      "sourceQuote": "必须逐字摘自原始转写的原句",
      "sourceSpeaker": "说话人",
      "sourceTime": "转写中的时间；没有就写空字符串"
    }
  ]
}

硬规则：
1. 相对日期必须以 meetingDate 为唯一锚点换算，不得使用系统当天；无法解析就留空。
2. 负责人和截止时间没有原文依据时写“待定”/空字符串，禁止猜测。
3. 每条任务必须有 sourceQuote，且 sourceQuote 必须出现在原文中。
4. 只抽取有明确动作或交付物的待办；闲聊、确认语气、重复表述不单独成任务。
5. 同一负责人、同一动作的重复表述合并。
6. 输出 JSON 可被 JSON.parse 直接解析。
7. 会议明确提到某项工作需要做、但负责人或时间未定（如“谁做？回头再分”），必须保留为任务，owner 写“待定”，due 写空字符串，confidence 写“needs”。

原始转写：
"""
${transcript}
"""`;
}

async function callCoze(prompt) {
  const created = await fetchJson(`${COZE_API_BASE}/v3/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COZE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      bot_id: COZE_BOT_ID,
      user_id: "meeting-action-agent-web",
      stream: false,
      additional_messages: [{ role: "user", content: prompt, content_type: "text" }]
    })
  }, 45000);

  if (created.code && created.code !== 0) throw new Error(created.msg || created.message || `Coze 创建会话失败：${created.code}`);
  const chat = created.data || created;
  const chatId = chat.id;
  const conversationId = chat.conversation_id;
  if (!chatId || !conversationId) throw new Error("Coze 未返回 chat_id / conversation_id");

  let status = chat.status;
  for (let i = 0; i < 100; i += 1) {
    if (status === "completed") break;
    if (["failed", "canceled", "requires_action"].includes(status)) throw new Error(`Coze 会话状态异常：${status}`);
    await sleep(900);
    const retrieved = await fetchJson(`${COZE_API_BASE}/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
      headers: { Authorization: `Bearer ${COZE_API_TOKEN}` }
    }, 30000);
    const data = retrieved.data || retrieved;
    status = data.status;
  }
  if (status !== "completed") throw new Error(`Coze 会话超时，最后状态：${status}`);

  const listed = await fetchJson(`${COZE_API_BASE}/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
    headers: { Authorization: `Bearer ${COZE_API_TOKEN}` }
  }, 30000);
  const messages = listed.data || listed.messages || [];
  const answers = messages
    .filter((message) => message.role === "assistant" && message.type === "answer")
    .map((message) => normalizeMessageContent(message.content))
    .filter(Boolean);
  const fallback = messages
    .filter((message) => message.role === "assistant")
    .map((message) => normalizeMessageContent(message.content))
    .filter(Boolean);
  const content = answers.at(-1) || fallback.at(-1) || "";
  if (!content) throw new Error("Coze 没有返回 assistant answer");
  return content;
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || "").join("\n");
  if (content && typeof content === "object") return content.text || content.content || JSON.stringify(content);
  return "";
}

function parseAgentJson(content) {
  let text = String(content || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through with raw content for diagnosis.
      }
    }
    const error = new Error("Agent 返回内容无法解析为结构化 JSON");
    error.raw = text;
    throw error;
  }
}

function normalizeAgentResult(parsed, meetingDate) {
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks.map((task) => {
    const owner = String(task.owner || "待定").trim() || "待定";
    const due = normalizeDue(task.due);
    let confidence = ["clear", "inferred", "needs"].includes(task.confidence) ? task.confidence : "clear";
    if (owner === "待定" || !due) confidence = "needs";
    return {
      title: String(task.title || "").trim(),
      owner,
      due,
      status: ["todo", "doing", "done"].includes(task.status) ? task.status : "todo",
      confidence,
      priority: ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium",
      sourceQuote: String(task.sourceQuote || "").trim(),
      sourceSpeaker: String(task.sourceSpeaker || "").trim(),
      sourceTime: String(task.sourceTime || "").trim()
    };
  }).filter((task) => task.title) : [];
  return {
    title: String(parsed?.title || "").trim(),
    meetingDate,
    tasks,
    minutes: {
      overview: String(parsed?.minutes?.overview || "").trim(),
      conclusions: toStringArray(parsed?.minutes?.conclusions),
      risks: toStringArray(parsed?.minutes?.risks),
      unresolved: toStringArray(parsed?.minutes?.unresolved)
    }
  };
}

function normalizeDue(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) throw new Error(data.msg || data.message || data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw new Error("请求体超过 2MB 限制");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

async function serveStatic(pathname, req, res) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) {
    return json(res, 403, { ok: false, error: "Forbidden" });
  }
  let info;
  try {
    info = await stat(target);
  } catch {
    return json(res, 404, { ok: false, error: "文件不存在" });
  }
  const file = info.isDirectory() ? path.join(target, "index.html") : target;
  const content = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const appAsset = [".html", ".js", ".css", ".svg"].includes(ext);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": appAsset ? "no-store" : "public, max-age=3600"
  });
  if (req.method === "HEAD") return res.end();
  return res.end(content);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  return res.end(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.listen(PORT, () => {
  console.log(`Meeting Action Agent web: http://localhost:${PORT}`);
  const mode = PUBLIC_AGENT_ENABLED
    ? `scheduled public${AGENT_OPEN_WINDOWS.length ? ` (${AGENT_OPEN_WINDOWS.length} windows)` : " (no windows, closed)"}`
    : ADMIN_KEY_CONFIGURED
      ? "admin unlock"
      : "local demo";
  console.log(`Agent mode: ${mode}`);
});
