"""Backtest on real history (run fetch_data.py first).
  python3 backtest.py                    # all strategies, full / in-sample (first 70%) / out-of-sample (last 30%)
  python3 backtest.py --fee 0.1 --slip 0.02
Parameters are fixed in config.json BEFORE looking at results; nothing is tuned on the out-of-sample part.
"""
import argparse, copy, json, os, sys
import numpy as np
import pandas as pd
from paperbot.data import load_config, HERE
from paperbot.engine import Engine
from paperbot import strategies

STRATS = [  # (label, strategy name, config overrides)
    ("ema_cross (old, 1h)", "ema_cross", {}),
    ("mtf_ema (4h trend + 1h pullback)", "mtf_ema", {}),
    ("smc (4h bias, 1h struct, 15m entry)", "smc", {}),
]
VARIANTS = [  # extra SMC variants, reported separately; defaults are NOT chosen from these
    ("smc variant: no sweep required", "smc", {"require_sweep": False}),
    ("smc variant: target = next 1h swing high", "smc", {"target_mode": "liquidity"}),
    ("smc variant: shorts allowed (paper margin)", "smc", {"allow_shorts": True}),
]


def load_csv(cfg, coin, interval):
    sym = cfg["coins"][coin]["binance"]
    p = os.path.join(HERE, "data", f"{sym}_{interval}_{cfg['data']['history_days']}d.csv")
    df = pd.read_csv(p, parse_dates=["time"])
    df["time"] = pd.to_datetime(df["time"], utc=True).astype("datetime64[ns, UTC]")
    return df


def run(cfg, sname, scfg, recs_by_coin):
    """recs_by_coin: coin -> list of candle dicts (already prepared). Coins share one cash balance."""
    eng = Engine(cfg, sname, scfg)
    ev = []
    for ci, (coin, recs) in enumerate(recs_by_coin.items()):
        ev += [(r["time"], ci, coin, r, recs[i - 1] if i else None) for i, r in enumerate(recs)]
    ev.sort(key=lambda x: (x[0], x[1]))
    for _, _, coin, r, p in ev:
        eng.on_candle(coin, r, p)
    return eng


def summarize(eng, start_eq):
    t = pd.DataFrame(eng.trades)
    n = len(t)
    wins = int((t["pnl_eur"] > 0).sum()) if n else 0
    return dict(ret_pct=(eng.equity() / start_eq - 1) * 100, end_eur=eng.equity(), win_rate=(wins / n * 100 if n else None),
                max_dd_pct=eng.max_dd * 100, trades=n, fees_eur=float(sum(f["fee_eur"] for f in eng.fills)),
                open_at_end=len(eng.positions), long_trades=int((t["side"] == "long").sum()) if n else 0,
                short_trades=int((t["side"] == "short").sum()) if n else 0)


def buy_hold(h1, cfg, t0, t1, w):
    """Buy at the first open, hold to the last close; same fee + slippage. Returns return % and max drawdown %."""
    d = h1[(h1["time"] >= t0) & (h1["time"] < t1)]
    fee, slip = cfg["account"]["taker_fee_pct"] / 100, cfg["account"]["slippage_pct"] / 100
    cap = cfg["account"]["starting_balance_eur"] * w
    qty = cap / (1 + fee) / (d["open"].iloc[0] * (1 + slip))
    end_val = qty * d["close"].iloc[-1] * (1 - slip) * (1 - fee)
    return dict(ret_pct=(end_val / cap - 1) * 100), (qty * d.set_index("time")["close"])


