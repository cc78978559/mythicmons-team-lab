# 魔改配置并行协作说明

本说明供只负责修改魔改宝可梦配置的并行会话使用。联盟程序与配置编辑可以同时进行，双方不需要互相等待，但必须遵守下面的发布边界。

## 允许修改的范围

配置会话原则上只修改：

```text
data/draft/g1-six-team.json
data/draft/g2-six-team.json
data/draft/g3-six-team.json
data/draft/g4-six-team.json
data/draft/g5-six-team.json
data/draft/g6-six-team.json
```

如某项机制必须修改编译器或战斗引擎，应停止把它视为“纯配置修改”，单独说明代码改动与测试影响，不要顺手修改联盟经济、AI、存档或赛季代码。

## 稳定身份规则

- 已存在魔改宝可梦的 `member.id` 是永久身份，不得因改名、改属性或平衡调整而改变。
- 不得删除已经进入联盟资产历史的 `member.id`。需要退役时应提出退役迁移，而不是直接删行。
- 六个世代中的成员 ID 必须全局唯一。
- 自定义招式、特性和道具 ID 分别全局唯一，不允许依赖“后面的文件覆盖前面的文件”。
- 调整展示名、种族值、属性、努力值、性格、特性、道具和招式时，保持原有 ID。

## 修改后的必做检查

在项目根目录运行：

```powershell
npm.cmd run registry:validate
npm.cmd run typecheck
npm.cmd run test:regressions
```

`registry:validate` 会输出配置哈希、六个文件的独立哈希和成员总数。任何重复 ID、未知宝可梦、未知属性、非法数值、未知招式/特性/道具或生成代码语法错误都会阻止发布。

## 与正在运行的联盟如何隔离

- 联盟启动时会把六个配置文件冻结到 `output/<联盟>/config-snapshots/<hash>/`。
- 后续赛季读取冻结快照，不读取正在编辑的 `data/draft`。
- 配置哈希会生成独立 Showdown 模组 ID，例如 `mythicmons9da1401f9b5d`。
- 不同配置版本可以在不同输出目录并行运行，不会覆盖同一个模组。
- 同一个联盟输出目录有 `.run.lock`，同时启动第二个写入进程会直接失败。
- 不要手工修改或删除 `config-snapshots`、`.run.lock`、`dynasty-state.json`。

## 新配置何时进入联盟

新联盟自动采用启动时的当前配置。已有联盟默认继续使用旧快照，即使 `data/draft` 已经发生变化。

需要在下一赛季显式采用新配置时，由联盟会话运行：

```powershell
$env:V12_RESUME="true"
$env:V12_ADOPT_REGISTRY="true"
$env:V12_REGISTRY_REVISION="2026.07.13.1"
npm.cmd run draft-league-v12
```

不设置 `V12_ADOPT_REGISTRY=true` 就不会把工作区的新配置带入已有联盟。采用操作会在联盟决策账本中记录旧哈希、新哈希和版本名。

如果联盟存档创建于快照机制加入之前，第一次续档同样需要设置 `V12_ADOPT_REGISTRY=true`。程序会先按旧算法核对全部配置和基准数据；只有内容与旧存档指纹一致才允许迁移，随后保存快照。完成这一次后，后续续档恢复默认设置即可。

## 配置会话的交付格式

完成修改时，请向主会话提供：

1. 修改了哪些稳定 `member.id`。
2. 每只宝可梦的行为变化摘要。
3. 是否新增自定义招式、特性或道具 ID。
4. `registry:validate` 输出的完整配置哈希。
5. 已运行的测试及结果。
6. 是否建议现有联盟立即采用，还是仅供下一次新联盟使用。

不要只说“配置已更新”。主会话需要依据哈希决定是否执行正式采用。

## 冲突处理

如果两个会话同时修改同一个 JSON 文件，应以 `member.id` 为单位人工合并，合并后重新运行全部配置检查。不要用整文件覆盖解决冲突，因为那会悄悄丢掉另一会话对其他成员的修改。

如果运行因 `.run.lock` 中断，先确认其中 PID 对应的进程已经退出。只有确认没有活跃联盟进程后才能删除陈旧锁文件。
