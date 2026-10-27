"""Download real 15m and 1h candles (paginated, public Binance API, no key) into data/*.csv."""
import sys
from paperbot.data import load_config, fetch_history
cfg = load_config()
days = int(sys.argv[1]) if len(sys.argv) > 1 else cfg["data"]["history_days"]
for coin in cfg["coins"]:
    for iv in ("1h", "15m"):
        df = fetch_history(cfg, coin, iv, days)
        print(coin, iv, len(df), df["time"].iloc[0], "->", df["time"].iloc[-1], flush=True)
