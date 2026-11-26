// pumpfun-paper-sprint-bot: an original early-bird bot for agent-fun/replay/v2.
//
// Idea (calibrated on the dev window: 1,222 coins, 24h): pump.fun coins make almost all of
// their move in the first minutes after creation — buying the first trade and holding ~100
// slots averages +38% (median -0.3%), while buying AFTER a fast rise loses on average
// (-16% over the next 300 slots: the rise IS the top, mean reversion follows). So this bot
// does the opposite of a momentum chaser: it buys young coins as soon as the size cap lets
// it place a meaningful buy, holds them only briefly, and gets out on a time stop. No price
// filter, no trend filter — youth is the signal. One entry per coin, at most 5 open
// positions, 0.05 SOL per buy. Everything is bigint arithmetic on the curve reserves the
// harness delivers; no clock, no randomness, no environment, no network — the run is fully
// deterministic from the hello seed and the batch stream.
//
// Guardrails it is built to meet: round trips of at least 0.01 SOL on at least 20 distinct
// mints (stake is 0.05 SOL), max drawdown far under 50% (at most 5 x 0.05 SOL deployed).

import { LAMPORTS_PER_SOL, runBot, type BuyInput, type SellInput } from './vendor/makefun-bot.ts';

/** SOL staked per buy (0.05 SOL). */
const STAKE_LAMPORTS = LAMPORTS_PER_SOL / 20n;
/** Smallest buy we will place: the round-trip bar is 0.01 SOL, keep a margin above it. */
const MIN_BUY_LAMPORTS = (LAMPORTS_PER_SOL * 12n) / 1000n;
/** A coin is only enterable this many slots after its CreateEvent: youth is the signal. */
const MAX_ENTRY_AGE_SLOTS = 200;
/** Entry needs at least this many trades observed on the coin. */
const MIN_TRADES_TO_ENTER = 1;
/**
 * Sell everything at this gain (bps) over the entry price. Tight on purpose: the dev data
 * shows the 2-slot fill latency eats the top of every spike, so the bot banks small wins
 * quickly instead of waiting for the rare mooner.
 */
const TAKE_PROFIT_BPS = 2000n;
/** Sell everything at this loss (bps) under the entry price. */
const STOP_LOSS_BPS = 800n;
/** Sell everything when the price falls this much (bps) below its peak since entry. */
const TRAIL_BPS = 600n;
/**
 * Sell everything this many slots after entry, win or lose. Short on purpose: the dev data
 * shows the early pump fades fast (buy-first-trade returns fall from +45% at 100 slots to
 * +39% at 1,000 slots, and the win rate halves), so the bot banks the first minutes only.
 */
const MAX_HOLD_SLOTS = 1000;
/** Slippage allowance on buys / sells (bps). Buys are wide so fast pumps still fill;
 * sells are wide open so exits always execute. */
const BUY_SLIPPAGE_BPS = 500;
const SELL_SLIPPAGE_BPS = 10_000;

const BPS = 10_000n;

interface Track {
  createdSlot: number;
  /** First observed reserves (creation, or the first trade that introduced the coin). */
  firstQ: bigint;
  firstT: bigint;
  trades: number;
  buySol: bigint;
  sellSol: bigint;
  /** True once a buy was sent (or the coin aged out / completed). */
  decided: boolean;
  /** Entry reserves and slot, once bought. */
  entryQ: bigint;
  entryT: bigint;
  entrySlot: number;
  /** Peak reserves since entry, as a price ratio (peakQ / peakT). */
  peakQ: bigint;
  peakT: bigint;
}

const tracks = new Map<string, Track>();

/** Compare priceA (qA/tA) against priceB (qB/tB) scaled by bps: true when A >= B * (10000+bps)/10000. */
function priceAtLeast(qA: bigint, tA: bigint, qB: bigint, tB: bigint, bps: bigint): boolean {
  return qA * tB * BPS >= qB * tA * (BPS + bps);
}

/** True when priceA <= priceB * (10000-bps)/10000. */
function priceAtMost(qA: bigint, tA: bigint, qB: bigint, tB: bigint, bps: bigint): boolean {
  return qA * tB * BPS <= qB * tA * (BPS - bps);
}

function trackFor(mint: string, slot: number): Track {
  let t = tracks.get(mint);
  if (t === undefined) {
    t = {
      createdSlot: slot,
      firstQ: 0n,
      firstT: 0n,
      trades: 0,
      buySol: 0n,
      sellSol: 0n,
      decided: false,
      entryQ: 0n,
      entryT: 0n,
      entrySlot: 0,
      peakQ: 0n,
      peakT: 0n,
    };
    tracks.set(mint, t);
  }
  return t;
}

