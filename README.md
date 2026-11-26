# pumpfun-paper-sprint-bot

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/razif200618-coder/pumpfun-paper-sprint-bot/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/razif200618-coder/pumpfun-paper-sprint-bot/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

An early-bird paper-trading bot for pump.fun: it buys young bonding curves as soon as the size cap allows a meaningful buy, holds them only briefly, and exits on a tight take-profit (+20%), a trailing stop (-6%), a hard stop (-8%), or a time stop (1,000 slots). The idea, calibrated on the dev window: pump.fun coins make almost all of their move in the first minutes after creation, and the 2-slot fill latency eats the top of every spike — so the bot enters young, banks small wins fast, and uses a tight buy-slippage cap (5%) so spiking entries are rejected instead of filled at the top. One entry per coin, at most 5 open positions, 0.05 SOL per buy. Deterministic: bigint arithmetic on the curve reserves only, no clock, no randomness, no network.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vnv5dw3z&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
