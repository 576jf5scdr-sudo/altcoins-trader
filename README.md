# Paper-trading bot: BTC, ETH, SOL (fake money only)

Pretend-trades Bitcoin, Ethereum and Solana against the euro. **No real money, no exchange account, no API keys** – it only reads free public prices (Binance public data; Kraken as a backup for 1h data only).
It starts with a virtual €1,000 and writes down every pretend trade so you can see whether an idea works *before* risking anything real.

## Honest summary of the backtests (730 days of real data, 2024-11-10 → 2026-10-27 UTC)
Fee 0.25% per trade (Bybit EU taker) + 0.05% slippage, every fill. Full table: run `python3 backtest.py` (prints it, saves `backtest_results.json`).
**All three strategies lost money over the full period** (smart-money version: about -27% combined, vs -30% for buy & hold of the same 3 coins). It did best in the last 30% (out-of-sample): -1.2% combined, with BTC +2.3% and ETH +0.9%, while buy & hold gained about +17% in that stretch. Fees are the main killer: roughly 265 EUR of fees on 223 trades in the full run. Nothing here is proof that the bot makes money. Don't use real money on this.

## Three strategies (pick in `config.json` → `strategy.active`)
| name | what it is |
|---|---|
| `smc` (default, live) | 4h bias + 1h structure + 15m break of structure + liquidity sweep + FVG/order-block pullback entry |
| `mtf_ema` | simple: 4h EMA trend filter + 1h EMA pullback entry |
| `ema_cross` | the original: 1h EMA20/EMA50 cross |

### The `smc` rules (all mechanical, all on CLOSED candles, numbers in `config.json` → `strategies.smc`)
1. **4h bias (direction).** Bull = last closed 4h close > EMA50 and EMA20 > EMA50. Bear = the mirror. Long entries only when bull. (First 60 4h candles ignored while EMAs settle.)
2. **1h market structure.** Fractal swings (a high that is the highest of 5 candles, confirmed 2 candles later). OK for longs when the last 2 swing highs are rising **and** the last 2 swing lows are rising (higher highs + higher lows).
3. **Liquidity sweep (required by default).** Within the last 32 fifteen-minute candles, price wicks below a recent 15m swing low and the candle closes back above it (stop-hunt).
4. **Break of structure (BOS).** After the sweep, a 15m candle closes above the most recent 15m swing high. The up-move from the sweep low to the break is the "leg".
5. **Entry zone.** The newest fair value gap inside the leg (3-candle imbalance: candle 3's low is above candle 1's high, at least 0.03% wide; zone = that gap). If there is none, the **order block** = the last red candle that was followed by a candle closing above its high (zone = that red candle's low to high).
6. **Entry trigger.** Price pulls back so a green 15m candle dips into the top of the zone (while 4h bias and 1h structure are still OK) → buy at the **next** candle's open. The setup expires after 32 candles, or is cancelled if a candle closes below the bottom of the zone.
7. **Stop** = below the low of the leg (the sweep low), minus 0.05% buffer. Stops tighter than 0.4% or wider than 3% are skipped.
8. **Target** = 2 × the risk (2R). Alternative `target_mode: "liquidity"` = next 1h swing high (clamped between 1.5R and 4R).
9. **Extra exit:** if the 4h bias flips away, close at the next open.
10. **Shorts** are off (`allow_shorts: false`, spot trading can't short). Turning on gives a mirrored version for paper margin trading.
11. **Sizing:** risk ≈1% of account per trade (position = 1% ÷ stop distance), max 30% of the account in one coin, long only, no leverage.
12. Costs are simulated against you: 0.25% fee per fill + 0.05% slippage. Orders fill at the next candle's open. Stop is checked before target if both could hit in one candle.

## No-cheating rules (look-ahead)
- A 4h or 1h candle is only used after it has fully closed (matched by its close time).
- Swings are only known a couple of candles after they happen.
- Signals come from candle *k*'s close and fill at candle *k+1*'s open.
- Parameters were fixed before testing. The last 30% of the period (2026-03-26 → 2026-10-27) is reported separately as **out-of-sample**; nothing was tuned on it. The variants (no sweep, liquidity target, shorts) are shown for information only, not used to pick defaults.

## Files
| File | What it is |
|---|---|
| `config.json` | All settings (coins, fees, strategy parameters, risk, history length) |
| `fetch_data.py` | Downloads 730 days of 1h and 15m candles into `data/` (public Binance, ~6 min) |
| `backtest.py` | Replays history for every strategy, FULL / in-sample / out-of-sample, vs buy & hold → `backtest_results.json`, `backtest_trades_smc_full.csv` |
| `live.py` | One paper-trading check (new closed 15m candles → same engine as the backtest) |
| `run_forever.sh`, `start.sh`, `stop.sh`, `status.sh` | Runs `live.py` ~20 s after every quarter hour in the background |
| `dashboard_data.py` | Prints current dashboard data as JSON (account, positions, trades, equity curve, 4h bias, backtest) |
| `ledger.csv` | Every pretend fill |
| `portfolio.json` | Current state; `snapshots.csv` = equity history (Athens time) |
| `state/state.json` | Bot memory – don't edit |
| `archive/` | Old runs (the 1h EMA bot with its 90-day backtest) |

## How to use
```
cd /workspace/paper-bot
./start.sh      # start in background   ./status.sh  # see it   ./stop.sh  # stop
python3 fetch_data.py && python3 backtest.py    # refresh history and re-test
python3 dashboard_data.py                       # JSON for the dashboard
```
**Switching strategy:** `./stop.sh`, move `state/ ledger.csv snapshots.csv portfolio.json` into a new folder under `archive/`, set `strategy.active` in `config.json`, `./start.sh` (fresh €1,000). `live.py` refuses to run if the saved state belongs to a different strategy.

## Limits (be honest with yourself)
- Backtest ≠ future. 2 years is one market regime (BTC went 62k→72k EUR, ETH and SOL fell). Buy & hold in the table is 100% invested per coin, while the strategies use at most 30% per coin, so they aren't exactly comparable.
- The "smart money" concepts are subjective in real life; here they're turned into fixed rules and may differ from how a human would draw them.
- Spot trading can't short, so in a falling market the bot mostly sits in cash.
- Data fallback: Kraken only gives ~7.5 days of 15m candles, so for `smc` there is no real fallback; if Binance is unreachable the check logs an error and tries again at the next quarter hour.
- Paper fills assume you always get the next open ± 0.05%; real fills in fast markets can be worse.
- Greece: choosing a real exchange is a later step; nothing here touches a real exchange.
