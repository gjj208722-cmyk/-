import { addDays, formatDate } from "./engine.js";

const NAME_LIBRARY = ["张伟", "李娜", "王强", "赵敏", "陈晨", "刘洋"];

export function sampleTranscripts(today = new Date()) {
  return [
    {
      id: "sample-baseline",
      label: "短会 · 基础分工",
      title: "问卷与底图进度会",
      participants: ["张伟", "李娜", "王强", "赵敏", "陈晨"],
      transcript: [
        "张伟：今天把后续两周的分工定一下。李娜，问卷数据本周五前给我。",
        "李娜：好，周五前。",
        "张伟：王强，底图下周三前。",
        "王强：可以。",
        "张伟：赵敏，总图这月底前更新完。",
        "赵敏：行。",
        "张伟：公众参与分析谁做？回头再分。",
        "李娜：老师说要加。",
        "张伟：知道，先记着。"
      ].join("\n"),
      meetingDate: formatDate(today)
    },
    {
      id: "sample-midterm",
      label: "中期 · 多任务",
      title: "中期成果推进会",
      participants: ["张伟", "李娜", "王强", "赵敏", "陈晨", "刘洋"],
      transcript: [
        "张伟：今天过一下中期成果的进度。李娜，交叉分析下周三前给我，缺失分析本周内。",
        "李娜：好。",
        "张伟：王强，遥感修正下周三前，数据精度说明一起给我。",
        "王强：可以。",
        "张伟：赵敏，天际线分析下周三前，产业片区混合比例下周五前。",
        "赵敏：好。",
        "张伟：陈晨，座谈提纲本周五前，利益相关者分析下周五前。",
        "陈晨：好。",
        "张伟：刘洋，路网转换本周五前，模型初步结果下周三前。",
        "刘洋：好。",
        "张伟：另外，交通影响评价还要加一节慢行系统分析，下周三之前一起给我。刘洋你负责。",
        "刘洋：好。"
      ].join("\n"),
      meetingDate: formatDate(addDays(today, -5))
    },
    {
      id: "sample-review",
      label: "评审 · 已完成",
      title: "评审材料收口会",
      participants: ["张伟", "李娜", "王强", "赵敏"],
      transcript: [
        "张伟：评审前把材料收口。李娜，调研摘要后天给我。",
        "李娜：好，后天。",
        "张伟：王强，模型跑完两周内给我。",
        "王强：可以。",
        "张伟：赵敏，总图这月底前更新完。",
        "赵敏：行。",
        "张伟：我来安排评审，下下周二。",
        "李娜：下下周二？那就是 10 月 27 号？",
        "张伟：对，10 月 27 号。"
      ].join("\n"),
      meetingDate: formatDate(addDays(today, -12))
    }
  ];
}

