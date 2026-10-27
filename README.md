# Paper-trading bot: BTC, ETH, SOL (fake money only)

Pretend-trades Bitcoin, Ethereum and Solana against the euro. **No real money, no exchange account, no API keys** – it only reads free public prices (Binance public data; Kraken as a backup for 1h data only).
It starts with a virtual €1,000 and writes down every pretend trade so you can see whether an idea works *before* risking anything real.

## On your iPhone

The dashboard is a small website in the `docs` folder. Pin it to your home screen and open it between deliveries. It shows the pretend-money account. It cannot place a real order.

The site reads one file, `docs/data.json`. The Linux server rewrites that file every 15 minutes and pushes it to GitHub. GitHub Pages serves the `docs` folder. The phone reloads the file once a minute. The “Last updated” line is Athens time.

### 1. Turn the site on

GitHub Pages serves the `docs` folder from the `master` branch. Make the repository public so the phone can open the page without a GitHub login.

1. Open this repository on GitHub.
2. **Settings → General → Danger zone → Change repository visibility → Public.**
3. **Settings → Pages.**
4. Under Build and deployment, set Source to **Deploy from a branch**.
5. Branch: **master**. Folder: **/docs**. Click **Save**.
6. Wait a minute. Pages shows a link like `https://576jf5scdr-sudo.github.io/altcoins-trader/`. That is the address you open on the phone.

### 2. Let the server publish the numbers

On the server, use the checkout that runs the bot, and stay on the `master` branch. That is the branch the phone site is built from.

Try one publish from that folder:

```
python3 publish_data.py
```

You should see `wrote docs/data.json` and `pushed master`. On GitHub, `master` gets a new commit that changes only `docs/data.json`. The commit contains the paper account, the coin bias, the log lines and the backtest table. It does not contain passwords or API keys.

If git cannot push, give the server a token that can update this repository:

1. On GitHub: **Settings → Developer settings → Fine-grained personal access tokens → Generate new token.**
2. Restrict the token to this repository. Repository permission: **Contents → Read and write.**
3. On the server, save the token in a file that git will not commit:

```
mkdir -p ~/.config/altcoins-trader
nano ~/.config/altcoins-trader/github_token
chmod 600 ~/.config/altcoins-trader/github_token
```

Paste the token on its own, save, and run `python3 publish_data.py` again. The token stays on the server. It can update the dashboard file. It cannot move money.

Then publish every 15 minutes, shortly after the bot’s own check, so a new paper trade is already saved:

```
*/15 * * * * cd /path/to/altcoins-trader && sleep 90 && /usr/bin/python3 publish_data.py >> logs/publish.log 2>&1
```

`logs/` is ignored by git. To write `docs/data.json` without committing, run `python3 publish_data.py --no-push`.

### 3. Put the icon on the home screen

1. On the iPhone, open **Safari**.
2. Go to the Pages link from step 1.
3. Tap the **Share** button (the square with the arrow, at the bottom of Safari).
4. Tap **Add to Home Screen**.
5. The name under the icon is **Altcoins**. Tap **Add**.
6. Open **Altcoins** from the home screen. It fills the screen like an app. The green **LIVE** dot means the page is showing the published file. It refreshes by itself every minute, and again whenever you open it.

The orange **Chat** button opens your helper in the Grok app.

### Look at the layout on a computer

```
cd docs
python3 -m http.server 8080
```

Open http://localhost:8080 for the real file. Open http://localhost:8080/?sample=1 to see an example account with trades, so you can check the layout. The yellow line at the top means those trades are the example, not the live paper account.

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
10. **Shorts** (`allow_shorts`, now `true` on the live paper bot): mirrored setup (4h bearish, 1h lower highs/lows, 15m sweep of a high -> bearish BOS -> short at bearish FVG/OB, stop above the sweep high, 2R). Modelled as 1x perpetual-futures shorts (Bybit EU style): same fee + slippage plus a conservative funding cost (`account.short_funding_pct_per_8h`, 0.01% per 8h, always paid by the short). `allow_longs: false` + `allow_shorts: true` = short-only research mode. Set `allow_shorts` back to `false` for long-only. `python3 compare_modes.py` prints long-only / short-only / long+short vs buy & hold.
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
| `publish_data.py` | Writes that JSON to `docs/data.json`, commits only that file, and pushes it |
| `docs/` | The phone site (plain HTML, no build). GitHub Pages serves this folder |
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
python3 publish_data.py                          # write docs/data.json and push it for the phone
```
**Switching strategy:** `./stop.sh`, move `state/ ledger.csv snapshots.csv portfolio.json` into a new folder under `archive/`, set `strategy.active` in `config.json`, `./start.sh` (fresh €1,000). `live.py` refuses to run if the saved state belongs to a different strategy.

## Limits (be honest with yourself)
- Backtest ≠ future. 2 years is one market regime (BTC went 62k→72k EUR, ETH and SOL fell). Buy & hold in the table is 100% invested per coin, while the strategies use at most 30% per coin, so they aren't exactly comparable.
- The "smart money" concepts are subjective in real life; here they're turned into fixed rules and may differ from how a human would draw them.
- Spot trading can't short, so in a falling market the bot mostly sits in cash.
- Data fallback: Kraken only gives ~7.5 days of 15m candles, so for `smc` there is no real fallback; if Binance is unreachable the check logs an error and tries again at the next quarter hour.
- Paper fills assume you always get the next open ± 0.05%; real fills in fast markets can be worse.
- Greece: choosing a real exchange is a later step; nothing here touches a real exchange.
