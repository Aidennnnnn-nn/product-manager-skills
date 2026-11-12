#!/usr/bin/env node
/**
 * 构建原型图标资产（Lucide，ISC）
 *
 * 用法：
 *   node build-icons.mjs --src /path/to/lucide-static      # 从已解压的包构建（推荐，离线可跑）
 *   node build-icons.mjs                                    # 无 --src 时逐个从 unpkg 拉取
 *
 * 产出（写入 ../assets/）：
 *   icons.js          基础 UI 图标常量 ICON
 *   icons-domain.js   业务语义图标常量 ICON_DOMAIN
 *   icons.manifest.json  来源、版本、许可、上游名、组合关系
 *
 * 规则：
 *   - 只取原始 path，不改形；网格必须 24×24；stroke-width 统一 2。
 *   - 组合图标（fileChat / fileDone / fileWarning）用「底形断角 + 角标缩放」，
 *     角标组上按 2/scale 反向补偿 stroke-width，缩放后仍是 2 个用户单位；
 *     禁用 vector-effect="non-scaling-stroke"（会在小尺寸下把角标画得过粗）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.67.0';
const LICENSE = 'ISC';
const GRID = '0 0 24 24';
const STROKE = 2;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../assets');

const GROUPS = [
  {
    file: 'icons.js',
    constName: 'ICON',
    title: '基础 UI 图标',
    items: [
      ['menu', 'menu', '展开菜单'],
      ['search', 'search', '查询'],
      ['reset', 'rotate-ccw', '重置'],
      ['refresh', 'refresh-cw', '刷新'],
      ['plus', 'plus', '新增'],
      ['minus', 'minus', '移除'],
      ['close', 'x', '关闭'],
      ['check', 'check', '完成'],
      ['chevronDown', 'chevron-down', '展开'],
      ['chevronUp', 'chevron-up', '收起'],
      ['chevronRight', 'chevron-right', '右向'],
      ['chevronLeft', 'chevron-left', '左向'],
      ['back', 'arrow-left', '返回'],
      ['forward', 'arrow-right', '下一步'],
      ['more', 'ellipsis', '更多操作'],
      ['external', 'external-link', '外部打开'],
      ['filter', 'filter', '筛选'],
      ['settings', 'settings', '设置'],
      ['bell', 'bell', '通知'],
      ['logout', 'log-out', '退出'],
      ['user', 'user', '账号'],
      ['globe', 'globe', '语言/全局'],
      ['home', 'house', '首页'],
      ['grid', 'layout-grid', '项目/应用'],
      ['dashboard', 'layout-dashboard', '工作台/平台'],
      ['folder', 'folder', '目录'],
      ['file', 'file', '文件'],
      ['files', 'files', '多文件'],
      ['upload', 'upload', '上传'],
      ['download', 'download', '下载/导出'],
      ['trash', 'trash-2', '删除'],
      ['edit', 'pencil', '编辑'],
      ['eye', 'eye', '查看'],
      ['copy', 'copy', '复制'],
      ['link', 'link', '链接'],
      ['image', 'image', '图片'],
      ['listOrdered', 'list-ordered', '有序列表'],
      ['alignCenter', 'align-center', '居中对齐'],
      ['circlePlus', 'circle-plus', '添加（圆）'],
      ['calendar', 'calendar', '日期'],
      ['clock', 'clock', '时间'],
      ['info', 'info', '说明'],
      ['success', 'circle-check', '成功'],
      ['warning', 'circle-alert', '警告'],
      ['error', 'circle-x', '失败'],
      ['danger', 'triangle-alert', '风险提示'],
      ['loading', 'loader-circle', '加载'],
      ['list', 'list', '列表'],
      ['table', 'table', '表格'],
      ['sliders', 'sliders-horizontal', '筛选条件'],
      ['expand', 'maximize-2', '放大'],
      ['collapse', 'minimize-2', '缩小'],
      ['panel', 'panel-left', '侧栏'],
      ['sparkles', 'sparkles', 'AI/智能'],
    ],
  },
  {
    file: 'icons-domain.js',
    constName: 'ICON_DOMAIN',
    title: '业务语义图标（知识库 / 标注流程）',
    items: [
      ['filePlus', 'file-plus-2', '文件新增'],
      ['fileText', 'file-text', '文件摘要'],
      ['chat', 'message-square-text', '问答对'],
      ['chunk', 'blocks', '分块'],
      ['vector', 'binary', '向量'],
      ['store', 'database', '存储/库'],
      ['similar', 'git-compare', '相似检测'],
      ['tag', 'tag', '标注'],
      ['review', 'badge-check', '审核'],
      ['publish', 'send', '发布'],
      ['scan', 'scan-search', '检测'],
      ['package', 'box', '打包/版本'],
    ],
  },
];

// 组合图标：底形取 file 的右下游离开口，角标缩放到右下角
const COMPOSITES = [
  { key: 'fileChat', badge: 'message-square-text', scale: 0.5, dropLine: true, halo: true, use: '文件问答（纸+气泡）' },
  { key: 'fileDone', badge: 'circle-check', scale: 0.46, dropLine: false, use: '文件已处理' },
  { key: 'fileWarning', badge: 'triangle-alert', scale: 0.46, dropLine: false, use: '文件异常' },
];

const DROP = new Set(['class', 'id', 'style']);

function normalize(svg, name) {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb || vb[1].trim() !== GRID) throw new Error(`${name}: viewBox 不是 ${GRID}，拒绝入库`);
  const els = svg.match(/<(?:path|circle|rect|line|ellipse|polyline|polygon)\b[^>]*\/>/g) || [];
  if (!els.length) throw new Error(`${name}: 未找到图形元素`);
  return els
    .map((el) => {
      const tag = /^<([a-z]+)/.exec(el)[1];
      const attrs = [...el.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)]
        .filter(([, k]) => !DROP.has(k))
        .map(([, k, v]) => `${k}="${v}"`)
        .join(' ');
      if (!attrs) throw new Error(`${name}: <${tag}> 无可用属性`);
      return `<${tag} ${attrs}/>`;
    })
    .join('');
}

function wrap(inner, extraAttrs = '') {
  return (
    `<svg class="icon" viewBox="${GRID}" fill="none" stroke="currentColor" stroke-width="${STROKE}" ` +
    `stroke-linecap="round" stroke-linejoin="round"${extraAttrs}>${inner}</svg>`
  );
}

async function loadSvg(name, srcDir) {
  if (srcDir) {
    const p = path.join(srcDir, 'icons', `${name}.svg`);
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      throw new Error(`找不到图标 ${name}（${p}）`);
    }
  }
  for (let i = 0; i < 3; i++) {
    try {
      const url = `https://unpkg.com/lucide-static@${VERSION}/icons/${name}.svg`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return await res.text();
    } catch (e) {
      if (i === 2) throw new Error(`拉取 ${name} 失败：${e.message}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

function buildComposite(badgeInner, { scale, dropLine, halo }) {
  const openPath =
    'M11.2 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v3.4';
  const fold = '<path d="M14 2v5a1 1 0 0 0 1 1h5"/>';
  let els = badgeInner.match(/<(?:path|circle|rect|line|ellipse)\b[^>]*\/>/g) || [];
  if (dropLine && els.length > 2) els = els.slice(0, -1); // 小尺寸下减一行，避免糊成一片
  // 角标按 scale 反向补偿线宽：2 / scale 在缩放后仍是 2 个用户单位，与纸张线宽一致。
  // 不能用 vector-effect="non-scaling-stroke"：那会让角标在 14px 下保持 2px 屏幕线宽，比纸张粗近一倍、糊成一块。
  const badgeStroke = (2 / scale).toFixed(2);
  // 气泡类角标加一圈底色留白，避免与纸张断口线条糊在一起（底色取 --icon-halo，默认 #fafafa，深色或白色底由页面覆盖）
  const haloPath = halo
    ? `<path d="${(badgeInner.match(/<path d="([^"]+)"/) || [])[1] || ''}" fill="var(--icon-halo,#fafafa)" stroke="var(--icon-halo,#fafafa)" stroke-width="7"/>`
    : '';
  const badge = els.join('');
  return `<path d="${openPath}"/>${fold}<g transform="translate(12 12) scale(${scale})" stroke-width="${badgeStroke}">${haloPath}${badge}</g>`;
}

async function main() {
  const srcIdx = process.argv.indexOf('--src');
  const srcDir = srcIdx > -1 ? path.resolve(process.argv[srcIdx + 1]) : null;
  await fs.mkdir(OUT_DIR, { recursive: true });

  const manifest = {
    library: 'Lucide',
    version: VERSION,
    license: LICENSE,
    grid: GRID,
    strokeWidth: STROKE,
    svgSource: `https://unpkg.com/lucide-static@${VERSION}/icons/<name>.svg`,
    figmaSource: 'https://www.figma.com/community/file/983840782520404978/lucide-icons-full-collection-1767-icons',
    builtAt: new Date().toISOString(),
    groups: [],
    composites: COMPOSITES.map(({ key, badge, scale, use }) => ({ key, composedOf: ['file', badge], scale, use })),
  };

  let total = 0;
  for (const group of GROUPS) {
    const entries = [];
    const lines = [];
    for (const [key, name, use] of group.items) {
      const inner = normalize(await loadSvg(name, srcDir), name);
      lines.push(`  /* ${use} */\n  ${key}: '${wrap(inner)}',`);
      entries.push({ key, upstream: name, use });
      total++;
    }
    const body =
      `/* 原型${group.title} · 来源 Lucide ${VERSION}（${LICENSE} License，https://lucide.dev）\n` +
      ` * 取用：${manifest.svgSource}\n` +
      ` * Figma：${manifest.figmaSource}\n` +
      ` * 规则：24×24 网格、stroke-width ${STROKE}、currentColor；不得手写或自绘路径。\n` +
      ` * 生成：node scripts/build-icons.mjs --src <lucide-static>（勿手改本文件）\n` +
      ` */\nconst ${group.constName} = {\n` +
      lines.join('\n') +
      `\n};\n`;
    await fs.writeFile(path.join(OUT_DIR, group.file), body, 'utf8');
    manifest.groups.push({ file: group.file, constName: group.constName, count: entries.length, icons: entries });
  }

  // 组合图标并入 domain 文件
  const composites = [];
  for (const c of COMPOSITES) {
    const badgeInner = normalize(await loadSvg(c.badge, srcDir), c.badge);
    const svg = wrap(buildComposite(badgeInner, c));
    composites.push(`  /* ${c.use} */\n  ${c.key}: '${svg}',`);
    total++;
  }
  const domainPath = path.join(OUT_DIR, 'icons-domain.js');
  let domain = await fs.readFile(domainPath, 'utf8');
  domain = domain.replace(/\n\};\n$/, `\n\n  /* —— 组合图标：底形断角 + 角标缩放（见 references/图标库.md）—— */\n${composites.join('\n')}\n};\n`);
  await fs.writeFile(domainPath, domain, 'utf8');

  await fs.writeFile(path.join(OUT_DIR, 'icons.manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`已生成 ${total} 个图标 → ${OUT_DIR}`);
  for (const g of manifest.groups) console.log(`  ${g.file}: ${g.count}`);
  console.log(`  icons-domain.js 追加组合图标: ${composites.length}`);
}

main().catch((e) => {
  console.error('构建失败:', e.message);
  process.exit(1);
});
