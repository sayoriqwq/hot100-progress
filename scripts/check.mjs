// 检查进度仓是否符合规则：node scripts/check.mjs
// 规则见 README.md。网站按同样的规则读文件，这里不通过的文件网站也读不到。
import fs from "node:fs";
import path from "node:path";

const LANGS = {
  python: [".py"], java: [".java"], go: [".go"], cpp: [".cpp", ".cc"], c: [".c"],
  javascript: [".js"], typescript: [".ts"], rust: [".rs"], kotlin: [".kt"], swift: [".swift"], csharp: [".cs"],
};
const STATUS = ["已通过", "曾通过", "尝试过", "未开始"];
const RESULTS = ["通过", "答案错误", "超时", "运行出错", "思路不成立"];
const errors = [], warnings = [];

const catalog = JSON.parse(fs.readFileSync("hot100.json", "utf8"));
const hot = new Map(catalog.problems.map((p) => [p.id, p]));

// 1) progress.json
let progress;
try {
  progress = JSON.parse(fs.readFileSync("progress.json", "utf8"));
} catch (e) {
  errors.push(`progress.json 不是合法的 JSON：${e.message}`);
}
if (progress) {
  if (progress.version !== 1) errors.push("progress.json 的 version 必须是 1");
  if (!progress.problems || typeof progress.problems !== "object" || Array.isArray(progress.problems)) errors.push("progress.json 的 problems 必须是一个对象");
  else {
    for (const [k, v] of Object.entries(progress.problems)) {
      if (!/^\d+$/.test(k)) errors.push(`progress.json：题号 "${k}" 不是数字`);
      else if (!hot.has(Number(k))) warnings.push(`progress.json：${k} 不在热题 100 里，网站不会显示`);
      if (!v || !STATUS.includes(v.status)) errors.push(`progress.json：第 ${k} 题的 status 必须是 ${STATUS.join(" / ")}`);
      if (v && v.updatedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(v.updatedAt)) errors.push(`progress.json：第 ${k} 题的 updatedAt 要写成 YYYY-MM-DD`);
    }
  }
}

// 1b) settings.json（可以没有）：{ version: 1, langs: [语言目录名…] }，第一个是默认语言
if (fs.existsSync("settings.json")) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync("settings.json", "utf8").replace(/^﻿/, ""));
  } catch (e) {
    errors.push(`settings.json 不是合法的 JSON：${e.message}`);
  }
  if (settings) {
    if (settings.version !== 1) errors.push("settings.json 的 version 必须是 1");
    if (!Array.isArray(settings.langs) || !settings.langs.length) errors.push("settings.json 的 langs 要是一个数组，至少写一种语言");
    else {
      for (const l of settings.langs) if (!LANGS[l]) errors.push(`settings.json：不认识的语言 "${l}"，可选 ${Object.keys(LANGS).join(" / ")}`);
      if (new Set(settings.langs).size !== settings.langs.length) errors.push("settings.json 的 langs 里有重复的语言");
    }
  }
}

// 2) solutions/<语言>/<四位题号>.<题名>[.<写法>].<后缀>
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
for (const file of walk("solutions")) {
  const rel = file.split(path.sep).join("/");
  const base = path.basename(rel);
  if (base === ".gitkeep" || base === "README.md") continue;
  const parts = rel.split("/");
  if (parts.length !== 3) { errors.push(`${rel}：题解要直接放在 solutions/<语言>/ 下面，不要再分子目录`); continue; }
  const [, lang, name] = parts;
  if (!LANGS[lang]) { errors.push(`${rel}：不认识的语言目录 "${lang}"，可选 ${Object.keys(LANGS).join(" / ")}`); continue; }
  const ext = path.extname(name);
  if (!LANGS[lang].includes(ext)) errors.push(`${rel}：${lang} 目录下的文件后缀应该是 ${LANGS[lang].join(" 或 ")}`);
  const m = name.match(/^(\d{4})\.(.+)\.[A-Za-z0-9]+$/);
  if (!m) { errors.push(`${rel}：文件名要写成 <四位题号>.<题名>[.<写法>].<后缀>，比如 0001.两数之和.py`); continue; }
  const id = Number(m[1]);
  if (!hot.has(id)) warnings.push(`${rel}：${id} 不在热题 100 里，网站不会显示`);
  else if (!m[2].startsWith(hot.get(id).name)) warnings.push(`${rel}：题名建议和 hot100.json 一致（"${hot.get(id).name}"）`);
}

