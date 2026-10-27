"""Free public market data (no API keys). Binance klines by default; Kraken (1h only) as a fallback."""
import json, os, time
import pandas as pd
import requests

BINANCE = "https://api.binance.com/api/v3/klines"
KRAKEN = "https://api.kraken.com/0/public/OHLC"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLS = ["time", "open", "high", "low", "close", "volume"]
STEP_MS = {"15m": 900_000, "1h": 3_600_000}


def load_config(path=None):
    with open(path or os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def _tidy(df):
    df["time"] = pd.to_datetime(df["t"], unit="ms", utc=True).astype("datetime64[ns, UTC]")
    return df[COLS].astype({c: float for c in COLS[1:]}).drop_duplicates("time").sort_values("time").reset_index(drop=True)


def _binance(symbol, interval, start_ms=None, end_ms=None, limit=1000):
    """Paged klines -> DataFrame of CLOSED candles (time = candle open time, UTC)."""
    rows, cur = [], start_ms
    while True:
        p = {"symbol": symbol, "interval": interval, "limit": limit}
        if cur is not None:
            p["startTime"] = cur
        if end_ms is not None:
            p["endTime"] = end_ms
        for attempt in range(4):
            try:
                r = requests.get(BINANCE, params=p, timeout=20)
                r.raise_for_status()
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(1.5)
        batch = r.json()
        if not batch:
            break
        rows += batch
        if start_ms is None or len(batch) < limit:
            break
        cur = batch[-1][0] + STEP_MS[interval]
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close", "volume", "ct", "q", "n", "tb", "tq", "i"])
    df = df[df["ct"] < int(time.time() * 1000)]  # drop the still-forming candle
    return _tidy(df)


def _kraken(pair, interval):
    r = requests.get(KRAKEN, params={"pair": pair, "interval": 60 if interval == "1h" else 15}, timeout=20)
    r.raise_for_status()
    j = r.json()
    if j.get("error"):
        raise RuntimeError(j["error"])
    rows = next(v for k, v in j["result"].items() if k != "last")
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close", "vwap", "volume", "count"])
    step = 3600 if interval == "1h" else 900
    df = df[df["t"] + step <= time.time()]
    df["t"] = df["t"] * 1000
    return _tidy(df)


def fetch_recent(cfg, coin, interval, n):
    """Latest n closed candles for live mode. Returns (df, source). Kraken fallback only if it can supply enough history."""
    m = cfg["coins"][coin]
    errs = []
    for src in [cfg["data"]["primary_source"], cfg["data"]["fallback_source"]]:
        try:
            if src == "binance":
                start = int(time.time() * 1000) - (n + 2) * STEP_MS[interval]
                df = _binance(m["binance"], interval, start_ms=start)
            else:
                df = _kraken(m["kraken"], interval)
                if len(df) < n * 0.9 and n > 720:
                    raise RuntimeError(f"kraken only returns {len(df)} candles, need ~{n}")
            return df.tail(n).reset_index(drop=True), src
        except Exception as e:  # noqa
            errs.append(f"{src}: {e}")
    raise RuntimeError(f"all data sources failed for {coin} {interval}: {errs}")


def fetch_history(cfg, coin, interval, days):
    """Real historical candles from Binance public REST (paginated), cached to data/*.csv."""
    sym = cfg["coins"][coin]["binance"]
    end = pd.Timestamp.now(tz="UTC").floor("h")
    start = end - pd.Timedelta(days=days)
    df = _binance(sym, interval, start_ms=int(start.timestamp() * 1000), end_ms=int(end.timestamp() * 1000))
    df = df[df["time"] < end].reset_index(drop=True)
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    df.to_csv(os.path.join(HERE, "data", f"{sym}_{interval}_{days}d.csv"), index=False)
    return df