export function buildSeedState(today = new Date()) {
  const base = formatDate(today);
  const meetings = [
    {
      id: "meeting-baseline",
      title: "问卷与底图进度会",
      date: base,
      participants: ["张伟", "李娜", "王强", "赵敏", "陈晨"],
      transcript: sampleTranscripts(today)[0].transcript,
      engine: "local",
      confirmed: false,
      durationSec: 21,
      processedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 14).toISOString(),
      resultSummary: "纪要文档已生成；3 条记录已写入台账，其中 1 个负责人需要确认。",
      minutes: {
        overview: "会议确定后续两周的资料提交和底图更新分工。大部分任务有明确承接人，公众参与分析尚未指定负责人，保留为待定项。",
        conclusions: [
          "问卷数据、底图和总图更新分别由李娜、王强、赵敏承接。",
          "公众参与分析需要补充，但负责人和截止时间未在会中明确。"
        ],
        risks: ["公众参与分析仍未指定负责人，后续可能影响中期材料完整度。"],
        unresolved: ["公众参与分析由谁负责，会议中决定回头再分。"]
      },
      tasks: [
        task("baseline-1", "提交问卷数据", "李娜", addDays(today, 3), "todo", "clear", "high", "张伟：今天把后续两周的分工定一下。李娜，问卷数据本周五前给我。", "张伟", "00:12"),
        task("baseline-2", "提交底图", "王强", addDays(today, 8), "todo", "clear", "medium", "张伟：王强，底图下周三前。", "张伟", "00:28"),
        task("baseline-3", "更新总图", "赵敏", addDays(today, 27), "todo", "inferred", "low", "张伟：赵敏，总图这月底前更新完。", "张伟", "00:41"),
        task("baseline-4", "公众参与分析", "待定", "", "todo", "needs", "medium", "张伟：公众参与分析谁做？回头再分。", "张伟", "00:53")
      ]
    },
    {
      id: "meeting-midterm",
      title: "中期成果推进会",
      date: formatDate(addDays(today, -5)),
      participants: ["张伟", "李娜", "王强", "赵敏", "陈晨", "刘洋"],
      transcript: sampleTranscripts(today)[1].transcript,
      engine: "local",
      confirmed: true,
      durationSec: 28,
      processedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5, 15, 40).toISOString(),
      resultSummary: "纪要文档已生成；6 条记录已写入台账，负责人和截止时间均可回溯。",
      minutes: {
        overview: "会议围绕中期成果各模块的交付节点展开，覆盖问卷分析、GIS 修正、方案设计、公众参与和交通影响评价。",
        conclusions: [
          "各模块按负责人拆分为可跟踪任务，相对日期统一按会议日期换算。",
          "交通影响评价补充慢行系统分析，由刘洋承接。"
        ],
        risks: ["路网数据格式不统一，转换耗时可能压缩模型运行时间。"],
        unresolved: ["部分分析结论仍需在中期汇报前合并校对。"]
      },
      tasks: [
        task("mid-1", "完成交叉分析", "李娜", addDays(today, 2), "doing", "clear", "high", "张伟：李娜，交叉分析下周三前给我，缺失分析本周内。", "张伟", "00:16"),
        task("mid-2", "完成缺失分析", "李娜", addDays(today, -1), "done", "clear", "medium", "张伟：李娜，交叉分析下周三前给我，缺失分析本周内。", "张伟", "00:16"),
        task("mid-3", "完成遥感修正", "王强", addDays(today, 1), "todo", "clear", "high", "张伟：王强，遥感修正下周三前，数据精度说明一起给我。", "张伟", "00:35"),
        task("mid-4", "完成天际线分析", "赵敏", addDays(today, 6), "todo", "clear", "medium", "张伟：赵敏，天际线分析下周三前，产业片区混合比例下周五前。", "张伟", "00:51"),
        task("mid-5", "完成路网数据转换", "刘洋", addDays(today, -1), "todo", "clear", "high", "张伟：刘洋，路网转换本周五前，模型初步结果下周三前。", "张伟", "01:08"),
        task("mid-6", "补充慢行系统分析", "刘洋", addDays(today, 4), "done", "clear", "medium", "张伟：交通影响评价还要加一节慢行系统分析，下周三之前一起给我。刘洋你负责。", "张伟", "01:22")
      ]
    },
    {
      id: "meeting-review",
      title: "评审材料收口会",
      date: formatDate(addDays(today, -12)),
      participants: ["张伟", "李娜", "王强", "赵敏"],
      transcript: sampleTranscripts(today)[2].transcript,
      engine: "local",
      confirmed: true,
      durationSec: 18,
      processedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 12, 9, 20).toISOString(),
      resultSummary: "纪要文档已生成；3 条记录已写入台账，均已完成。",
      minutes: {
        overview: "会议完成评审前材料收口，明确摘要、模型结果和总图三项交付。",
        conclusions: ["评审时间按口述日期与相对日期双重确认，统一为会议后的第二个周二。"],
        risks: [],
        unresolved: []
      },
      tasks: [
        task("review-1", "提交调研摘要", "李娜", addDays(today, -10), "done", "clear", "medium", "张伟：李娜，调研摘要后天给我。", "张伟", "00:08"),
        task("review-2", "提交模型结果", "王强", addDays(today, -2), "done", "clear", "medium", "张伟：王强，模型跑完两周内给我。", "张伟", "00:17"),
        task("review-3", "更新总图", "赵敏", addDays(today, -1), "done", "inferred", "low", "张伟：赵敏，总图这月底前更新完。", "张伟", "00:26")
      ]
    }
  ];

  return {
    version: 2,
    createdAt: new Date().toISOString(),
    meetings,
    selectedMeetingId: "meeting-baseline",
    view: "workbench",
    resultTab: "tasks",
    draft: emptyDraftFromSample(sampleTranscripts(today)[0], today),
    settings: { engine: "local", remoteAvailable: false, engineExplicit: false },
    ui: { showResult: true, ledgerFilter: "all", ledgerSearch: "", ledgerOwner: "all" }
  };
}

function task(id, title, owner, due, status, confidence, priority, sourceQuote, sourceSpeaker, sourceTime) {
  return {
    id,
    title,
    owner,
    due: due ? formatDate(due) : "",
    status,
    confidence,
    priority,
    sourceQuote,
    sourceSpeaker,
    sourceTime,
    edited: false
  };
}

export function defaultDraft(today = new Date()) {
  return {
    title: "",
    date: formatDate(today),
    participantsText: "",
    transcript: "",
    sampleId: ""
  };
}

export function emptyDraftFromSample(sample, today = new Date()) {
  return {
    title: sample.title,
    date: sample.meetingDate || formatDate(today),
    participantsText: sample.participants.join("、"),
    transcript: sample.transcript,
    sampleId: sample.id
  };
}

export const participantsLibrary = NAME_LIBRARY;
