#!/usr/bin/env node
/**
 * 原型自检脚本（机器可查项）
 *
 * 用法：
 *   node audit.mjs ../标注管理_xxx.html [更多.html] [--app-width 1440] [--modal-width 960] [--json]
 *
 * 检查项：
 *   1. 页面 / 场景卡 / 表格 横向溢出
 *   2. .app 宽度（默认 1440）与高度（默认 ≥900）
 *   3. .modal 宽度（默认 960）
 *   4. 重复 id
 *   5. 屏号格式与连续性（scene-Na…，组号从 1 开始、字母连续）
 *   6. 箭头相邻性（data-from 须为紧邻上一行、data-to 须为紧邻下一行）
 *   7. 内联脚本语法（node --check）
 *
 * 退出码：全部通过 0，否则 1。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : def;
};
const APP_W = Number(flag('--app-width', 1440));
const MODAL_W = Number(flag('--modal-width', 960));
const AS_JSON = args.includes('--json');
const files = args.filter((a, i) => !a.startsWith('--') && !['--app-width', '--modal-width'].includes(args[i - 1]));

if (!files.length) {
  console.error('用法：node audit.mjs <原型.html> [更多.html] [--app-width 1440] [--modal-width 960] [--json]');
  process.exit(2);
}

const INJECT = `
<script>
(function () {
  function box(el) { var r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }
  var out = { view: [innerWidth, innerHeight], scenes: [], issues: [], dupIds: [] };
  var seen = {};
  document.querySelectorAll('[id]').forEach(function (el) {
    if (seen[el.id]) out.dupIds.push(el.id); else seen[el.id] = 1;
  });
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
    out.issues.push('页面横向溢出 ' + document.documentElement.scrollWidth + '>' + document.documentElement.clientWidth);
  }
  document.querySelectorAll('.scene').forEach(function (sc) {
    var id = sc.id.replace(/^scene-/, '');
    var app = sc.querySelector('.app');
    var modal = sc.querySelector('.modal');
    if (sc.scrollWidth > sc.clientWidth + 1) out.issues.push('屏 ' + id + ' 场景卡横向溢出 ' + sc.scrollWidth + '>' + sc.clientWidth);
    var rec = { id: id, app: app ? box(app) : null, modal: modal ? box(modal) : null };
    out.scenes.push(rec);
    if (app) {
      if (rec.app[0] !== ${APP_W}) out.issues.push('屏 ' + id + ' app 宽度 ' + rec.app[0]);
      if (rec.app[1] < 900) out.issues.push('屏 ' + id + ' app 高度 ' + rec.app[1]);
      var body = app.querySelector('.app-body');
      if (body && body.scrollHeight > body.clientHeight + 1) out.issues.push('屏 ' + id + ' 内容纵向溢出 ' + body.scrollHeight + '>' + body.clientHeight);
      if (app.scrollWidth > app.clientWidth + 1) out.issues.push('屏 ' + id + ' app 横向溢出 ' + app.scrollWidth + '>' + app.clientWidth);
    }
    if (modal && rec.modal[0] !== ${MODAL_W}) out.issues.push('屏 ' + id + ' modal 宽度 ' + rec.modal[0]);
    sc.querySelectorAll('table, .panel, .proj-grid, .steps').forEach(function (el) {
      if (el.scrollWidth > el.clientWidth + 1) {
        out.issues.push('屏 ' + id + ' 内元素 ' + (el.className || el.tagName) + ' 横向溢出 ' + el.scrollWidth + '>' + el.clientWidth);
      }
    });
  });
  var pre = document.createElement('pre');
  pre.id = 'AUDIT';
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
})();
</script>`;

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      execFileSync(p, ['--version'], { stdio: 'ignore', timeout: 8000 });
      return p;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

async function auditFile(file) {
  const html = await fs.readFile(file, 'utf8');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'proto-audit-'));
  const target = path.join(tmp, 'check.html');
  await fs.writeFile(target, html.replace('</body>', INJECT + '\n</body>'), 'utf8');

  const dom = execFileSync(
    chromePath,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=2400,1400', '--virtual-time-budget=4000', '--dump-dom', 'file://' + target],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const m = /<pre id="AUDIT">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) throw new Error('页面未返回自检数据（脚本可能报错，先在浏览器控制台看）');
  const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

  // 屏号连续性
  const ids = data.scenes.map((s) => s.id);
  const bad = ids.filter((id) => !/^\d+[a-z]$/.test(id));
  if (bad.length) data.issues.push('屏号格式异常：' + bad.join(', '));
  const groups = [...new Set(ids.map((id) => Number(id.replace(/[a-z]$/, ''))))].sort((a, b) => a - b);
  if (groups.length && groups[0] !== 1) data.issues.push('屏号未从 1 开始：' + groups[0]);
  groups.forEach((g) => {
    const letters = ids.filter((id) => id.startsWith(String(g)) && /^\d+[a-z]$/.test(id)).map((id) => id.slice(-1));
    const seq = [...letters].sort();
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].charCodeAt(0) !== 'a'.charCodeAt(0) + i) {
        data.issues.push('组 ' + g + ' 字母不连续：' + seq.join(''));
        break;
      }
    }
  });
  if (data.dupIds.length) data.issues.push('重复 id：' + [...new Set(data.dupIds)].join(', '));

  // 箭头相邻性：来源须为紧邻上一行、目标须为紧邻下一行
  {
    const start = html.indexOf('<main class="board"');
    const body = start >= 0 ? html.slice(start) : html;
    const tokens = [];
    const re = /<div class="(row(?: [^"]*)?|flow(?: [^"]*)?)"[^>]*>|<article class="scene"[^>]*id="scene-([^"]+)"/g;
    let mm;
    while ((mm = re.exec(body))) {
      if (mm[1]) tokens.push({ type: mm[1].startsWith('row') ? 'row' : 'flow', index: mm.index, raw: mm[0] });
      else tokens.push({ type: 'scene', id: mm[2], index: mm.index });
    }
    const rowStarts = tokens.filter((t) => t.type === 'row').map((t) => t.index);
    const rowIds = rowStarts.map((s, i) => {
      const e = i + 1 < rowStarts.length ? rowStarts[i + 1] : body.length;
      return tokens.filter((t) => t.type === 'scene' && t.index > s && t.index < e).map((t) => t.id);
    });
    tokens.filter((t) => t.type === 'flow').forEach((f) => {
      const from = (/(?:data-from)="([^"]*)"/.exec(f.raw) || [])[1] || '';
      const to = (/(?:data-to)="([^"]*)"/.exec(f.raw) || [])[1] || '';
      const i = rowStarts.filter((s) => s < f.index).length - 1;
      const prev = rowIds[i] || [];
      const next = rowIds[i + 1] || [];
      from.split(/\s+/).filter(Boolean).filter((x) => !prev.includes(x))
        .forEach((x) => data.issues.push('箭头来源 ' + x + ' 不在紧邻上一行'));
      to.split(/\s+/).filter(Boolean).filter((x) => !next.includes(x))
        .forEach((x) => data.issues.push('箭头目标 ' + x + ' 不在紧邻下一行'));
    });
  }

  // 内联脚本语法
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  if (scripts.length) {
    const jsFile = path.join(tmp, 'inline.js');
    await fs.writeFile(jsFile, scripts.join('\n;\n'), 'utf8');
    try {
      execFileSync(process.execPath, ['--check', jsFile], { stdio: 'pipe' });
    } catch (e) {
      data.issues.push('内联脚本语法错误：' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' '));
    }
  }

  await fs.rm(tmp, { recursive: true, force: true });
  return { file: path.basename(file), screens: data.scenes.length, apps: data.scenes.filter((s) => s.app).length, modals: data.scenes.filter((s) => s.modal).length, issues: data.issues };
}

const chromePath = findChrome();
if (!chromePath) {
  console.error('未找到 Chrome/Chromium，可设置 CHROME_PATH 环境变量后重试');
  process.exit(2);
}

const results = [];
for (const f of files) {
  try {
    results.push(await auditFile(path.resolve(f)));
  } catch (e) {
    results.push({ file: path.basename(f), error: e.message });
  }
}

if (AS_JSON) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    if (r.error) {
      console.log(`✗ ${r.file}`);
      console.log(`   ${r.error}`);
      continue;
    }
    const ok = r.issues.length === 0;
    console.log(`${ok ? '✓' : '✗'} ${r.file}`);
    console.log(`   屏 ${r.screens} · 整页 ${r.apps} · 弹窗 ${r.modals} · 问题 ${r.issues.length}`);
    r.issues.forEach((i) => console.log(`   - ${i}`));
  }
}

process.exit(results.some((r) => r.error || r.issues.length) ? 1 : 0);
