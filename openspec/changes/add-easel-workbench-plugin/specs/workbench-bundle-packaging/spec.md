# Spec Delta

## Purpose

规定工作台 bundle 的打包与安装激活契约：宿主提供的运行时包只以 peer 依赖声明，安装必须物化为 profile 可解析的形式，安装结果以宿主接口可达为验收判据。

## ADDED Requirements

### Requirement: 宿主运行时包以 peer 依赖声明

bundle 的 `package.json` SHALL 只用 `peerDependencies` 声明由 DSH 宿主或其 profile 提供的运行时包（`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/cordis`），MUST NOT 把这些包写入 `dependencies`。

#### Scenario: 清单不把宿主包声明为 dependencies

- **WHEN** 检查 `dsh-plugins/easel-workbench/package.json`
- **THEN** `dependencies` 中不存在任何 `@deepseek-ai/*` 条目，宿主包出现在 `peerDependencies` 且带版本范围

#### Scenario: 客户端半边声明不受影响

- **WHEN** 检查同一份清单的 `dsh.client`
- **THEN** `platform` 仍为 `web`、`inject` 仍只列客户端包，构建产物仍只使用运行时提供的 specifier

### Requirement: 安装必须物化为 profile 可解析的形式

bundle SHALL 以物化方式安装（打包 tarball、git 规格或 registry），使插件位于 profile 的 `node_modules` 树内、其 peer 依赖可沿该树解析。以源码树 `link:` 安装时，SHALL 要求该源码树自带 `node_modules`；MUST NOT 把「源码树 `link:` 且无 `node_modules`」当作受支持状态。

#### Scenario: 安装后可从 profile 导入插件入口

- **WHEN** 在 profile 目录执行 `node --input-type=module -e 'await import("easel-workbench")'`
- **THEN** 导入成功，且导出包含 `apply`、`inject`、`name`、`Config`

#### Scenario: 依赖缺失在安装阶段即可发现

- **WHEN** profile 以源码树 `link:` 方式安装，而该源码树没有 `node_modules`
- **THEN** 安装自检报告「插件入口无法在 profile 解析」并以非零退出结束，MUST NOT 报告为安装成功

### Requirement: 宿主接口可达是激活的验收判据

安装完成后，SHALL 以「重启 DSH 后 `GET <API_PREFIX>/config` 返回 200 且响应体为 JSON」作为激活验收判据；MUST NOT 把「侧边栏出现工作台入口」或「面板可打开」当作激活成功的证据，因为客户端半边可在宿主半边缺失时独立渲染。

#### Scenario: 激活成功后宿主接口可达

- **WHEN** 重启 DSH 后请求 `GET /easel-workbench/api/config`
- **THEN** 返回 200、`content-type: application/json`，响应体含配置字段

#### Scenario: 宿主半边未激活时给出可判别的证据

- **WHEN** 请求 `GET /easel-workbench/api/config` 得到 0 字节且无响应体的 404
- **THEN** 该结果被判定为「宿主半边未挂载」，指引用户重载进程，而不是重试安装
