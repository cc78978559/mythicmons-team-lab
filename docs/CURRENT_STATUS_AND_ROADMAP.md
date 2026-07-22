# 当前正式版本、未完成功能与下一步计划

更新日期：2026-07-22

## 当前版本

- 正式运行代码基线：合并提交 `25e7d441bf9b6e870a591994f33d042feac14434`。
- 当前开发发布分支：`agent/unified-memory-evidence`。正式存档仍按内容指纹单独管理；开发分支提交不自动授权正式赛季升级。
- 正式联赛：MythicMons V12，30 名经理。
- 本地正式历史：S1–S21 连续；当前存档内部赛季 12 对应全局 S21，冠军为经理 15。
- 累计审计：9,214 场战斗、8,950 份阵容、0 fatal、0 warning；4 场超时全部完成裁定，合同归属无冲突，货币守恒。
- 正式存档位于本地 `output/`，不纳入 Git；仓库只保存代码、规则、测试与可复现命令。

## 已完成的正式功能

1. 人格化运营与对战，共享可审计人格、学习状态、战术记忆和血统。
2. 30 队跨赛季联赛：选秀、拍卖、阵容、合同、现金、稀缺资产、常规赛和季后赛。
3. 30 人开发联赛：多代繁殖、亲缘和人格相似度限制、学院培养、欠薪保障、财务健康和生命周期。
4. 同一王朝内自动 bottom-N 升降级，保留俱乐部资产、合同、现金、市场历史和赛季编号。
5. schema-v2 晋升包绑定源目录、存档哈希、种子、赛季、运行指纹、注册表和审计签名；拒绝重复包、重复子代和历史已录用血统。
6. 晋升事务压缩备份、原子替换、受保护回滚和 prepared 事务断电恢复。
7. 内容级审计签名：真实字节变化使缓存失效，纯时间戳变化不产生假警报。
8. 可续跑、幂等的正式赛季流水线：赛前审计、开发周期、晋升、下一赛季、赛后审计和全局历史更新。
9. S1 起连续的全局历史账本，拒绝冲突、缺季和重复赛季。
10. 默认回归套件覆盖白箱边界、开发生态、晋升、事务恢复、赛季流水线及 V9–V12 兼容性。
11. 决策级因果证据流水线：独立来源生成、严格领域抽样、单一决策反事实、阵容系列赛局部归因、终态压缩和留一来源学习。
12. 来源生成器与标签采样器均使用输出根互斥锁，避免后台任务或并行会话竞争写入可续跑清单。
13. 受影响测试选择器与紧凑全测入口已经落地：完整日志保存在本地，成功结果按传递源码哈希缓存；当前 50 个测试组加类型检查全部通过，未改动复跑可在秒级完成。
14. 正式赛季与统一证据流水线使用独立工作流锁；晋升后的开发联赛会自动保留哈希验证的压缩终态并删除高容量内部联赛目录。

## 最新开发结论

- 王朝 checkpoint 已采用哈希绑定的分层存储：当前状态保留在 `dynasty-state.json`，完整决策账本和进化档案进入内容寻址的 `.dynasty-state/*.json.gz`。旧版内嵌状态仍可读取，审计、晋升回滚、反事实和职业档案会在使用历史前验证并透明还原 sidecar。
- 下一赛季延续型反事实已采用统一的哈希检查点分支：实验组和对照组必须共享同一内容 ID，分支只复制续跑必需的主状态、季末摘要、当前注册表快照和引用档案，并在续跑后复核不可变前缀。S21 纯读取基准将受保护集合从全量历史的 29,373 个文件、约 1.90 GB 收缩到 43 个文件和约 3.5 MB（另加当前主状态），清单计算由约 19.8 秒降至 3.8 秒；正式 S21 未被改写，也未启动 S22。
- 新旅程从 `season-00` 起自动保存压缩季末状态和内容寻址的历史运行时包。同一代码版本只保存一次且不复制 `node_modules`；历史赛季 N 的报价反事实只有在 N-1 状态、N 赛季运行时、注册表、锁文件和 Showdown 版本全部匹配时才从 `requires-gate` 升为可执行。随访窗口现在会在代码升级点自动分段并切换到对应历史运行时，统一规划器也会识别注册表升级、在启动前验证完整随访跨度，并将报价任务限制在正式证据规范允许的最多四季。端到端测试已精确复现一个跨两版代码的两赛季旅程，并验证缺少后段检查点或档案篡改都会恢复门禁。回放片段自身跨越注册表或依赖版本切换时仍阻断；旧 S21 没有这些前瞻性档案，也仍保持阻断。
- PR 验证已支持四路确定性分片和跨提交逐测试缓存；本地完整检查入口保持不变，分片总和必须覆盖全部测试且只有第零分片执行全局类型检查。

