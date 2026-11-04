const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function toDate(value = new Date()) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0);
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? toDate(new Date()) : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
}

export function formatDate(value) {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatMonthDay(value) {
  const d = toDate(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDisplayDate(value) {
  const d = toDate(value);
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${formatDate(d)} / ${weekday}`;
}

export function addDays(value, days) {
  const d = toDate(value);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

export function startOfWeek(value) {
  const d = toDate(value);
  const offset = (d.getDay() + 6) % 7;
  return addDays(d, -offset);
}

export function endOfWeek(value) {
  return addDays(startOfWeek(value), 6);
}

export function endOfMonth(value) {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0);
}

export function startOfMonth(value) {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0);
}

export function daysBetween(from, to) {
  const a = toDate(from).getTime();
  const b = toDate(to).getTime();
  return Math.round((b - a) / 86400000);
}

export function isOverdue(due, today = new Date()) {
  if (!due) return false;
  return daysBetween(today, due) < 0;
}

export function isThisWeek(due, today = new Date()) {
  if (!due) return false;
  return due >= startOfWeek(today) && due <= endOfWeek(today);
}

export function resolveChineseDate(text, anchorValue = new Date()) {
  const source = String(text || "");
  const anchor = toDate(anchorValue);
  if (!source.trim()) return null;

  if (/今天|今日/.test(source)) return result(addDays(anchor, 0), "今天", false);
  if (/后天/.test(source)) return result(addDays(anchor, 2), "后天", false);
  if (/明天|明日/.test(source)) return result(addDays(anchor, 1), "明天", false);
  if (/大后天/.test(source)) return result(addDays(anchor, 3), "大后天", false);

  let match = source.match(/下下(?:周|星期)([一二三四五六日天])/);
  if (match) {
    const target = addDays(startOfWeek(anchor), 14 + WEEKDAYS[match[1]] - 1);
    return result(target, match[0], false);
  }

  match = source.match(/下(?:周|星期)([一二三四五六日天])/);
  if (match) {
    const target = addDays(startOfWeek(anchor), 7 + WEEKDAYS[match[1]] - 1);
    return result(target, match[0], false);
  }

  match = source.match(/(?:本周|这周|本星期|这星期)([一二三四五六日天])/);
  if (match) {
    const target = addDays(startOfWeek(anchor), WEEKDAYS[match[1]] - 1);
    return result(target, match[0], false);
  }

  match = source.match(/(?:^|[，,。；;\s])(?:周|星期)([一二三四五六日天])/);
  if (match) {
    let target = addDays(startOfWeek(anchor), WEEKDAYS[match[1]] - 1);
    if (target < anchor) target = addDays(target, 7);
    return result(target, match[0].trim(), false);
  }

  if (/下下(?:周|星期)(?:内|之前|前|结束前)?/.test(source)) return result(addDays(endOfWeek(anchor), 7), "下下周内", true);
  if (/下(?:周|星期)(?:内|之前|前|结束前)?/.test(source)) return result(endOfWeek(addDays(anchor, 7)), "下周内", true);
  if (/(?:本周|这周|本星期|这星期)(?:内|之前|前|结束前)?/.test(source)) return result(endOfWeek(anchor), "本周内", true);
  if (/周末/.test(source)) return result(addDays(startOfWeek(anchor), 6), "周末", true);

  match = source.match(/(?:下下个月|下下月)(?:底|末)?/);
  if (match) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 1, 12, 0, 0);
    return result(endOfMonth(d), match[0], true);
  }
  match = source.match(/(?:下个月|下月)(?:底|末)?/);
  if (match) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 12, 0, 0);
    return result(endOfMonth(d), match[0], true);
  }
  match = source.match(/(?:本月|这个月|这月|本月底|月底|月末)(?:底|末|前)?/);
  if (match) return result(endOfMonth(anchor), match[0], true);
  if (/(?:本月初|月初)/.test(source)) return result(startOfMonth(anchor), "月初", true);

  match = source.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (match) {
    let year = anchor.getFullYear();
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month + 6 < anchor.getMonth() + 1) year += 1;
    const target = new Date(year, month - 1, day, 12, 0, 0);
    return result(target, match[0], false);
  }

  match = source.match(/([一二两三四五六七八九十\d]+)\s*天(?:内|后|之内)/);
  if (match) {
    const n = Number(match[1]) || CN_NUM[match[1]] || 0;
    if (n > 0) return result(addDays(anchor, n), match[0], false);
  }
  match = source.match(/([一二两三四五六七八九十\d]+)\s*(?:周|星期)(?:内|后|之内)/);
  if (match) {
    const n = Number(match[1]) || CN_NUM[match[1]] || 0;
    if (n > 0) return result(addDays(anchor, n * 7), match[0], false);
  }

  return null;
}

function result(date, matched, inferred) {
  return { date: formatDate(date), matched, inferred, value: toDate(date) };
}

export function parseTranscript(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^([^：:\n]{1,12})[：:]\s*(.+)$/);
    if (match) parsed.push({ speaker: match[1].trim(), content: match[2].trim(), raw: line });
    else parsed.push({ speaker: "", content: line, raw: line });
  }
  return parsed;
}

function cleanTaskTitle(value, context = "") {
  let title = String(value || "")
    .replace(/^(?:请|麻烦|记得|务必|尽快|先|再|你|您)+/, "")
    .replace(/(?:一下|一份|一个|这部分|这块|这件事|任务)$/g, "")
    .replace(/(?:之前|以前|前)$/g, "")
    .replace(/[，,。；;：:！!？?、\s]+$/g, "")
    .replace(/^[，,。；;：:！!？?、\s]+/g, "")
    .trim();

  title = title.replace(/^(?:把|将)/, "");
  if (!title || title.length < 2) return "";

  if (/更新/.test(context) && !/^更新/.test(title)) title = `更新${title}`;
  else if (/补充|补五个|补一批|补/.test(context) && !/^补充/.test(title)) title = `补充${title}`;
  else if (/确认/.test(context) && !/^确认/.test(title)) title = `确认${title}`;
  else if (/对接/.test(context) && !/^对接/.test(title)) title = `对接${title}`;
  else if (/跟进/.test(context) && !/^跟进/.test(title)) title = `跟进${title}`;
  else if (/整理/.test(context) && !/^整理/.test(title)) title = `整理${title}`;
  else if (/给我|发我|交给我|同步给我|发群里/.test(context) && !/^(?:提交|输出|发送|整理|完成|更新|补充|对接|确认|跟进)/.test(title)) {
    title = `提交${title}`;
  }

  return title.replace(/\s{2,}/g, " ").trim();
}

function titleFromSegment(segment, due) {
  let fragment = String(segment || "");
  if (due?.matched) fragment = fragment.replace(due.matched, " ");
  fragment = fragment
    .replace(/(?:之前|以前|前)?(?:给我|发我|交给我|同步给我|一起给我|发群里)/g, " ")
    .replace(/一起|同步|也/g, " ")
    .replace(/(?:更新完|完成|做完|跑完|弄完|好了|即可)/g, " ")
    .replace(/[，,。；;：:！!？?、]+/g, " ")
    .trim();
  return cleanTaskTitle(fragment, segment);
}

function makeTask(meeting, payload) {
  const owner = payload.owner || "待定";
  const due = payload.due || "";
  const inferred = Boolean(payload.inferred);
  const needs = owner === "待定" || !due;
  return {
    id: payload.id || `task-${meeting.id}-${Math.random().toString(36).slice(2, 8)}`,
    title: payload.title,
    owner,
    due,
    status: payload.status || "todo",
    confidence: needs ? "needs" : inferred ? "inferred" : "clear",
    priority: payload.priority || (due && daysBetween(meeting.date, due) <= 3 ? "high" : "medium"),
    sourceQuote: payload.sourceQuote || "",
    sourceSpeaker: payload.sourceSpeaker || "",
    sourceTime: payload.sourceTime || "",
    meetingId: meeting.id,
    edited: Boolean(payload.edited)
  };
}

export function extractTasks(meeting) {
  const parsed = parseTranscript(meeting.transcript);
  const knownNames = new Set([...(meeting.participants || []), ...parsed.map((line) => line.speaker).filter(Boolean)]);
  const tasks = [];
  const seen = new Set();

  const push = (task) => {
    if (!task?.title) return;
    const key = `${task.owner}|${task.title.replace(/\s/g, "")}|${task.due || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push(task);
  };

  parsed.forEach((line, index) => {
    const { speaker, content, raw } = line;
    const sourceQuote = raw;
    const sourceSpeaker = speaker;

    const pendingMatch = content.match(/^(.*?)(?:谁做|谁负责|谁来|谁去|回头再分|回头再说|先记着|待定)/);
    if (pendingMatch && pendingMatch[1].trim().length >= 2 && /谁|回头|待定/.test(content)) {
      const title = cleanTaskTitle(pendingMatch[1].replace(/[，,。；;：:！!？?]+$/, ""), content);
      if (title) {
        push(makeTask(meeting, { title, owner: "待定", due: "", confidence: "needs", sourceQuote, sourceSpeaker, sourceTime: `${String(10 + (index % 2)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}` }));
      }
    }

    const directCandidates = [...knownNames]
      .filter((name) => name && name !== speaker)
      .map((name) => {
        const match = content.match(new RegExp(`(?:^|[。！？!?；;\\s])${escapeRegExp(name)}[，,]\\s*`));
        return match ? { name, index: match.index, end: match.index + match[0].length } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.index - b.index);
    const directName = directCandidates[0];
    if (directName) {
      const body = content.slice(directName.end);
      const parts = body.split(/[，,；;]/).map((part) => part.trim()).filter(Boolean);
      let carryDue = null;
      for (const part of parts) {
        if (/^(?:知道|先记着|回头再分|待定)/.test(part)) continue;
        const due = resolveChineseDate(part, meeting.date);
        if (due) carryDue = due;
        const inheritedDue = !due && carryDue && /一起|同步|也|同时/.test(part) ? carryDue : due;
        const title = titleFromSegment(part, inheritedDue);
        if (!title || title.length < 2 || /^(好|可以|行|知道|明白)/.test(title)) continue;
        push(makeTask(meeting, {
          title,
          owner: directName.name,
          due: inheritedDue?.date || "",
          inferred: Boolean(inheritedDue?.inferred),
          sourceQuote,
          sourceSpeaker,
          sourceTime: `${String(10 + (index % 2)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}`
        }));
      }
      return;
    }

    const addressPattern = /([\u4e00-\u9fa5]{2,4})你(?:负责|跟进|确认|来|做|看一下|看看|处理|补)(?:一下)?([^。！？!?]*)/;
    const addressed = content.match(addressPattern);
    if (addressed && knownNames.has(addressed[1])) {
      const due = resolveChineseDate(addressed[2], meeting.date);
      const title = titleFromSegment(addressed[2], due);
      if (title) {
        push(makeTask(meeting, {
          title,
          owner: addressed[1],
          due: due?.date || "",
          inferred: true,
          sourceQuote,
          sourceSpeaker,
          sourceTime: `${String(10 + (index % 2)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}`
        }));
      }
    }

    const selfMatch = content.match(/(?:我(?:来|负责|去|会)|由我)(?:一下)?([^。！？!?]*?(?:给|发|交|完成|更新|对接|确认|跟进)[^。！？!?]*)/);
    if (selfMatch) {
      const segment = selfMatch[1];
      const due = resolveChineseDate(segment, meeting.date);
      const title = titleFromSegment(segment, due);
      if (title && !/^(?:协调|处理|看看)$/.test(title)) {
        push(makeTask(meeting, { title, owner: speaker || "待定", due: due?.date || "", inferred: true, sourceQuote, sourceSpeaker, sourceTime: `00:${String(index + 1).padStart(2, "0")}` }));
      }
    }
  });

  return tasks;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMinutes(meeting, tasks = []) {
  const parsed = parseTranscript(meeting.transcript);
  const sentences = parsed.map((line) => line.content);
  const decisions = sentences.filter((line) => /决定|拍板|确定|通过|互斥|叠加|沿用|统一/.test(line)).slice(0, 5);
  const risks = sentences.filter((line) => /风险|担心|压力|来不及|不够|延期|投诉|时间紧/.test(line)).slice(0, 4);
  const unresolved = sentences.filter((line) => /待定|回头|再分|再定|还没|没有明确|看情况/.test(line)).slice(0, 4);
  const pending = tasks.filter((task) => task.owner === "待定" || !task.due).length;
  return {
    overview: `${meeting.title}围绕当前进度、分工与后续节点展开。系统从转写中提取 ${tasks.length} 条待办，其中 ${pending} 条需要人工补齐负责人或截止时间。`,
    conclusions: decisions.length ? decisions : ["本次会议已形成可执行待办，详见结构化任务清单。"],
    risks: risks.length ? risks : ["未从原文识别到明确风险表述。"],
    unresolved: unresolved.length ? unresolved : ["原文未识别到悬而未决事项。"],
    tasks
  };
}

export function buildMeetingResult(meeting, options = {}) {
  const tasks = options.tasks || extractTasks(meeting);
  const minutes = options.minutes || buildMinutes(meeting, tasks);
  const needs = tasks.filter((task) => task.confidence === "needs").length;
  return {
    ...meeting,
    tasks,
    minutes,
    confirmed: Boolean(options.confirmed),
    engine: options.engine || "local",
    durationSec: options.durationSec ?? 3,
    processedAt: options.processedAt || new Date().toISOString(),
    resultSummary: needs
      ? `纪要文档已生成；${tasks.length - needs} 条记录已写入台账，其中 ${needs} 个负责人或截止时间需要确认。`
      : `纪要文档已生成；${tasks.length} 条记录已写入台账，负责人和截止时间均可回溯。`
  };
}

export function buildMarkdown(meeting) {
  const lines = [];
  lines.push(`# ${meeting.title}`);
  lines.push("");
  lines.push(`- 会议日期：${formatDate(meeting.date)}`);
  lines.push(`- 参会人：${(meeting.participants || []).join("、") || "未填写"}`);
  lines.push(`- 生成方式：${meeting.engine === "coze" ? "Coze Agent" : "本地演示引擎"}`);
  lines.push("");
  lines.push("## 会议摘要");
  lines.push("");
  lines.push(meeting.minutes?.overview || meeting.resultSummary || "暂无摘要。");
  lines.push("");
  lines.push("## 关键结论");
  (meeting.minutes?.conclusions || []).forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## 待办事项");
  lines.push("");
  lines.push("| 事项 | 负责人 | 截止时间 | 状态 | 依据 |");
  lines.push("| --- | --- | --- | --- | --- |");
  (meeting.tasks || []).forEach((task) => {
    lines.push(`| ${task.title} | ${task.owner} | ${task.due || "待定"} | ${statusLabel(task.status)} | ${String(task.sourceQuote || "").replace(/\|/g, "｜")} |`);
  });
  lines.push("");
  lines.push("## 风险与待定");
  (meeting.minutes?.risks || []).forEach((item) => lines.push(`- 风险：${item}`));
  (meeting.minutes?.unresolved || []).forEach((item) => lines.push(`- 待定：${item}`));
  lines.push("");
  lines.push(`> 本文由会议行动助手根据原始转写整理。相对日期以 ${formatDate(meeting.date)} 为唯一锚点。`);
  return lines.join("\n");
}

export function statusLabel(status) {
  return { todo: "待开始", doing: "进行中", done: "已完成" }[status] || "待开始";
}

export function confidenceLabel(confidence) {
  return { clear: "明确", inferred: "推断", needs: "需补", edited: "人工确认" }[confidence] || "明确";
}

export function flattenTasks(meetings) {
  return (meetings || []).flatMap((meeting) => (meeting.tasks || []).map((task) => ({ ...task, meetingTitle: meeting.title, meetingDate: meeting.date })));
}

export function taskStats(meetings, today = new Date()) {
  const tasks = flattenTasks(meetings);
  return {
    total: tasks.length,
    open: tasks.filter((task) => task.status !== "done").length,
    done: tasks.filter((task) => task.status === "done").length,
    overdue: tasks.filter((task) => task.status !== "done" && isOverdue(task.due, today)).length,
    thisWeek: tasks.filter((task) => task.status !== "done" && isThisWeek(task.due, today)).length,
    pending: tasks.filter((task) => task.owner === "待定" || !task.due).length,
    high: tasks.filter((task) => task.status !== "done" && task.priority === "high").length
  };
}

export function answerQuery(query, meetings, today = new Date()) {
  const text = String(query || "").trim();
  const tasks = flattenTasks(meetings);
  const open = tasks.filter((task) => task.status !== "done");
  if (!text) return { html: "可以问我：谁有哪些任务、本周到期什么、谁还没负责人，或直接说“关闭 问卷数据”。" };

  if (/(帮助|能做什么|怎么用)/.test(text)) {
    return {
      html: "我能做四件事：<ul><li>按负责人查询未完成任务</li><li>查看本周到期、逾期或待补字段</li><li>关闭唯一命中的待办并读回执</li><li>汇总当前任务状态</li></ul>"
    };
  }

  if (/(关闭|关掉|完成|标记为已完成|标记完成)/.test(text)) {
    let keyword = text
      .replace(/^(?:请|帮我|麻烦)?\s*/, "")
      .replace(/^(?:把|将)\s*/, "")
      .replace(/^(?:关闭|关掉|完成|标记为已完成|标记完成)\s*/, "")
      .replace(/(?:标记为|设为|改成)?\s*(?:已完成|完成|关掉|关闭)$/g, "")
      .replace(/[“”"'《》\s]/g, "")
      .trim();
    if (/^(?:所有|全部|这些|那些)$/.test(keyword)) {
      return { html: "批量关单属于高风险操作。当前版本只允许一次关闭一条，请说出具体任务名。" };
    }
    if (!keyword) return { html: "请告诉我要关闭哪条待办，例如“关闭 问卷数据”。" };
    const matches = open.filter((task) => task.title.includes(keyword) || task.owner.includes(keyword) || (task.meetingTitle || "").includes(keyword));
    if (matches.length === 0) return { html: `没有找到与“${escapeHtml(keyword)}”匹配的未完成待办。` };
    if (matches.length > 1) {
      return { html: `“${escapeHtml(keyword)}”匹配到 ${matches.length} 条，请说得更具体：<ul>${matches.slice(0, 5).map((task) => `<li>${escapeHtml(task.title)} · ${escapeHtml(task.owner)} · ${escapeHtml(task.due || "待定")}</li>`).join("")}</ul>` };
    }
    return {
      html: `准备把《${escapeHtml(matches[0].title)}》标记为已完成。`,
      confirmTaskId: matches[0].id,
      confirmLabel: "确认关闭并读回执"
    };
  }

  if (/(本周|这周)/.test(text) && /(到期|任务|截止)/.test(text)) {
    const list = open.filter((task) => isThisWeek(task.due, today));
    return { html: list.length ? `本周还有 <strong>${list.length}</strong> 条待办：<ul>${list.map((task) => `<li>${escapeHtml(task.title)} · ${escapeHtml(task.owner)} · ${formatMonthDay(task.due)}</li>`).join("")}</ul>` : "本周没有到期未完成的待办。" };
  }

  if (/(逾期|过期|超期)/.test(text)) {
    const list = open.filter((task) => isOverdue(task.due, today));
    return { html: list.length ? `当前有 <strong>${list.length}</strong> 条逾期：<ul>${list.map((task) => `<li>${escapeHtml(task.title)} · ${escapeHtml(task.owner)} · 原定 ${escapeHtml(task.due)}</li>`).join("")}</ul>` : "当前没有逾期未完成的任务。" };
  }

  if (/(谁.*负责人|待定|没.*人|缺.*人)/.test(text)) {
    const list = open.filter((task) => task.owner === "待定" || !task.due);
    return { html: list.length ? `有 <strong>${list.length}</strong> 条待补：<ul>${list.map((task) => `<li>${escapeHtml(task.title)} · ${task.owner === "待定" ? "负责人待定" : escapeHtml(task.owner)} · ${task.due ? escapeHtml(task.due) : "截止待定"}</li>`).join("")}</ul>` : "目前没有负责人或截止时间待补的待办。" };
  }

  if (/(周报|总结|概览|状态)/.test(text)) {
    const stats = taskStats(meetings, today);
    return { html: `当前共 <strong>${stats.total}</strong> 条任务：未完成 ${stats.open} 条，已完成 ${stats.done} 条，逾期 ${stats.overdue} 条，本周到期 ${stats.thisWeek} 条，字段待补 ${stats.pending} 条。` };
  }

  const owners = [...new Set(tasks.map((task) => task.owner).filter((owner) => owner && owner !== "待定"))];
  const owner = owners.find((name) => text.includes(name));
  if (owner) {
    const list = open.filter((task) => task.owner === owner);
    if (list.length) {
      return { html: `${escapeHtml(owner)}当前有 <strong>${list.length}</strong> 条未完成：<ul>${list.map((task) => `<li>${escapeHtml(task.title)} · ${task.due ? formatMonthDay(task.due) : "截止待定"} · ${statusLabel(task.status)}</li>`).join("")}</ul>` };
    }
    return `${escapeHtml(owner)}当前没有未完成任务。`;
  }

  const direct = open.filter((task) => task.title.includes(text) || text.includes(task.title));
  if (direct.length === 1) {
    const task = direct[0];
    return { html: `找到《${escapeHtml(task.title)}》：负责人 ${escapeHtml(task.owner)}，截止 ${task.due || "待定"}，状态 ${statusLabel(task.status)}。` };
  }

  return { html: "我还不能确定你指的是哪条任务。试试“李娜有什么任务”“本周到期什么”“谁还没负责人”，或直接说“关闭 问卷数据”。" };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

export function makeId(prefix = "m") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
