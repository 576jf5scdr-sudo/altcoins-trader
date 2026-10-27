"""Prints the current dashboard data as JSON (paper money only). Usage: python3 dashboard_data.py > dashboard.json
Reads portfolio.json, ledger.csv, snapshots.csv, state/state.json, backtest_results.json and computes the live 4h bias
from CLOSED candles. All times are shown in Athens time (Europe/Athens)."""
import json, os
from datetime import datetime
from zoneinfo import ZoneInfo
import pandas as pd
from paperbot.data import load_config, fetch_recent, HERE
from paperbot import strategies

ATHENS = ZoneInfo("Europe/Athens")


def p(*a): return os.path.join(HERE, *a)


def athens(ts):
    t = pd.Timestamp(ts)
    t = t.tz_localize("UTC") if t.tzinfo is None else t
    return t.tz_convert(ATHENS).strftime("%Y-%m-%d %H:%M")


def h4_bias(cfg):
    s = cfg["strategies"]["smc"]
    out = {}
    for coin in cfg["coins"]:
        try:
            df, src = fetch_recent(cfg, coin, "1h", 1000)
            h4 = strategies.resample(df, "4h", 4)
            feat = strategies.h4_features(h4, s)
            last = feat.iloc[-1]; c = h4.iloc[-1]
            ef = h4["close"].ewm(span=s["h4_ema_fast"], adjust=False).mean().iloc[-1]
            es = h4["close"].ewm(span=s["h4_ema_slow"], adjust=False).mean().iloc[-1]
            bias = "BULL" if last["bull4"] else "BEAR" if last["bear4"] else "NEUTRAL"
            out[coin] = dict(bias=bias, last_closed_4h_close_athens=athens(last["avail"]), close=round(float(c["close"]), 2),
                             ema20=round(float(ef), 2), ema50=round(float(es), 2), source=src)
        except Exception as e:
            out[coin] = dict(bias="unknown", error=str(e))
    return out


def activity(limit=14):
    """Short log lines built from the real live.log (newest first). Only state CHANGES per coin are listed."""
    import re
    path = p("logs", "live.log")
    if not os.path.exists(path):
        return []
    rx = re.compile(r"^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d):\d\d Athens\] (.*)$")
    st = re.compile(r"^(\w+): \+\d+ candle\(s\).*?4h bull=(\w+) bear=(\w+) \| 1h structure up=(\w+) \| setup signal long=(\w+); pending=(.*)$")
    tr = re.compile(r"^TRADE (\w+) (\w+) qty ([\d.]+) @ ([\d.]+) EUR \((\w+)\)")
    last, out, latest = {}, [], None
    for line in open(path, errors="ignore"):
        m = rx.match(line.strip())
        if not m: continue
        day, hm, msg = m.groups()
        when = f"{day[5:]} {hm}"
        latest = when
        s = st.match(msg)
        if s:
            coin, bull, bear, up, sig, pend = s.groups()
            bull, bear, up, sig = bull == "True", bear == "True", up == "True", sig == "True"
            if bull and up and sig: txt, kind = f"{coin} setup ready on 15m, entry signal", "setup"
            elif bull and up: txt, kind = f"{coin} 4h bullish, 1h structure up. Watching 15m for sweep + break", "structure"
            elif bull: txt, kind = f"{coin} 4h bullish, 1h structure not up yet. Waiting", "wait"
            elif bear: txt, kind = f"{coin} 4h bias bearish. Waiting", "bear"
            else: txt, kind = f"{coin} 4h bias neutral. Waiting", "wait"
            if pend.strip() not in ("None", ""):
                out.append(dict(t=when, text=f"{coin} pending entry order: {pend.strip()}", kind="setup"))
            if last.get(coin) != txt:
                out.append(dict(t=when, text=txt, kind=kind)); last[coin] = txt
            continue
        x = tr.match(msg)
        if x:
            side, coin, qty, price, why = x.groups()
            buy = side.lower() in ("buy", "long")
            out.append(dict(t=when, text=f"{'Bought' if buy else 'Sold'} {coin} at €{float(price):,.2f} ({why.replace('_', ' ')})", kind="buy" if buy else "sell"))
        elif "ERROR" in msg:
            out.append(dict(t=when, text="Check failed: " + msg[:80], kind="error"))
    res = out[-limit:][::-1]
    if latest:
        res.insert(0, dict(t=latest, text="Bot checked all 3 coins (every 15 min, closed 15m candles)", kind="check"))
    return res


def main():
    cfg = load_config()
    port = json.load(open(p("portfolio.json"))) if os.path.exists(p("portfolio.json")) else {}
    start = cfg["account"]["starting_balance_eur"]
    ledger = pd.read_csv(p("ledger.csv")) if os.path.exists(p("ledger.csv")) else pd.DataFrame()
    snaps = pd.read_csv(p("snapshots.csv")) if os.path.exists(p("snapshots.csv")) else pd.DataFrame()
    trades = []
    if os.path.exists(p("state", "state.json")):
        trades = json.load(open(p("state", "state.json")))["engine"].get("trades", [])
    closed = []
    for t in trades:
        closed.append({k: t.get(k) for k in ("coin", "side", "entry_time", "exit_time", "entry_price", "exit_price", "pnl_eur", "pnl_pct", "fees_eur", "reason")})
    per_coin = {}
    for c in cfg["coins"]:
        tc = [t for t in trades if t.get("coin") == c]
        w = sum(1 for t in tc if t["pnl_eur"] > 0)
        per_coin[c] = dict(trades=len(tc), wins=w, win_rate_pct=round(w / len(tc) * 100, 1) if tc else None,
                           pnl_eur=round(sum(t["pnl_eur"] for t in tc), 2), fees_eur=round(sum(t.get("fees_eur", 0) or 0 for t in tc), 2),
                           price_eur=port.get("prices_eur", {}).get(c))
    bt = json.load(open(p("backtest_results.json"))) if os.path.exists(p("backtest_results.json")) else {}
    out = dict(
        last_updated_athens=datetime.now(ATHENS).strftime("%Y-%m-%d %H:%M"), timezone="Europe/Athens (UTC+2)",
        strategy=port.get("strategy"), timeframe=port.get("timeframe"),
        account=dict(start_eur=start, equity_eur=port.get("equity_eur"), cash_eur=port.get("cash_eur"),
                     pnl_eur=round(port.get("equity_eur", start) - start, 2), pnl_pct=port.get("total_return_pct"),
                     max_drawdown_pct=port.get("max_drawdown_pct"), closed_trades=port.get("closed_trades"), wins=port.get("wins"),
                     bot_last_check_athens=port.get("updated")),
        open_positions=[dict(coin=c, **v) for c, v in port.get("open_positions", {}).items()],
        pending_orders=port.get("pending_orders", {}),
        recent_fills=ledger.tail(20).iloc[::-1].to_dict("records") if len(ledger) else [],
        recent_closed_trades=closed[-20:][::-1],
        equity_curve=snaps[["time_athens", "equity_eur"]].to_dict("records") if len(snaps) else [],
        per_coin=per_coin, h4_bias=h4_bias(cfg), activity=activity(),
        backtest=bt,
    )
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
