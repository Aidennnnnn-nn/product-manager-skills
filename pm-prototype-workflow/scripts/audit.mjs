#!/usr/bin/env node
/**
 * 原型自检脚本（机器可查项）
 *
 * 用法：
 *   node audit.mjs ../标注管理_xxx.html [更多.html] [--app-width 1440] [--modal-width 960] [--strict] [--json]
 *
 * 检查项：
 *   1. 页面 / 场景卡 / 表格 横向溢出
 *   2. .app 宽度（默认 1440）与高度（默认 ≥900）
 *   3. .modal 宽度（默认 960）
 *   4. 重复 id
 *   5. 屏号格式与连续性（scene-Na…，组号从 1 开始、字母连续）
 *   6. 箭头相邻性（data-from 须为紧邻上一行、data-to 须为紧邻下一行）
 *   7. 外部资源、字符图标和图标 key
 *   8. 严格模式下流转连线必须具备来源、目标和触发说明
 *   9. 内联脚本语法（node --check）
 *  10. --require-style 检查新稿的档案、来源声明、Token 与锁定组件；历史稿保持旧命令兼容
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
const STRICT = args.includes('--strict');
const REQUIRE_STYLE = args.includes('--require-style');
const REQUIRE_COMPONENTS = args.includes('--require-components');
const PERSONAL_STYLE = JSON.parse(await fs.readFile(new URL('../assets/个人风格Token.json', import.meta.url), 'utf8'));
const COMPONENT_CONTRACT = JSON.parse(await fs.readFile(new URL('../assets/个人风格组件契约.json', import.meta.url), 'utf8'));
const ICON_MANIFEST = JSON.parse(await fs.readFile(new URL('../assets/icons.manifest.json', import.meta.url), 'utf8'));
const ICON_NAMES = (ICON_MANIFEST.groups || []).flatMap((group) => (group.icons || []).map((icon) => icon.key));
const files = args.filter((a, i) => !a.startsWith('--') && !['--app-width', '--modal-width'].includes(args[i - 1]));

if (!files.length) {
  console.error('用法：node audit.mjs <原型.html> [更多.html] [--app-width 1440] [--modal-width 960] [--strict] [--require-style] [--json]');
  process.exit(2);
}

const INJECT = `
<script>
(function () {
  function box(el) { var r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }
  var out = { view: [innerWidth, innerHeight], scenes: [], issues: [], dupIds: [] };
  const profile = document.documentElement.getAttribute('data-style-profile');
  const styleNode = document.querySelector('script#prototype-style[type="application/json"]');
  if (${REQUIRE_STYLE} || profile || styleNode) {
    out.styleProfile = profile;
    if (!['project', 'personal'].includes(profile)) out.issues.push('缺少或无效的风格档案 data-style-profile');
    let spec;
    try { spec = styleNode ? JSON.parse(styleNode.textContent) : null; }
    catch { out.issues.push('风格清单 prototype-style 不是有效 JSON'); }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      out.issues.push('缺少有效的风格清单 prototype-style');
    } else {
      if (spec.profile !== profile) out.issues.push('根节点风格与清单不一致');
      ['source', 'template'].forEach(function (key) {
        if (typeof spec[key] !== 'string' || !spec[key].trim()) out.issues.push('风格清单缺少 ' + key);
      });
      if (!Array.isArray(spec.lockedAreas) || !spec.lockedAreas.length) out.issues.push('风格清单缺少锁定范围 lockedAreas');
      if (!Array.isArray(spec.allowedChanges)) out.issues.push('风格清单缺少允许变化 allowedChanges');
      const personal = ${JSON.stringify(PERSONAL_STYLE)};
      const expected = profile === 'personal' ? personal.css : spec.tokens;
      const isMap = expected && typeof expected === 'object' && !Array.isArray(expected);
      if (!isMap || !Object.keys(expected).length) out.issues.push('风格清单缺少锁定 Token');
      const scopes = [document.documentElement, ...document.querySelectorAll('.app')];
      const normalize = function (v) { return String(v).trim().replace(/\s+/g, ' ').toLowerCase(); };
      if (isMap) Object.entries(expected).forEach(function (entry) {
        const key = entry[0], value = entry[1];
        if (!key.startsWith('--') || typeof value !== 'string' || !value.trim()) {
          out.issues.push('无效的风格 Token ' + key); return;
        }
        scopes.forEach(function (scope) {
          if (normalize(getComputedStyle(scope).getPropertyValue(key)) !== normalize(value)) {
            out.issues.push('风格 Token 不匹配 ' + key + '（' + (scope.className || 'html') + '）');
          }
        });
      });
      const checks = profile === 'personal' ? personal.checks : spec.checks;
      if (!Array.isArray(checks) || !checks.length) out.issues.push('风格清单缺少壳层或组件检查');
      if (Array.isArray(checks)) checks.forEach(function (check) {
        if (!check || typeof check.selector !== 'string' || typeof check.property !== 'string' || typeof check.value !== 'string') {
          out.issues.push('风格检查项格式错误'); return;
        }
        let nodes;
        try { nodes = [...document.querySelectorAll(check.selector)]; }
        catch { out.issues.push('风格检查选择器无效 ' + check.selector); return; }
        if (!nodes.length && profile === 'project') out.issues.push('锁定元素不存在 ' + check.selector);
        nodes.forEach(function (node) {
          const probe = document.createElement('div');
          probe.style[check.property] = check.value;
          document.body.appendChild(probe);
          const want = getComputedStyle(probe)[check.property];
          probe.remove();
          const actual = getComputedStyle(node)[check.property];
          if (!want || actual !== want) out.issues.push('档案样式不匹配 ' + check.selector + '.' + check.property + '：' + actual + ' / ' + want);
        });
      });
      if (profile === 'personal') document.querySelectorAll('.app').forEach(function (app) {
        if (!app.querySelector('.sidebar')) out.issues.push('个人风格完整页面缺少锁定侧栏');
      });
    }
    document.querySelectorAll('[data-style-profile]').forEach(function (node) {
      if (node.getAttribute('data-style-profile') !== profile) out.issues.push('同一 HTML 混用风格档案');
    });
  }
  if (${REQUIRE_COMPONENTS} || profile === 'personal') {
    const contract = ${JSON.stringify(COMPONENT_CONTRACT)};
    const components = contract.components || {};
    document.querySelectorAll('[data-component]').forEach(function (node) {
      const name = node.getAttribute('data-component');
      const variant = node.getAttribute('data-variant') || 'default';
      const item = components[name];
      if (!item) { out.issues.push('未登记组件：' + name); return; }
      if (item.selector && !node.matches(item.selector)) out.issues.push('组件选择器与契约不符：' + name + ' 应匹配 ' + item.selector);
      if (!Array.isArray(item.variants) || !item.variants.includes(variant)) out.issues.push('未登记组件变体：' + name + '/' + variant);
    });
    document.querySelectorAll('button,input,select,textarea').forEach(function (node) {
      if (!node.hasAttribute('data-component') && !node.closest('[data-state-sample]')) out.issues.push('交互控件未登记组件：' + node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).trim().replace(/\s+/g, '.') : ''));
    });
    if (profile === 'personal' && !document.querySelectorAll('[data-component]').length) out.issues.push('个人风格页面缺少 data-component 标记');
  }
  var seen = {};
  document.querySelectorAll('[id]').forEach(function (el) {
    if (seen[el.id]) out.dupIds.push(el.id); else seen[el.id] = 1;
  });
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
    out.issues.push('页面横向溢出 ' + document.documentElement.scrollWidth + '>' + document.documentElement.clientWidth);
  }
  const external = [...document.querySelectorAll('script[src],link[href],img[src],source[src],use[href],use')]
    .map(function (el) { return el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || ''; })
    .filter(function (value) { return /^(https?:)?\\/\\//i.test(value); });
  if (external.length) out.issues.push('存在外部资源：' + [...new Set(external)].join(', '));
  const badGlyphs = [...document.querySelectorAll('button,[role="button"]')]
    .filter(function (el) { return /^[+×✕✖→←‹›⌄⌃]+$/.test((el.textContent || '').trim()); })
    .map(function (el) { return (el.textContent || '').trim(); });
  if (badGlyphs.length) out.issues.push('按钮使用字符代替图标：' + [...new Set(badGlyphs)].join(', '));
  const iconNames = new Set(${JSON.stringify(ICON_NAMES)});
  document.querySelectorAll('[data-icon]').forEach(function (el) {
    const name = el.getAttribute('data-icon');
    if (!iconNames.has(name)) out.issues.push('未登记图标 key：' + name);
  });
  document.querySelectorAll('[data-lucide]').forEach(function () { out.issues.push('发现非 Skill 图标绑定 data-lucide；统一使用登记图标资产'); });
  const missingFlow = [...document.querySelectorAll('.flow')].filter(function (el) {
    return !el.hasAttribute('data-from') || !el.hasAttribute('data-to') || !(el.textContent || '').trim();
  }).length;
  if (${STRICT} && document.documentElement.hasAttribute('data-prototype-strict') && missingFlow) {
    out.issues.push('流转连线缺少来源、目标或触发说明：' + missingFlow);
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
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((x) => !/\bsrc\s*=/.test(x[1]) && (!/\btype\s*=/.test(x[1]) || /\btype\s*=\s*["'](?:text|application)\/javascript["']|\btype\s*=\s*["']module["']/i.test(x[1])))
    .map((x) => x[2]);
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
  return { file: path.basename(file), styleProfile: data.styleProfile || null, screens: data.scenes.length, apps: data.scenes.filter((s) => s.app).length, modals: data.scenes.filter((s) => s.modal).length, issues: data.issues };
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
