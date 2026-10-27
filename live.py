"""Live PAPER trading: one check per run (run_forever.sh repeats it every 15 min, right after each 15m candle closes).
No real money, no API keys.

Each run: fetch latest closed candles -> feed any NEW closed candle to the same engine used in the backtest ->
          append new fills to ledger.csv -> write portfolio.json (current state) and snapshots.csv (equity history).
"""
import csv, json, os, sys
from datetime import datetime
from zoneinfo import ZoneInfo
import requests
from paperbot.data import load_config, fetch_recent, HERE
from paperbot.engine import Engine
from paperbot import strategies

STATE = os.path.join(HERE, "state", "state.json")
LEDGER = os.path.join(HERE, "ledger.csv")
SNAP = os.path.join(HERE, "snapshots.csv")
PORTFOLIO = os.path.join(HERE, "portfolio.json")
ATHENS = ZoneInfo("Europe/Athens")
FILL_COLS = ["time", "coin", "side", "qty", "price", "fee_eur", "value_eur", "reason", "cash_after"]


def log(msg):
    print(f"[{datetime.now(ATHENS):%Y-%m-%d %H:%M:%S} Athens] {msg}", flush=True)


def append_csv(path, cols, rows):
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        if new: w.writeheader()
        w.writerows(rows)


def live_prices(cfg, eng):
    out = {}
    for coin, m in cfg["coins"].items():
        try:
            r = requests.get("https://api.binance.com/api/v3/ticker/price", params={"symbol": m["binance"]}, timeout=15)
            out[coin] = float(r.json()["price"])
        except Exception:
            try:
                r = requests.get("https://api.kraken.com/0/public/Ticker", params={"pair": m["kraken"]}, timeout=15)
                out[coin] = float(next(iter(r.json()["result"].values()))["c"][0])
            except Exception:
                out[coin] = eng.last_close.get(coin)
    return {k: v for k, v in out.items() if v}


def describe(name, row, scfg_shorts=False):
    if name == "smc":
        return (f"4h bull={bool(row['bull4'])} bear={bool(row['bear4'])} | 1h structure up={bool(row['h1_ok_long'])} | setup signal long={bool(row['smc_long'])}"
                + (f" short={bool(row['smc_short'])} (1h structure down={bool(row['h1_ok_short'])})" if scfg_shorts else ""))
    if name == "mtf_ema":
        return f"4h bull={bool(row['bull4'])} dipped={bool(row['dipped'])}"
    return f"EMAfast={row['ema_fast']:.2f} EMAslow={row['ema_slow']:.2f}"


def main():
    cfg = load_config()
    name = cfg["strategy"]["active"]
    scfg = cfg["strategies"][name]
    tf = scfg["timeframe"]
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    if not os.path.exists(STATE):
        eng, cursor = Engine(cfg, name, scfg), {}
        log(f"First run: new paper account EUR {eng.cash:.2f}, strategy '{name}' on {tf} candles")
    else:
        st = json.load(open(STATE))
        if st["engine"]["sname"] != name:
            raise SystemExit(f"state file belongs to strategy '{st['engine']['sname']}' but config says '{name}'. Archive state/ first.")
        eng, cursor = Engine.from_state(cfg, st["engine"]), st["cursor"]
        eng.scfg = scfg
    n_fills_before = len(eng.fills)
    sources = {}
    for coin in cfg["coins"]:
        df, src = fetch_recent(cfg, coin, tf, cfg["live"]["history_candles"][tf])
        sources[coin] = src
        df = strategies.prepare(name, df, scfg)
        recs = df.to_dict("records")
        if coin not in cursor:           # first time: only the latest closed candle, no invented past trades
            idx = [len(recs) - 1]
        else:
            idx = [i for i in range(1, len(recs)) if str(recs[i]["time"]) > cursor[coin]]
        for i in idx:
            eng.on_candle(coin, recs[i], recs[i - 1] if i else None)
            cursor[coin] = str(recs[i]["time"])
        if idx:
            log(f"{coin}: +{len(idx)} candle(s) up to {cursor[coin]} UTC ({src}); close {recs[-1]['close']:.2f}; {describe(name, recs[-1], scfg.get('allow_shorts', False))}; pending={eng.pending.get(coin)}")
    new_fills = eng.fills[n_fills_before:]
    for f in new_fills:
        log(f"TRADE {f['side']} {f['coin']} qty {f['qty']:.6f} @ {f['price']:.2f} EUR ({f['reason']}), fee {f['fee_eur']:.2f}")
    if new_fills:
        append_csv(LEDGER, FILL_COLS, new_fills)
    prices = live_prices(cfg, eng)
    equity = eng.equity(prices)
    start = cfg["account"]["starting_balance_eur"]
    now = datetime.now(ATHENS)
    pos = {}
    for c, p in eng.positions.items():
        px = prices.get(c, p.entry_price)
        pos[c] = dict(side="long" if p.side > 0 else "short", qty=p.qty, entry_price=p.entry_price, entry_time_utc=p.entry_time,
                      stop=p.stop, take_profit=p.take, price_now=px, value_eur=p.qty * px,
                      funding_paid_eur=round(p.funding_paid, 4),
                      unrealised_pnl_eur=p.side * p.qty * (px - p.entry_price) - p.entry_fee - p.funding_paid)
    trades = eng.trades
    port = dict(updated=now.isoformat(timespec="seconds"), timezone="Europe/Athens", paper_money_only=True, strategy=name, allow_shorts=bool(scfg.get("allow_shorts", False)), timeframe=tf,
                starting_balance_eur=start, cash_eur=round(eng.cash, 2), equity_eur=round(equity, 2),
                total_return_pct=round((equity / start - 1) * 100, 3), realised_pnl_eur=round(sum(t["pnl_eur"] for t in trades), 2),
                closed_trades=len(trades), wins=sum(1 for t in trades if t["pnl_eur"] > 0), max_drawdown_pct=round(eng.max_dd * 100, 3),
                prices_eur=prices, open_positions=pos, pending_orders=eng.pending, last_candle_processed_utc=cursor, data_source=sources,
                params=dict(strategy=scfg, risk=cfg["risk"], account=cfg["account"]))
    json.dump(port, open(PORTFOLIO, "w"), indent=1, default=str)
    json.dump(dict(engine=eng.to_state(), cursor=cursor), open(STATE + ".tmp", "w"), default=str)
    os.replace(STATE + ".tmp", STATE)
    append_csv(SNAP, ["time_athens", "equity_eur", "cash_eur", "open_positions", "BTC", "ETH", "SOL"],
               [dict(time_athens=now.isoformat(timespec="seconds"), equity_eur=round(equity, 2), cash_eur=round(eng.cash, 2),
                     open_positions=len(pos), BTC=prices.get("BTC"), ETH=prices.get("ETH"), SOL=prices.get("SOL"))])
    log(f"[{name}] Equity EUR {equity:.2f} (cash {eng.cash:.2f}, open: {list(pos) or 'none'}, closed trades: {len(trades)})")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
