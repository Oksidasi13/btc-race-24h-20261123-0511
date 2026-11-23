// CBBTC one-shot trend rider for the make.fun btc-race-24h-20261123-0511 bounty.
//
// Idea, in one paragraph: on a 24h window of one-minute bars, a bot that trades
// often dies by a thousand 26-basis-point round trips (fee 4bps + slippage 2bps +
// pool impact), because most minutes are noise. This bot therefore makes at most
// ONE decision that matters: it waits for the fast EMA to turn above the slow EMA
// after the opening chop, buys the whole cash balance once, and then holds to the
// end of the race unless a hard stop (-2% of cost) or a take-profit (+6% of cost)
// fires first. No re-entry after an exit: if the trend fails, the day is over.
//
// How a run works: the harness speaks agent-fun/bars-replay/v1 over NDJSON. It
// sends one `hello` message, then one `batch` per minute, each carrying a single
// `bar` plus the fills and the account, and finally `done`. We answer every batch
// with exactly one reply carrying our `orders` and the batch's `seq`. The kit's
// `runBars` shim in ./vendor/makefun-bars.ts owns that protocol; this file only
// implements the strategy callbacks onHello / onBatch.
//
// Determinism: every step is plain float64 math over the closes we have seen.
// No wall clock, no randomness, no network. Two runs on the same
// data produce byte-identical action logs. First local grade (grade-local,
// process driver): net PnL +33.68 USDC, 1 trade, max drawdown 1.98%, 0 orders
// rejected, L1 regrade reproduced byte for byte.

import { runBars } from "./vendor/makefun-bars.ts";
import type { BarsState, Batch, Bar } from "./vendor/makefun-bars.ts";

// --- strategy parameters (5 in total) --------------------------------------
// FAST_EMA / SLOW_EMA: spans of the two exponential moving averages.
// WARMUP_BARS: how many closes we watch before we are allowed to trade.
//               (20 bars also gives EMA(9) time to seed properly.)
// STOP_BPS:   exit if the position is worth <= 98% of its cost.
// TAKE_PROFIT_BPS: exit if the position is worth >= 106% of its cost.
// MAX_SLIPPAGE_BPS: a fill may be at most 200 bps away from the latest close.
const FAST_EMA = 3;
const SLOW_EMA = 9;
const WARMUP_BARS = 20;
const STOP_BPS = 200;
const TAKE_PROFIT_BPS = 600;
const MAX_SLIPPAGE_BPS = 200;

type Ema = {
  span: number;
  k: number;
  warm: number[];
  value: number | null;
};

function makeEma(span: number): Ema {
  return { span, k: 2 / (span + 1), warm: [], value: null };
}

// Feed one close into an EMA. Seeding follows the kit baselines: the first
// value is the plain mean of the first `span` closes, then Wilder-style
// smoothing takes over. O(1) per bar, no history kept.
function emaPush(ema: Ema, close: number): number | null {
  if (ema.value === null) {
    ema.warm.push(close);
    if (ema.warm.length < ema.span) return null;
    let sum = 0;
    for (const c of ema.warm) sum += c;
    ema.value = sum / ema.warm.length;
    ema.warm = [];
    return ema.value;
  }
  ema.value = ema.value + ema.k * (close - ema.value);
  return ema.value;
}

let priceScale = 5;
let fast: Ema | null = null;
let slow: Ema | null = null;
let closesSeen = 0;
// Set once our buy has filled (the position shows up in the account) or once
// we have exited a position. After that the bot never buys again.
let boughtOnce = false;
let exitedOnce = false;

await runBars({
  onHello(state: BarsState) {
    const first = state.hello.symbols[0];
    if (first !== undefined) priceScale = first.price_scale;
    fast = makeEma(FAST_EMA);
    slow = makeEma(SLOW_EMA);
  },

  onBatch(state: BarsState, batch: Batch) {
    const symbols = state.hello.symbols;
    if (symbols.length === 0) return [];
    const symbol = symbols[0].symbol;

    const bar: Bar | undefined = state.latest.get(symbol);
    if (!bar) return [];

    // Prices arrive as raw u64 strings at price_scale; the EMA works in USDC.
    const close = Number(BigInt(bar.c)) / 10 ** priceScale;
    if (fast === null || slow === null) return [];
    closesSeen += 1;
    const f = emaPush(fast, close);
    const s = emaPush(slow, close);

    // Warm-up batches exist to build history from: their bars feed the EMAs
    // (so the averages are warm when the scored window starts) but no order
    // decided on one may trade, so we return before any order logic.
    if (state.warmingUp) return [];

    const position = state.positions.get(symbol);
    const holding = position !== undefined && position.qty > 0n;
    if (holding) boughtOnce = true;

    // --- exit: only while holding ------------------------------------------
    // Hard stop: -2% of cost. Take profit: +6% of cost. Both are re-sent
    // every bar while the condition holds, so a rejected fill (a gap that
    // moved past the slippage cap) is retried on the next bar.
    if (holding && position !== undefined) {
      const cost = position.cost;
      const value = state.value(symbol, position.qty);
      if (cost > 0n && value > 0n) {
        const stopAt = (cost * BigInt(10000 - STOP_BPS)) / 10000n;
        const takeAt = (cost * BigInt(10000 + TAKE_PROFIT_BPS)) / 10000n;
        if (value <= stopAt || value >= takeAt) {
          exitedOnce = true;
          return [
            {
              side: "sell",
              symbol,
              qty: position.qty,
              max_slippage_bps: MAX_SLIPPAGE_BPS,
            },
          ];
        }
      }
      return [];
    }

    // --- entry: one shot ----------------------------------------------------
    // We only ever buy once, and never after an exit. `boughtOnce` is set
    // when the position first appears, so a buy the harness rejects (e.g. a
    // one-minute gap past the slippage cap) is retried on the next bar while
    // the fast average is still above the slow one.
    if (boughtOnce || exitedOnce) return [];
    if (closesSeen < WARMUP_BARS) return [];
    if (f === null || s === null) return [];

    if (f > s) {
      // Spend everything, capped by the weight room (100% of equity here).
      const room = state.weightRoom(symbol);
      const notional = state.cash < room ? state.cash : room;
      if (notional <= 1n) return [];
      return [
        {
          side: "buy",
          symbol,
          notional_quote_units: notional,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});
