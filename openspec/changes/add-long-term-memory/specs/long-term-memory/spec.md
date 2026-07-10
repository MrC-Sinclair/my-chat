## ADDED Requirements

### Requirement: 记忆重要度筛选入库

系统 SHALL 在会话切换时对上一个会话触发重要度筛选入库流程：用 LLM 判断会话内消息的重要度，仅对重要消息调用 embedding 服务转向量并存入 `memory_vectors` 表。入库为 Workflow（消息持久化类），非 LLM 自主调用的工具。

#### Scenario: 会话切换触发归档

- **WHEN** 用户切换到另一个会话或新建会话
- **THEN** 系统对「上一个会话」异步调用 `POST /api/sessions/:id/archive-memory` 触发重要度筛选入库
- **AND** 归档异步执行，不阻塞用户在新会话中的对话

#### Scenario: 重要内容被筛选入库

- **WHEN** 归档流程判断某条消息包含值得长期记住的内容（如事实性信息、用户偏好、技术决策）
- **THEN** 系统调用 `BAAI/bge-m3` 对该消息内容生成 embedding
- **AND** 将 embedding、消息 ID、会话 ID、消息角色存入 `memory_vectors` 表

#### Scenario: 非重要内容不入库

- **WHEN** 归档流程判断某条消息为闲聊、一次性问题、无长期价值内容
- **THEN** 系统不对该消息生成 embedding
- **AND** 该消息不写入 `memory_vectors` 表

#### Scenario: 重复归档守卫

- **WHEN** 归档 API 被调用，且 `memory_vectors` 表已存在该会话的记录
- **THEN** 系统跳过归档流程，直接返回成功（幂等）
- **AND** 不重复调用 LLM 重要度判断和 embedding 服务

#### Scenario: 归档失败不阻断对话

- **WHEN** 归档流程中 LLM 重要度判断失败或 embedding API 报错
- **THEN** 系统记录错误日志，跳过失败的消息，继续处理其他消息
- **AND** 不向用户抛出错误，不影响对话主流程

### Requirement: 长期记忆检索工具（recall-memory）

系统 SHALL 提供 `recall-memory` Agent 工具，由 LLM 自主决定是否调用、检索什么内容。工具接收查询文本，经 embedding 检索 + 重排序精排后返回相关历史记忆。工具仅在模型支持工具调用（`caps.toolCalling`）时注册。

#### Scenario: LLM 自主调用检索历史记忆

- **WHEN** 用户提问涉及过去会话内容（如"我上周问过 SSRF 怎么做"），LLM 判断需要回忆
- **THEN** LLM 调用 `recall-memory` 工具，传入查询文本
- **AND** 工具返回与查询语义相关的历史消息内容及来源会话信息

#### Scenario: 检索结果经重排序精排

- **WHEN** `recall-memory` 工具被调用
- **THEN** 系统先用 `BAAI/bge-m3` 把查询文本转向量
- **AND** 在 `memory_vectors` 表做余弦相似度检索，召回 top-20
- **AND** 用 `BAAI/bge-reranker-v2-m3` 对召回结果重排序，返回 top-5

#### Scenario: 无相关记忆时返回空

- **WHEN** 检索结果为空（`memory_vectors` 表无数据或无相似内容）
- **THEN** 工具返回 `{ memories: [], message: "未找到相关历史记忆" }`
- **AND** 不抛出异常，由 LLM 决定如何回应

#### Scenario: 重排序失败降级

- **WHEN** 重排序 API 调用失败
- **THEN** 系统降级为仅返回 embedding 检索的 top-5 结果
- **AND** 记录警告日志，不中断检索流程

#### Scenario: 不支持工具调用的模型不注册检索工具

- **WHEN** 当前模型 `caps.toolCalling` 为 false（如 DeepSeek-R1、GLM-Z1）
- **THEN** `recall-memory` 工具不注册到 `toolsConfig`
- **AND** 该模型无法检索长期记忆（符合现有工具注册逻辑）

### Requirement: Embedding 服务

系统 SHALL 提供 embedding 服务，调用硅基流动 `BAAI/bge-m3` 模型把文本转为 1024 维向量。复用 `OPENAI_API_KEY` 鉴权。

#### Scenario: 文本转向量成功

- **WHEN** 系统调用 embedding 服务，传入非空文本（长度 ≤ 8K token）
- **THEN** 服务调用硅基流动 embedding API
- **AND** 返回 1024 维浮点数向量

#### Scenario: 长文本截断处理

- **WHEN** 传入文本超过 8K token
- **THEN** 服务截断文本至 8K token 后调用 API
- **AND** 记录警告日志标注截断发生

#### Scenario: Embedding API 失败

- **WHEN** 硅基流动 embedding API 返回非 200 状态码或网络超时
- **THEN** 服务返回 `{ error: "embedding 服务不可用", detail: <错误信息> }`
- **AND** 不抛出异常，由调用方决定降级策略

### Requirement: 向量存储表

系统 SHALL 在 PostgreSQL 中新建 `memory_vectors` 表存储记忆向量，使用 pgvector 扩展的 `vector(1024)` 类型存储 embedding。

#### Scenario: 向量入库

- **WHEN** 归档流程对某条重要消息完成 embedding
- **THEN** 系统向 `memory_vectors` 表插入一条记录，包含：`id`（UUID）、`message_id`（外键关联 `messages.id`，级联删除）、`session_id`（外键关联 `sessions.id`，级联删除）、`content`（消息文本快照）、`embedding`（1024 维向量）、`role`（消息角色）、`created_at`
- **AND** 插入成功后该消息可被检索

#### Scenario: 删除会话级联删除记忆

- **WHEN** 用户删除一个会话
- **THEN** `memory_vectors` 表中该会话的所有记忆记录被级联删除（`onDelete: 'cascade'`）
- **AND** 不残留孤立向量

#### Scenario: 向量检索

- **WHEN** `recall-memory` 工具传入查询向量
- **THEN** 系统在 `memory_vectors` 表执行余弦相似度检索（`ORDER BY embedding <=> query_vector`）
- **AND** 返回 top-20 结果（含 content、session_id、相似度分数）
