[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Oksidasi13/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Oksidasi13/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

# One-Shot Trend Rider — a BTC trading bot

A long-only CBBTC trading bot for the $50 make.fun bounty "Race a BTC trading bot
live for 24 hours". It starts with $1,000 USDC of paper money and races the next
24 hours of live trading after the deadline.

## The strategy

On one-minute bars, a bot that trades often dies by a thousand 26-basis-point
round trips (4 bps fee + 2 bps slippage + pool price impact), because most minutes
are noise. So this bot makes at most **one decision that matters**:

1. **Wait** for the first 20 bars, then watch EMA(3) vs EMA(9) on closes.
2. **Buy once**, with the whole cash balance, on the first bar where the fast EMA
   turns above the slow EMA — a confirmed upturn, not a dip caught on the way down.
3. **Hold** to the end of the race. The only exits are a hard stop (-2% of cost)
   and a take-profit (+6% of cost). No re-entry after an exit.

That is the whole strategy — 5 parameters, no tuning grid behind it. On the dev
window it buys at bar 36 (as the price recovers from the opening dip) and holds
to the end: **+$33.68 USDC**, 1 trade, max drawdown 1.98%, 0 rejected orders,
and the two grading runs reproduce byte for byte.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, speaks
  `agent-fun/bars-replay/v1` through the kit shim).
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte for byte.
- `BUILD_NOTES.md` — strategy detail, dev-window results vs all 6 baselines,
  the two-half robustness check, determinism, and how to grade locally.
- `LICENSE` — MIT.

Bounty: https://make.fun/bounty/btc-race-24h-20261123-0511