- 阵容决策证据已扩展至 60 个独立来源、60 个隔离标签，全部使用直接系列赛结果归因；更好/中性/更差为 `9/37/14`。
- 两阶段模型分别学习“替换是否产生可见影响”和“影响方向”，所有预测均在同一来源整体留出的条件下产生。
- 决定性标签方向预测为 `15/23`（65.2%，`p=0.1050`），总体平方损失仅比中性基线改善 `3.69%`，影响概率校准仍差于发生率基线。
- 预设激活门槛未通过，结论保持 `no-predictive-signal`；没有任何学习系数进入正式 AI，也没有因为样本数量充足而自动激活。
- 同类样本继续扩容不再是近期重点。下一步应先证明更丰富的局面、对手和阵容结构输入能提供新的可泛化信息，再重新版本化模型。
- D22 只读预检已通过：当前 S21 审计和运行时签名匹配、D21 压缩来源有效、全局历史停在 S21、D22 目标不存在、可用空间为 `124.39 GB`。预检没有创建周期清单或修改正式存档。

## 尚未完成或尚未激活

### 1. 统一反事实证据采样器

已有统一入口及阵容、keeper、突变等专项工具，但还没有让所有 shadow 领域都具备同等成熟的局部归因、隔离重放和预测门槛。当前缺口已经从“缺少统一入口”转为“逐域补齐可靠因果结果和可泛化输入”。

第一阶段统一入口已经加入：它能够跨存档扫描运营、阵容、市场及保留下来的战斗 shadow 分歧，按领域和影响形成去重假设，同时保留各个种子可独立重放的精确副本；它会生成配置绑定、可续跑、受磁盘限制且带工作流互斥锁的证据清单，并只对已有隔离重放器和门禁的案例显式运行受限实验。结果按假设隔离聚合，同一种子最多贡献一个样本。阵容领域已完成 60 个独立来源的局部系列赛归因和留一来源学习复验，但未获得足够预测信号；战斗、战术记忆、跨赛季人格学习、语义策略程序进化、真实待激活谱系和单选补强现已具备统一清单与隔离回放。报价域已有顺序拍卖和组合拍卖的源重建、廉价筛选、单一干预验证、运行时迁移保护及续跑；正式 S21 组合拍卖筛选验证了 5 个优先案例，其中 2 个可执行。学院合同域已有完整账本重建和后续周期配对回放，D21 的 7 个合格案例全部竞争中性。当前缺口已转为跨独立来源积累正式证据，以及为历史检查点保存匹配运行时。详见 `docs/UNIFIED_COUNTERFACTUAL_EVIDENCE.md`、`docs/WHITE_BOX_AI.md` 和 `docs/STRATEGY_PROGRAM_EVOLUTION.md`。

### 2. 白箱决策全面接管

白箱层覆盖对战、阵容、keeper、补强、注册、报价、市场流、学习、进化和记忆，但多个域仍为 `shadow`：正式行为继续使用稳定的现行启发式，白箱只记录替代选择。这是证据门禁，不是运行故障。

### 3. 顶级联赛主动间断式突变

压力状态机、候选生成、冷却和审计已经实现，但正式联赛仍使用 `V12_EVOLUTION_POLICY=shadow`。已有孤立样本没有证明突变稳定改善结果，因此尚未授权实际替换人格。

### 4. 策略程序结构多样性

解释器、交叉和突变存在，但当前 30 名正式经理仍只有一种五节点常量程序。人格参数、后验和记忆已经分化，程序基因尚未形成有效多样性。

### 5. 学院真实转会市场

学院市场能够生成自由签约、永久转会、租借、同意、合同报价、紧急出售和财务干预证据，但正式默认仍为 `shadow`，不会实际改变学院资金和归属。

### 6. 无人值守调度与异盘备份

单个正式周期已经一键、可续跑且幂等，统一证据任务和正式赛季均有输出/磁盘余量门禁，正式周期也会自动压缩开发联赛。仍需操作员启动每一季；尚未配置长期调度或异盘/云端复制。GitHub 不承担数 GB 比赛证据的备份职责。

