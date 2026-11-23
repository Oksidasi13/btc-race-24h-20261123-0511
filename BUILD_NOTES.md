# BUILD NOTES — One-Shot Trend Rider (btc-race-24h-20261123-0511)

## Strategy in plain words

The dev window (1,440 one-minute CBBTC bars, 24h) rises +3.64% overall, but
nearly all of it happens in the first 6 hours; the other 18 hours are flat chop
with 1-minute noise of ±0.08% (sd) and 177 flat bars. Every strategy that trades
often in that chop loses: each round trip costs ~26 bps (4 bps fee + 2 bps
slippage + constant-product pool impact), so buying tops and selling bottoms
bleeds the account dry.

This bot therefore trades **once**:

- **Indicators:** EMA(3) and EMA(9) on closes, seeded as the mean of the first
  `span` closes (the kit baselines' convention), updated incrementally O(1)
  per bar.
- **Warmup:** no trading for the first 20 bars. Warm-up batches (if the race
  opens with any) still feed the EMAs, so the averages are warm when the scored
  window starts; only orders are suppressed on them.
- **Entry:** the first bar (after warmup) where EMA(3) > EMA(9) — the fast
  average turning above the slow one, i.e. a confirmed recovery, not a dip
  caught while price is still falling. Buy 100% of cash, max slippage 200 bps.
- **Exit:** hard stop at -2% of cost, take-profit at +6% of cost, re-sent every
  bar while the condition holds (so a fill rejected by a gap past the slippage
  cap is retried on the next bar). Otherwise hold to the final flatten.
- **No re-entry:** once the position is exited, the bot never buys again.

**Parameters: 5** — EMA spans (3, 9), warmup bars (20), hard stop (200 bps),
take-profit (600 bps), max slippage (200 bps). No parameter grid was used to
pick them beyond comparing a handful of EMA pairs; every pair in (2,6)…(8,21)
with the same hold-to-end exit lands within +$32.2…+$35.8 on the dev window, so
the result is not a knife-edge optimum.

## What was rejected, and why

- **EMA cross-down / slow-EMA exits:** -$68 to -$197 on the dev window. The
  fast EMA flips constantly in 1-minute chop; every exit/re-entry pays the
  26 bps round trip.
- **Dip-buying / probe entries (RSI, Bollinger, recovery entries):** -$1 to
  -$48. Buying dips in chop buys tops and sells bottoms.
- **Trailing stops (0.8–1.5%):** worse than holding; the one variant that
  looked better (+$37.13) did so via a single lucky round trip around the
  bar-431 dip and was rejected as overfit.
- **A pure RSI dip-buy** scored marginally higher on dev (+$36.55 in the local
  backtester) but catches a falling knife: on a down-trending race window it
  would ride the decline into the -2% stop, while the trend entry simply stays
  in cash. Robustness on the window that pays beats $1 of dev-window PnL.

## Dev-window results (official harness, `grade-local --driver process`)

All numbers from the kit's own harness on the frozen dev window (1,440 bars),
each bot graded the same way. Sharpe is the harness's per-trade figure.

| Bot | Net PnL (USDC) | Trades | Max drawdown | Sharpe | Gate |
| --- | --- | --- | --- | --- | --- |
| **One-Shot Trend Rider (this entry)** | **+33.68** | 1 | 1.98% | 0.0289 | pass |
| momentum (baseline) | +34.94 | 1 | 1.98% | 0.0298 | pass |
| buy-and-hold (baseline) | +32.17 | 1 | 1.98% | 0.0274 | pass |
| hold-cash (baseline) | 0.00 | 0 | 0.00% | n/a | FAIL (no trade) |
| rsi-bollinger (baseline) | -9.32 | 10 | 2.06% | -0.0164 | FAIL (PnL < 0) |
| adx-momentum (baseline) | -11.20 | 24 | 4.16% | -0.0103 | FAIL (PnL < 0) |
| ema-cross (baseline) | -114.83 | 76 | 11.65% | -0.1090 | FAIL (PnL < 0) |

Honest caveat: this entry beats buy-and-hold by $1.51 and every active-trading
baseline by $43+, but the `momentum` baseline is $1.26 ahead on this window.
That gap is a timing coincidence, not a signal: momentum buys on fixed batch 24,
which happened to land inside this window's opening dip (bar 34 is the low).
A fixed-time entry has no edge on a fresh window, while the EMA cross-up entry
fires on a confirmed recovery whenever it happens — and stays in cash if it
never does. The entry's action log (buy bar 36, hold) is distinct from
buy-and-hold (buy bar 0) and momentum (buy bar 24), so it is not a copy of any
baseline's behaviour.

Dev-gate check for this entry: PnL +$33.68 > 0, 1 trade ≥ 1, max drawdown
1.98% ≤ 25% — **passes**.

## Two-half robustness check

Local backtester (same fill model: fill at next bar's open, 4 bps fee, 2 bps
slippage, pool impact vs the fill bar's open depth, final flatten at last close;
it reproduces the harness to within $1.79 on the total):

- Half 1 (bars 0–719): **+$33.03**
- Half 2 (bars 720–1439): **+$4.23**
- Both halves profitable — the result is not one lucky hour.

## Determinism

- `grade-local` runs the bot twice per grade ("grading: two executions") and
  reports **"L1 regrade reproduced byte for byte"**.
- After a genuine revision of `main.ts` (warm-up batches now feed the EMAs;
  see the header comment), the re-grade produced the identical
  `action_log_sha256 b19ec0c454335888d159b5b9d6cfdf1c31fe7432787da24cd62bd9818aced137`
  and identical PnL +$33.68 — the dev window has no warm-up bars, so the
  revision changes nothing there and everything on a window that does.
- No `Date.now()`, no `Math.random()`, no network, no environment reads.
  Per-batch work is O(1); the whole grade (two runs, 1,440 batches each)
  takes ~5 s, far inside the 1,800 s think budget. 0 orders rejected.

## How to grade locally

```sh
cd <kit dir>   # ~/workspace/makefun/btc-race-kit/btc-race-24h-20261123-0511-kit
node cli/makefun.mjs grade-local --kit . \
  --bot ~/workspace/makefun/btc-race-24h-20261123-0511-entry --driver process
```

Docker is not available on the build machine, so `--driver process` is used;
the score is otherwise identical (the note about the server running a
different Node version is expected and harmless).

## Files

| File | Size |
| --- | --- |
| `main.ts` | 6,344 bytes |
| `README.md` | 2,325 bytes |
| `LICENSE` | 1,097 bytes |
| `BUILD_NOTES.md` | this file |
| `vendor/makefun-bars.ts` | 20,543 bytes (kit SDK shim, byte-for-byte copy) |
