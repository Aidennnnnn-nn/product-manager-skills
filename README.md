# 产品经理工作 Skills

这是一组面向产品经理工作的 Codex Skills，覆盖个人产品工作标准、中文功能型 PRD 和 HTML/Figma 产品原型。

当前版本：`V1.0`

## 包含的 Skills

| Skill | 用途 |
| --- | --- |
| `product-work-standards` | 区分个人标准、项目规范和当前任务要求，并路由到适用的专项 Skill |
| `pm-execution-create-prd` | 创建、补写和评审可进入原型、研发与验收评审的中文功能型 PRD |
| `pm-prototype-workflow` | 以 HTML 为设计源完成 UI、交互、状态覆盖和可编辑 Figma 原型交付 |

三个 Skill 均按跨项目、可公开阅读和可独立安装的方式维护，不包含特定公司、品牌、项目目录、内部账号、私有链接或未脱敏业务数据。

## 安装

克隆仓库：

```bash
git clone https://github.com/Aidennnnnn-nn/product-manager-skills.git
```

复制需要的 Skill 到 Codex Skills 目录：

```bash
mkdir -p ~/.codex/skills
cp -R product-manager-skills/product-work-standards ~/.codex/skills/
cp -R product-manager-skills/pm-execution-create-prd ~/.codex/skills/
cp -R product-manager-skills/pm-prototype-workflow ~/.codex/skills/
```

重新打开 Codex 会话后，可自动匹配任务，也可以显式调用：

```text
使用 $product-work-standards 判断这项规则属于个人标准还是项目规范。
使用 $pm-execution-create-prd 创建一份可评审、可开发、可验收的中文 PRD。
使用 $pm-prototype-workflow 根据已确认 PRD 制作可交互 HTML 原型。
```

## 默认工作流

```text
目标与范围确认
  -> PRD Draft
  -> 用户确认 PRD
  -> HTML 原型 Draft
  -> 用户确认 HTML
  -> 写入可编辑 Figma 原型
  -> 截图与结构回读
```

项目根目录的规则和用户当前明确要求始终优先。项目专属品牌、菜单、业务对象、权限边界、目录结构和文件命名应保留在项目内，不应直接写入这些通用 Skills。

## 版本规则

- 当前公开版本为 `V1.0`，对应 Git Tag `v1.0`。
- 普通内容维护不自动改变版本号。
- 只有维护者明确决定后，才创建新的版本 Tag 或 GitHub Release。
- 发布前必须检查 Frontmatter、内部引用、私有路径、敏感信息和项目专属内容。

## 依赖说明

- 需要支持 Skills 的 Codex 环境。
- PRD 中需要复杂业务图示时，可配合 `archify` 和 `drawio` Skills；环境中没有这些依赖时，应保留 Mermaid 语义源并说明未生成的附件。
- Figma 交付需要可用的 Figma 桌面端、本地插件或官方 Figma MCP，具体路径由 `pm-prototype-workflow` 和当前项目规则决定。

## 仓库结构

```text
product-manager-skills/
├── README.md
├── VERSION
├── CHANGELOG.md
├── product-work-standards/
├── pm-execution-create-prd/
└── pm-prototype-workflow/
```
