# Spec Delta

## Purpose

让选择该 agent preset 的会话获得 Easel 的创作者身份与操作规则，而其他会话完全不受影响，同时避免与 DSH 自身的提示词注册发生冲突。

## ADDED Requirements

### Requirement: 提供 easel agent preset

系统 SHALL 提供一个标识为 `easel` 的 agent preset，其组装内容 SHALL 包含创作者人设、Easel 操作规则与技能提供方。该 preset SHALL 可被 DSH 的会话创建入口选择，且选择该 preset 的会话 SHALL 获得上述全部内容。

#### Scenario: preset 可在会话创建时选择

- **WHEN** 用户在 DSH 中创建会话并查看可选的 agent preset
- **THEN** 列表中出现标识为 `easel` 的预设，并带有可读的名称与描述

#### Scenario: 选择该 preset 的会话获得创作者身份

- **WHEN** 用户使用 `easel` preset 创建会话并发送一条普通消息
- **THEN** 该会话的系统提示词包含创作者人设文本与操作规则段

### Requirement: 人设挂载在 preset 组装内部

人设 SHALL 在 preset 组装内部以 agent 作用域挂载，使其只作用于该 preset 的会话。系统 MUST NOT 在全局作用域挂载该人设。

#### Scenario: preset 内挂载不产生注册冲突

- **WHEN** 部署加载包含该人设的 agent preset
- **THEN** 加载成功，且不出现与部署级人设前缀注册相冲突的错误

#### Scenario: 未选择该 preset 的会话不受影响

- **WHEN** 用户使用 DSH 默认 preset 创建会话
- **THEN** 该会话的系统提示词不包含 Easel 的创作者人设文本

### Requirement: 创作者操作规则作为系统提示词段

系统 SHALL 把 Easel 的操作规则作为一段独立的系统提示词段注入，且 SHALL 只包含 DSH 未原生承担的部分。规则段 SHALL 至少涵盖：先按技能库路由任务、先读取现有信息再提问、付费操作先确认、以真实产物作为完成判据、以及产物落盘与命名约定。规则段 MUST NOT 包含模型选择、会话存储或工具调用方式相关的条目。

#### Scenario: 规则段包含技能路由与产物约定

- **WHEN** 检查使用该 preset 的会话的系统提示词
- **THEN** 其中存在一段说明技能路由、信息优先、付费确认与产物落盘约定的规则

#### Scenario: 规则段不含已被 DSH 承担的条目

- **WHEN** 检查该规则段的内容
- **THEN** 其中不包含如何选择模型、如何存储会话或如何调用工具的说明

### Requirement: 人设文本可随部署调整

人设文本与操作规则 SHALL 来自插件可配置的内容来源，使部署方能够在不修改插件代码的前提下替换人设或增补规则段落。

#### Scenario: 替换人设后新会话生效

- **WHEN** 部署方修改了人设文本来源并新建一个使用该 preset 的会话
- **THEN** 新会话使用修改后的人设文本，已存在的会话不受影响