### 7. 升降级附加赛（可选规则）

当前是体育联盟式直接升降级：开发联赛 fitness 前 N 名替换顶级联赛后 N 名。尚未提供跨级别附加赛；若需要证明候选能直接击败降级经理，应另做强度校准。

## 下一步计划

### 阶段 A：统一反事实采样

1. **已完成（阵容域）**：独立来源生成、严格阵容抽样、相同前缀单一决策分叉、直接系列赛归因和 60 来源复验。
2. **已完成（报价与学院合同的工作流级验证）**：正式 S21 组合报价筛选和 D21 合同配对回放；两者仍需跨独立来源证据。
3. 继续扫描对战、交易、学习、记忆和突变域，去除重复及低影响样本；历史重放必须绑定匹配运行时。
4. 先运行相关比赛或单赛季；只有通过廉价门禁的候选才进入 2–4 季跟踪。
5. 为每个新领域复用可续跑、磁盘限制、终态压缩、来源去重和输出根互斥能力。

### 阶段 B：证据门槛

- 工作流验证：至少 3 个配对案例。
- 初步判断：至少 10 个配对、5 个独立种子。
- 正式激活候选：建议至少 30 个配对、10 个独立种子。
- 所有级别要求 0 规则错误、0 经济破坏、0 非法阵容和可重放前缀。
- 结果接近中性或跨种子不稳定时继续保持 shadow，不因样本数量自动激活。

### 阶段 C：逐域激活

1. 优先评估局部、可回滚的阵容和补强决策。
2. 再评估 keeper、报价和合同类跨赛季决策。
3. 对战选择使用独立比赛级门禁，不能只看冠军。
4. 人格突变至少跟踪 2–4 季，并检查风格多样性和冠军集中度。
5. 学院真实市场最后激活，单独验证欠薪、财务恢复、同意和资金守恒。

### 阶段 D：运行保障

1. 配置正式 `output/` 的异盘增量备份。
2. 在已有存档级磁盘门禁基础上评估可选周期调度，但保留代码升级的人工授权。
3. 每季继续更新内容审计与全局历史账本。

## 继续正式赛季

```powershell
npm run official-season-cycle -- `
  --major-source output/official-era-02/league `
  --development-out output/official-development-season-22 `
  --previous-development output/official-development-season-21 `
  --promotion-slots 3 `
  --cycle-id after-global-s21 `
  --global-season-offset 9 `
  --history-ledger output/official-era-02/official-history-ledger.json
```

只有审阅后的运行代码发生变化时，才在首次续跑额外添加 `--allow-code-upgrade`。
# 2026-07-21 bid-evidence update

- Sequential auctions now support a gated, isolated `unshaded-ceiling-experiment`: only a source loser whose retained legal ceiling strictly beats the source leader is replayable, and the branch must contain exactly one changed bid.
- A deterministic 6-manager smoke source produced 45 shaded bid cases; 5 were outcome-changing candidates. An exact `17 -> 19` replay passed source-prefix and one-intervention verification.
- The retained formal S21 archive uses portfolio auctions. It contains 13,192 shaded bid replicas, all correctly classified `requires-gate`; no formal-season replay was launched.
- At that checkpoint, remaining auction work was portfolio-specific: replay the complete constrained allocation, verify every changed award/payment, and aggregate effects across all displaced managers. The sequential runner was not reused for that task; the update below records its dedicated implementation.

## 2026-07-21 portfolio-bid evidence update

- The portfolio-specific replay route is now implemented. It reconstructs source solver inputs from retained season files and rejects any source whose winners, prices, runner-up bids, budgets, or win limits do not reproduce exactly.
- Deep screening is explicit and bounded. Unified planning consumes a source-hash-bound screen artifact instead of silently rerunning the global solver for thousands of bids.
- Formal S21 season 12 reconstruction matched 60 assets, 1,783 positive bids, 30 manager limits, and 28 awards. The cheap gate found 176 screenable bids.
- The first 5 prioritized deep screens completed in 11.948 seconds: 2 changed the global allocation and 3 were solver-confirmed no-ops. One change added a previously unawarded asset; the other caused a three-asset allocation chain.
- Those 2 cases are now `executable` in unified evidence schema v4; the remaining 13,190 retained replicas stay `requires-gate`. No formal dynasty branch has been launched and no production bid policy has changed.
