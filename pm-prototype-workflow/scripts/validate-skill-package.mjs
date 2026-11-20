#!/usr/bin/env node
/** 验证 pm-prototype-workflow 包内资源、相对引用和模板契约。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'SKILL.md',
  'agents/openai.yaml',
  'assets/个人风格Token.json',
  'assets/个人风格组件契约.json',
  'assets/icons.js',
  'assets/icons.manifest.json',
  'references/个人风格原型模板.html',
  'references/个人风格组件状态样例.html',
  'references/个人风格UI与交互规范.md',
  'scripts/audit.mjs',
];
const issues = [];
for (const rel of required) {
  try { await fs.access(path.join(root, rel)); } catch { issues.push(`缺少文件：${rel}`); }
}
const read = async (rel) => fs.readFile(path.join(root, rel), 'utf8');
let contract, manifest, tokens, template, componentSample;
try { contract = JSON.parse(await read('assets/个人风格组件契约.json')); } catch (e) { issues.push(`组件契约不可解析：${e.message}`); }
try { manifest = JSON.parse(await read('assets/icons.manifest.json')); } catch (e) { issues.push(`图标清单不可解析：${e.message}`); }
try { tokens = JSON.parse(await read('assets/个人风格Token.json')); } catch (e) { issues.push(`Token 不可解析：${e.message}`); }
try { template = await read('references/个人风格原型模板.html'); } catch {}
try { componentSample = await read('references/个人风格组件状态样例.html'); } catch {}
if (contract && template) {
  const names = [...template.matchAll(/data-component="([^"]+)"/g)].map((m) => m[1]);
  for (const name of new Set(names)) if (!contract.components?.[name]) issues.push(`模板组件未登记：${name}`);
  for (const m of template.matchAll(/data-component="([^"]+)"[^>]*data-variant="([^"]+)"/g)) {
    const [_, name, variant] = m;
    if (!contract.components?.[name]?.variants?.includes(variant)) issues.push(`模板变体未登记：${name}/${variant}`);
  }
  if (!template.includes('data-style-profile="personal"')) issues.push('个人模板缺少 personal 档案标记');
  if (/<(?:script|link|img|source)[^>]+(?:src|href)=["']https?:\/\//i.test(template)) issues.push('个人模板包含外部资源');
}
if (manifest) {
  for (const group of manifest.groups || []) {
    const source = await read(`assets/${group.file}`);
    for (const icon of group.icons || []) {
      if (!source.includes(`${icon.key}: '<svg`)) issues.push(`图标清单未在 ${group.file} 找到：${icon.key}`);
    }
  }
}
if (componentSample && (!componentSample.includes('data-component=') || /<(?:script|link|img|source)[^>]+(?:src|href)=['"]https?:\/\//i.test(componentSample))) issues.push('组件样例缺少组件标记或包含外部资源');
if (tokens && (!tokens.css || Object.keys(tokens.css).length < 10)) issues.push('个人 Token 数量异常');
const result = { root, requiredFiles: required.length, issues, result: issues.length ? '失败' : '通过' };
console.log(JSON.stringify(result, null, 2));
process.exit(issues.length ? 1 : 0);