def bh_stats(h1s, cfg, t0, t1, coins):
    out, curves = {}, []
    for c in coins:
        r, cur = buy_hold(h1s[c], cfg, t0, t1, 1.0)
        pk = cur.cummax()
        out[c] = dict(ret_pct=r["ret_pct"], max_dd_pct=float(((pk - cur) / pk).max() * 100))
        r3, cur3 = buy_hold(h1s[c], cfg, t0, t1, 1 / len(coins))
        curves.append(cur3)
        out.setdefault("_w", []).append(r3["ret_pct"])
    comb = pd.concat(curves, axis=1).ffill().sum(axis=1)
    pk = comb.cummax()
    out["COMBINED"] = dict(ret_pct=float(np.mean(out.pop("_w"))), max_dd_pct=float(((pk - comb) / pk).max() * 100))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fee", type=float); ap.add_argument("--slip", type=float)
    ap.add_argument("--out", default=os.path.join(HERE, "backtest_results.json"))
    ap.add_argument("--no-variants", action="store_true")
    a = ap.parse_args()
    cfg = load_config()
    if a.fee is not None: cfg["account"]["taker_fee_pct"] = a.fee
    if a.slip is not None: cfg["account"]["slippage_pct"] = a.slip
    coins = list(cfg["coins"])
    raw = {iv: {c: load_csv(cfg, c, iv) for c in coins} for iv in ("1h", "15m")}
    # common period across coins
    start = max(raw["15m"][c]["time"].iloc[0] for c in coins)
    end = min(raw["15m"][c]["time"].iloc[-1] for c in coins) + pd.Timedelta(minutes=15)
    t_eval = start + pd.Timedelta(days=cfg["backtest"]["warmup_days"])
    t_split = t_eval + (end - t_eval) * (1 - cfg["backtest"]["oos_fraction"])
    periods = {"FULL": (t_eval, end), "IN-SAMPLE (first 70%)": (t_eval, t_split), "OUT-OF-SAMPLE (last 30%)": (t_split, end)}
    info = dict(data_start=str(start), eval_start=str(t_eval), split=str(t_split), end=str(end),
                candles={iv: {c: len(raw[iv][c]) for c in coins} for iv in raw},
                gaps_15m={c: int(((raw["15m"][c]["time"].diff().dropna() != pd.Timedelta(minutes=15)).sum())) for c in coins},
                fee_pct=cfg["account"]["taker_fee_pct"], slippage_pct=cfg["account"]["slippage_pct"],
                prices={c: [float(raw["1h"][c]["open"].iloc[0]), float(raw["1h"][c]["close"].iloc[-1])] for c in coins})
    print(json.dumps(info, indent=1))
    h1s = raw["1h"]
    results = {"info": info, "periods": {}}
    for pname, (t0, t1) in periods.items():
        results["periods"][pname] = {"buy_hold": bh_stats(h1s, cfg, t0, t1, coins), "strategies": {}}
    trades_out = {}
    todo = STRATS + ([] if a.no_variants else VARIANTS)
    for label, sname, ov in todo:
        scfg = copy.deepcopy(cfg["strategies"][sname]); scfg.update(ov)
        tf = scfg["timeframe"]
        prepared = {c: strategies.prepare(sname, raw[tf][c], scfg) for c in coins}
        for pname, (t0, t1) in periods.items():
            sl = {c: prepared[c][(prepared[c]["time"] >= t0) & (prepared[c]["time"] < t1)].to_dict("records") for c in coins}
            res = {}
            for c in coins:
                eng = run(cfg, sname, scfg, {c: sl[c]})
                res[c] = summarize(eng, cfg["account"]["starting_balance_eur"])
            eng = run(cfg, sname, scfg, sl)
            res["COMBINED"] = summarize(eng, cfg["account"]["starting_balance_eur"])
            res["COMBINED"]["by_reason"] = (pd.DataFrame(eng.trades).groupby("reason")["pnl_eur"].agg(["count", "sum"]).round(2).to_dict("index") if eng.trades else {})
            results["periods"][pname]["strategies"][label] = res
            trades_out[(label, pname)] = eng.trades
        print("done", label, flush=True)
    json.dump(results, open(a.out, "w"), indent=1, default=str)
    # save the combined-portfolio trade list of the default SMC strategy for inspection
    for (label, pname), tr in trades_out.items():
        if label.startswith("smc (") and pname == "FULL" and tr:
            pd.DataFrame(tr).to_csv(os.path.join(HERE, "backtest_trades_smc_full.csv"), index=False)
    # ------- print tables
    for pname, pr in results["periods"].items():
        t0, t1 = periods[pname]
        print(f"\n=== {pname}: {t0:%Y-%m-%d} -> {t1:%Y-%m-%d} UTC | fee {cfg['account']['taker_fee_pct']}% + slippage {cfg['account']['slippage_pct']}% ===")
        print(f"{'Strategy':44}{'Scope':10}{'Ret%':>8}{'Win%':>6}{'MaxDD%':>8}{'Trades':>7}{'Fees€':>8}")
        for label, res in pr["strategies"].items():
            for k in coins + ["COMBINED"]:
                s = res[k]; wr = "-" if s["win_rate"] is None else f"{s['win_rate']:.0f}"
                print(f"{label if k == coins[0] else '':44}{k:10}{s['ret_pct']:8.2f}{wr:>6}{s['max_dd_pct']:8.2f}{s['trades']:7d}{s['fees_eur']:8.2f}")
        bh = pr["buy_hold"]
        for k in coins + ["COMBINED"]:
            print(f"{'BUY & HOLD' if k == coins[0] else '':44}{k:10}{bh[k]['ret_pct']:8.2f}{'-':>6}{bh[k]['max_dd_pct']:8.2f}{'-':>7}{'-':>8}")


if __name__ == "__main__":
    main()
