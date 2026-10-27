"""Compact long-only / short-only / long+short vs buy & hold table from backtest_results.json (run backtest.py first)."""
import json, os, sys
from paperbot.data import HERE
R = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "backtest_results.json")))
MODES = [("Long-only (live default)", "smc ("), ("Short-only (perp)", "smc short-only"), ("Long+short (perp)", "smc long+short")]
print(f"fee {R['info']['fee_pct']}% + slip {R['info']['slippage_pct']}% | window {R['info']['eval_start'][:10]} -> {R['info']['end'][:10]} | OOS from {R['info']['split'][:10]}\n")
for pname, pr in R["periods"].items():
    print(f"== {pname}")
    print(f"{'Mode':26}{'Ret%':>8}{'MaxDD%':>8}{'Trades':>7}{'Win%':>6}{'L/S n':>9}{'LongPnL€':>10}{'ShortPnL€':>10}{'Fees€':>8}{'Fund€':>7}")
    for name, pref in MODES:
        k = next(x for x in pr["strategies"] if x.startswith(pref)); s = pr["strategies"][k]["COMBINED"]
        wr = "-" if s["win_rate"] is None else f"{s['win_rate']:.0f}"
        print(f"{name:26}{s['ret_pct']:8.1f}{s['max_dd_pct']:8.1f}{s['trades']:7d}{wr:>6}{str(s['long_trades'])+'/'+str(s['short_trades']):>9}{s.get('long_pnl_eur',0):10.1f}{s.get('short_pnl_eur',0):10.1f}{s['fees_eur']:8.1f}{s.get('funding_eur',0):7.1f}")
    b = pr["buy_hold"]["COMBINED"]
    print(f"{'Buy & hold (1/3 each)':26}{b['ret_pct']:8.1f}{b['max_dd_pct']:8.1f}\n")