await runBot({
  onBatch(state, batch) {
    const { caps } = state.hello;
    const tx = state.txFeeLamports();
    const orders: (BuyInput | SellInput)[] = [];

    // --- exits first: every held position is re-priced from its latest mark/reserves.
    for (const [mint, pos] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const t = tracks.get(mint);
      if (t === undefined || t.entryQ === 0n) continue;
      const q = curve.virtual_quote_reserves;
      const tk = curve.virtual_token_reserves;
      if (tk === 0n) continue;
      // Peak since entry, kept as a ratio.
      if (t.peakQ === 0n || q * t.peakT > t.peakQ * tk) {
        t.peakQ = q;
        t.peakT = tk;
      }
      const takeProfit = priceAtLeast(q, tk, t.entryQ, t.entryT, TAKE_PROFIT_BPS);
      const stopLoss = priceAtMost(q, tk, t.entryQ, t.entryT, STOP_LOSS_BPS);
      const trailing =
        t.peakQ !== 0n && priceAtMost(q, tk, t.peakQ, t.peakT, TRAIL_BPS);
      const timedOut = batch.slot - t.entrySlot > MAX_HOLD_SLOTS;
      if (takeProfit || stopLoss || trailing || timedOut) {
        orders.push({
          side: 'sell',
          mint,
          token_amount: pos.token_amount,
          max_slippage_bps: SELL_SLIPPAGE_BPS,
        });
      }
    }

    // --- entries: walk this batch's events in chain order.
    let free = state.freeCashLamports();
    let slots = caps.max_open_positions - state.committedPositionCount();
    for (const e of batch.events) {
      if (orders.length >= caps.max_orders_per_batch) break;
      if (e.event === 'CreateEvent') {
        const t = trackFor(e.mint, e.slot);
        t.createdSlot = e.slot;
        if (t.firstT === 0n) {
          t.firstQ = BigInt(e.virtual_quote_reserves);
          t.firstT = BigInt(e.virtual_token_reserves);
        }
        continue;
      }
      if (e.event === 'CompleteEvent') {
        const t = tracks.get(e.mint);
        if (t !== undefined) t.decided = true;
        continue;
      }
      if (e.event !== 'TradeEvent') continue;
      const t = trackFor(e.mint, e.slot);
      t.trades += 1;
      if (e.is_buy) t.buySol += BigInt(e.sol_amount);
      else t.sellSol += BigInt(e.sol_amount);
      if (t.firstT === 0n) {
        t.firstQ = BigInt(e.virtual_quote_reserves);
        t.firstT = BigInt(e.virtual_token_reserves);
      }
      if (t.decided) continue;
      if (batch.slot - t.createdSlot > MAX_ENTRY_AGE_SLOTS) {
        t.decided = true;
        continue;
      }
      if (t.trades < MIN_TRADES_TO_ENTER) continue;
      const curve = state.curves.get(e.mint);
      if (curve === undefined || curve.complete) {
        t.decided = true;
        continue;
      }
      const q = BigInt(e.virtual_quote_reserves);
      const tk = BigInt(e.virtual_token_reserves);
      if (tk === 0n || t.firstT === 0n) continue;
      // Early bird: no price filter — the coin's youth is the signal. The dev data shows
      // buying the first trades of a young coin and holding ~100 slots beats chasing a
      // rise (a fast rise is the top, and mean reversion follows it).
      if (state.positions.has(e.mint)) {
        t.decided = true;
        continue;
      }
      const cap = state.maxBuyLamports(e.mint);
      if (cap < MIN_BUY_LAMPORTS) continue;
      const amount = cap < STAKE_LAMPORTS ? cap : STAKE_LAMPORTS;
      if (slots <= 0 || free < amount + tx) continue;
      orders.push({
        side: 'buy',
        mint: e.mint,
        quote_lamports: amount,
        max_slippage_bps: BUY_SLIPPAGE_BPS,
      });
      t.decided = true;
      t.entryQ = q;
      t.entryT = tk;
      t.entrySlot = batch.slot;
      t.peakQ = q;
      t.peakT = tk;
      free -= amount + tx;
      slots -= 1;
    }

    // --- prune dead tracks so the map stays small over a long window.
    if (tracks.size > 5000) {
      for (const [mint, t] of tracks) {
        if (t.decided && !state.positions.has(mint) && batch.slot - t.createdSlot > MAX_ENTRY_AGE_SLOTS + MAX_HOLD_SLOTS) {
          tracks.delete(mint);
        }
      }
    }

    return orders;
  },
});