// 3) attempts/<四位题号>.<题名>/<YYYY-MM-DD>.<序号>.<结果>.md
//    解析规则和网站 site/functions/_lib/progress.ts 的 parseAttemptPath / parseAttemptBody 一致
function parseAttemptPath(p) {
  const m = p.match(/^attempts\/(\d{4})\.([^/]+)\/(\d{4}-\d{2}-\d{2})\.(\d+)\.([^./]+)\.md$/);
  if (!m || !RESULTS.includes(m[5])) return null;
  return { id: Number(m[1]), name: m[2], date: m[3], seq: Number(m[4]), result: m[5] };
}
function parseAttemptBody(src) {
  const errs = [];
  const text = src.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (!fm) errs.push("开头要有 --- 包起来的设置（至少写 lang）");
  else for (const line of fm[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z]+):\s*(.*?)\s*(?:#.*)?$/);
    if (!kv) { errs.push(`设置里看不懂这一行：${line}`); continue; }
    meta[kv[1]] = kv[2];
  }
  const lang = meta.lang ?? "";
  if (fm && !LANGS[lang]) errs.push(`lang 要写成语言目录名之一：${Object.keys(LANGS).join(" / ")}`);
  if (meta.verbatim != null && meta.verbatim !== "true" && meta.verbatim !== "false") errs.push("verbatim 只能写 true 或 false");
  // 从力扣同步过来的记录（或补过编号的手写记录）带着 source / submission / submittedAt
  if (meta.submission != null && !/^\d+$/.test(meta.submission)) errs.push("submission 只能写力扣的提交编号（数字）");
  if (meta.submittedAt != null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(meta.submittedAt)) errs.push("submittedAt 要写成 2026-11-14T10:05:00+08:00 这样");
  const body = fm ? text.slice(fm[0].length) : text;
  let code = null;
  for (const chunk of body.split(/^## +/m).slice(1)) {
    const nl = chunk.indexOf("\n");
    const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    const content = (nl < 0 ? "" : chunk.slice(nl + 1)).trim();
    if (title !== "代码") continue;
    const c = content.match(/^(`{3,})([^\n`]*)\n([\s\S]*?)\n\1\s*$/);
    if (!c) errs.push("「代码」一节里要放且只放一个 ``` 代码块");
    else code = c[3];
  }
  return { lang, code, submission: meta.submission ?? null, errors: errs };
}
const seenSubmission = new Map();
for (const file of walk("attempts")) {
  const rel = file.split(path.sep).join("/");
  const base = path.basename(rel);
  if (base === ".gitkeep" || base === "README.md") continue;
  // attempts/skip.txt：不要从力扣导入的提交编号，一行一个，# 后面是注释
  if (rel === "attempts/skip.txt") {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      const l = line.replace(/#.*/, "").trim();
      if (l && !/^\d+$/.test(l)) errors.push(`attempts/skip.txt 第 ${i + 1} 行：只能写力扣的提交编号（数字），注释用 # 开头`);
    });
    continue;
  }
  const a = parseAttemptPath(rel);
  if (!a) {
    errors.push(`${rel}：尝试记录要写成 attempts/<四位题号>.<题名>/<YYYY-MM-DD>.<序号>.<结果>.md，结果只能是 ${RESULTS.join(" / ")}`);
    continue;
  }
  if (Number.isNaN(Date.parse(a.date))) errors.push(`${rel}：日期 ${a.date} 不是有效的日期`);
  if (!hot.has(a.id)) warnings.push(`${rel}：${a.id} 不在热题 100 里，网站不会显示`);
  else if (a.name !== hot.get(a.id).name) warnings.push(`${rel}：目录名里的题名建议和 hot100.json 一致（"${hot.get(a.id).name}"）`);
  const body = parseAttemptBody(fs.readFileSync(file, "utf8"));
  for (const e of body.errors) errors.push(`${rel}：${e}`);
  if (body.submission) {
    if (seenSubmission.has(body.submission)) errors.push(`${rel}：力扣提交 ${body.submission} 已经记在 ${seenSubmission.get(body.submission)} 里了，同一次提交只记一份`);
    else seenSubmission.set(body.submission, rel);
  }
}

for (const w of warnings) console.log("提示：" + w);
for (const e of errors) console.log("错误：" + e);
if (errors.length) {
  console.log(`\n有 ${errors.length} 处不符合规则，网站可能读不到这些数据。规则见 README.md。`);
  process.exit(1);
}
console.log("检查通过。");
