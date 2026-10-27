"""Builds dashboard.canvas.tsx from current data (dashboard_data.py). Paste into WriteCanvas to refresh the Page."""
import json, subprocess, sys
raw = json.loads(subprocess.check_output([sys.executable, "dashboard_data.py"], cwd=".", text=True))
bt = raw["backtest"]; info = bt["info"]
PN = {"FULL": "Full 2 years", "IN-SAMPLE (first 70%)": "In-sample (first 70%)", "OUT-OF-SAMPLE (last 30%)": "Out-of-sample (last 30%)"}
SN = {"smc (4h bias, 1h struct, 15m entry)": "SMC (live)", "mtf_ema (4h trend + 1h pullback)": "4h/1h EMA", "ema_cross (old, 1h)": "Old 1h EMA cross",
      "smc variant: no sweep required": "SMC, no sweep needed", "smc variant: target = next 1h swing high": "SMC, swing-high target", "smc variant: shorts allowed (paper margin)": "SMC + shorts"}
f1 = lambda x: "-" if x is None else f"{x:+.1f}%"
bts = {}
for p, v in bt["periods"].items():
    comb, coin = [], []
    for lab, s in v["strategies"].items():
        c = s["COMBINED"]
        comb.append([SN[lab], f1(c["ret_pct"]), "-" if c["win_rate"] is None else f"{c['win_rate']:.0f}%", f"{c['max_dd_pct']:.1f}%", str(c["trades"]), f"€{c['fees_eur']:.0f}"])
    b = v["buy_hold"]["COMBINED"]
    comb.append(["Buy & hold (1/3 each)", f1(b["ret_pct"]), "-", f"{b['max_dd_pct']:.1f}%", "-", "-"])
    for lab in ["smc (4h bias, 1h struct, 15m entry)", "mtf_ema (4h trend + 1h pullback)", "ema_cross (old, 1h)"]:
        for c in ["BTC", "ETH", "SOL"]:
            s = v["strategies"][lab][c]
            coin.append([c, SN[lab], f1(s["ret_pct"]), "-" if s["win_rate"] is None else f"{s['win_rate']:.0f}%", f"{s['max_dd_pct']:.1f}%", str(s["trades"]), f"€{s['fees_eur']:.0f}"])
    for c in ["BTC", "ETH", "SOL"]:
        s = v["buy_hold"][c]; coin.append([c, "Buy & hold", f1(s["ret_pct"]), "-", f"{s['max_dd_pct']:.1f}%", "-", "-"])
    bts[PN[p]] = dict(comb=comb, coin=coin)
eq = raw["equity_curve"]
D = dict(updated=raw["last_updated_athens"], account=raw["account"], strategy=raw["strategy"],
         pos=raw["open_positions"], pending=raw["pending_orders"], fills=raw["recent_fills"], closed=raw["recent_closed_trades"],
         eq=[[e["time_athens"][5:16].replace("T", " "), e["equity_eur"]] for e in eq[-200:]],
         percoin=raw["per_coin"], bias=raw["h4_bias"], bts=bts, activity=raw["activity"],
         period=dict(eval=info["eval_start"][:10], split=info["split"][:10], end=info["end"][:10]))
data = json.dumps(D, ensure_ascii=False, separators=(",", ":"))
tpl = open("canvas_template.tsx").read()
open("dashboard.canvas.tsx", "w").write(tpl.replace("__DATA__", data))
print(len(data))
