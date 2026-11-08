import test from "node:test";
import assert from "node:assert/strict";
import { answerQuery, buildMarkdown, buildMeetingResult, compactTaskTitle, extractTasks, formatDate, isThisWeek, resolveChineseDate } from "../js/engine.js";

const anchor = "2026-10-14";

test("相对日期以会议日期为唯一锚点", () => {
  assert.equal(resolveChineseDate("本周五前给我", anchor).date, "2026-10-16");
  assert.equal(resolveChineseDate("下周三前给我", anchor).date, "2026-10-21");
  assert.equal(resolveChineseDate("这月底前更新完", anchor).date, "2026-10-31");
  assert.equal(resolveChineseDate("下下周一预演", anchor).date, "2026-10-26");
  assert.equal(resolveChineseDate("10 月 27 号", anchor).date, "2026-10-27");
  assert.equal(resolveChineseDate("两周内给我", anchor).date, "2026-10-28");
});

test("短会转写可抽取负责人、日期、来源与待定项", () => {
  const meeting = {
    id: "m-test",
    title: "问卷与底图进度会",
    date: anchor,
    participants: ["张伟", "李娜", "王强", "赵敏"],
    transcript: [
      "张伟：今天把后续两周的分工定一下。李娜，问卷数据本周五前给我。",
      "李娜：好，周五前。",
      "张伟：王强，底图下周三前。",
      "王强：可以。",
      "张伟：赵敏，总图这月底前更新完。",
      "赵敏：行。",
      "张伟：公众参与分析谁做？回头再分。"
    ].join("\n")
  };
  const tasks = extractTasks(meeting);
  assert.ok(tasks.length >= 3);
  assert.equal(tasks[0].owner, "李娜");
  assert.equal(tasks[0].due, "2026-10-16");
  assert.match(tasks[0].title, /问卷数据/);
  assert.match(tasks[0].sourceQuote, /李娜，问卷数据/);
  assert.equal(tasks.at(-1).owner, "待定");
  assert.equal(tasks.at(-1).confidence, "needs");
});

