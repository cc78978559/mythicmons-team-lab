# 低 Token 赛季汇报流程

赛季模拟、完整决策和战报始终保存在本地。默认汇报只读取每季的 `season-brief.json`，不读取 `season.json`、`decision-ledger.json` 或逐场战报。

## 生成简报

```powershell
npm.cmd run season:brief -- --out output/draft-league-v12 --season latest
```

命令只向终端输出一行指标。完整的紧凑输入位于：

```text
season-NN/season-brief.json
season-NN/season-brief.md
season-NN/token-budget.json
```

## 默认读取规则

1. 常规赛季汇报只读取 `season-brief.json`。
2. 不因成员使用率低而调整经理评分或决策。
3. 只有技术审计失败或用户指定专项时，才读取详细文件。
4. 专项调查只读取相关经理、宝可梦或系列赛，不展开全季数据。
5. 完整产物继续保留在本地，简报裁剪不删除任何证据。

## 预算

- 简报硬上限：8,000 字符。
- 推荐模型输入：约 1,500 token。
- 推荐回复：不超过 800 token。
- 标准单季目标：1,500 到 2,500 token。

`token-budget.json` 记录当前简报长度、估算 token、默认输入文件和默认排除文件。估算用于控制规模，不代表平台账单的精确计数。

如果两个赛季之间仅升级了联盟程序，续档会被代码指纹保护拦截。确认升级内容后可执行一次显式迁移：

```powershell
$env:V12_ALLOW_CODE_UPGRADE="true"
$env:V12_RESUME="true"
npm.cmd run draft-league-v12
```

该开关只允许代码哈希变化；配置、基准、依赖和 Showdown 版本仍必须一致。迁移会记录在永久决策账本中，完成后应取消开关。