test("三件一致所需的数据可以生成导出文档", () => {
  const meeting = buildMeetingResult({
    id: "m-export",
    title: "评审准备",
    date: anchor,
    participants: ["张伟", "李娜"],
    transcript: "张伟：李娜，调研摘要后天给我。\n李娜：好，后天。"
  });
  assert.ok(meeting.tasks.length >= 1);
  const markdown = buildMarkdown(meeting);
  assert.match(markdown, /# 评审准备/);
  assert.match(markdown, /2026-10-16/);
  assert.match(markdown, /来源会议|待办事项/);
});

test("对话查询能唯一命中并给出关单确认", () => {
  const meetings = [{
    id: "m-query",
    title: "测试会议",
    date: anchor,
    participants: ["李娜"],
    tasks: [{
      id: "task-query",
      title: "提交问卷数据",
      owner: "李娜",
      due: "2026-10-16",
      status: "todo",
      confidence: "clear",
      priority: "high",
      sourceQuote: "李娜，问卷数据本周五前给我。",
      sourceSpeaker: "张伟",
      sourceTime: "00:12"
    }]
  }];
  const result = answerQuery("关闭 问卷数据", meetings, new Date("2026-10-14T12:00:00"));
  assert.equal(result.confirmTaskId, "task-query");
  assert.match(result.html, /准备把/);
});

test("自然语言完成表达也能识别为关单意图", () => {
  const meetings = [{
    id: "m-natural-query",
    title: "测试会议",
    date: anchor,
    tasks: [{
      id: "task-natural",
      title: "提交问卷数据",
      owner: "李娜",
      due: "2026-10-16",
      status: "todo"
    }]
  }];
  for (const query of ["问卷数据已提交", "李娜的问卷数据已经提交", "问卷数据提交了", "把问卷数据标记为已完成"]) {
    const result = answerQuery(query, meetings, new Date("2026-10-14T12:00:00"));
    assert.equal(result.confirmTaskId, "task-natural", query);
  }
});

test("本周查询按自然周筛选，不受日期字符串比较影响", () => {
  const today = new Date("2026-10-14T12:00:00");
  assert.equal(isThisWeek("2026-10-16", today), true);
  assert.equal(isThisWeek("2026-10-21", today), false);
  const meetings = [{
    id: "m-week",
    title: "周查询测试",
    date: "2026-10-14",
    tasks: [
      { id: "this-week", title: "本周交付", owner: "李娜", due: "2026-10-16", status: "todo" },
      { id: "next-week", title: "下周交付", owner: "王强", due: "2026-10-21", status: "todo" }
    ]
  }];
  const result = answerQuery("本周有哪些任务", meetings, today);
  assert.match(result.html, /本周交付/);
  assert.doesNotMatch(result.html, /下周交付/);
  assert.match(answerQuery("本周有哪些事情", meetings, today).html, /本周交付/);
  assert.match(answerQuery("这周要做什么", meetings, today).html, /本周交付/);
  assert.match(answerQuery("本周李娜有什么任务", meetings, today).html, /本周交付/);
});

test("负责人没有未完成任务时也返回结构化回复", () => {
  const meetings = [{
    id: "m-empty",
    title: "空任务",
    date: anchor,
    tasks: [{ id: "done-task", title: "已完成任务", owner: "王强", due: "2026-10-13", status: "done" }]
  }];
  const result = answerQuery("王强有什么任务", meetings, new Date("2026-10-14T12:00:00"));
  assert.equal(typeof result.html, "string");
  assert.match(result.html, /王强当前没有未完成任务/);
});

test("日期格式化与会议日期切换", () => {
  assert.equal(formatDate(new Date(2026, 9, 14, 12)), "2026-10-14");
  assert.equal(resolveChineseDate("本周五前", "2026-10-21").date, "2026-10-23");
});
test("任务标题压缩为动作加对象，原文保持完整", () => {
  assert.equal(compactTaskTitle("提交吧 你手头有现状数据"), "提交现状数据");
  assert.equal(compactTaskTitle("确认版权问题 如果不行 我们换用免费数据"), "确认版权问题");
  assert.equal(compactTaskTitle("汇总中期汇报的 PPT 之前把框架搭出来"), "搭建中期汇报PPT框架");
  assert.equal(compactTaskTitle("接下来定中期汇报的分工。中期汇报是下下周三，也就是 10 月 28 号。"), "确定中期汇报分工");
  assert.match(compactTaskTitle("提交统筹 每个人把自己那部分的文字稿 我来汇总", "老师说要交一份 5000 字左右的书面报告"), /^(统筹|汇总)书面报告$/);

  const line = "张伟：李娜你做吧，你手头有现状数据，下周五之前给我。";
  const tasks = extractTasks({
    id: "m-title",
    title: "标题压缩",
    date: anchor,
    participants: ["张伟", "李娜"],
    transcript: line
  });
  assert.equal(tasks[0].title, "提交现状数据");
  assert.equal(tasks[0].sourceQuote, line);
  assert.equal(tasks[0].due, "2026-10-23");

  const conditionLine = "张伟：王强你确认一下版权问题，如果不行，我们换用免费数据。";
  const conditionTasks = extractTasks({
    id: "m-condition",
    title: "条件句",
    date: anchor,
    participants: ["张伟", "王强"],
    transcript: conditionLine
  });
  assert.equal(conditionTasks[0].title, "确认版权问题");
  assert.equal(conditionTasks[0].sourceQuote, conditionLine);
});

test("长句只保留首个完整分工，不把解释和日期带进标题", () => {
  const line = "张伟：接下来定中期汇报的分工。中期汇报是下下周三，也就是 10 月 28 号。谁做？回头再分。";
  const tasks = extractTasks({
    id: "m-long-title",
    title: "长句分工",
    date: anchor,
    participants: ["张伟", "李娜"],
    transcript: line
  });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "确定中期汇报分工");
  assert.equal(tasks[0].sourceQuote, line);
  assert.ok(tasks[0].title.length <= 24);
});
