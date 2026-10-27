"""Strategy rules. Every rule is mechanical (numbers in config.json) and uses CLOSED candles only.

Three strategies:
  ema_cross : 1h EMA20/50 crossover (the original simple one)
  mtf_ema   : 4h EMA trend filter + 1h EMA pullback-reclaim entry (simple multi-timeframe)
  smc       : 4h bias + 1h structure + 15m break-of-structure + liquidity sweep + FVG/order-block pullback entry

`prepare(df, cfg)`  adds indicator / setup columns to a candle table (no look-ahead).
`signal(...)`       turns one closed candle into an order for the NEXT candle's open (or None).
"""
import numpy as np
import pandas as pd

H = pd.Timedelta


# ------------------------------------------------------------------ helpers
def resample(df, rule, per):
    """Build higher-timeframe candles from a lower one. Only COMPLETE blocks are kept (per = candles per block)."""
    g = df.set_index("time").resample(rule, label="left", closed="left")
    o = pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(),
                      "close": g["close"].last(), "n": g["close"].count()})
    return o[o["n"] == per].drop(columns="n")


def atr(df, n):
    pc = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def h4_features(h4, s):
    """4h trend bias. A 4h candle only becomes visible once it has CLOSED (avail = open + 4h)."""
    h4 = h4.copy()
    h4["ema_f"] = h4["close"].ewm(span=s["h4_ema_fast"], adjust=False).mean()
    h4["ema_s"] = h4["close"].ewm(span=s["h4_ema_slow"], adjust=False).mean()
    h4["atr4"] = atr(h4, s["h4_atr_len"])
    cnt = np.arange(len(h4))
    warm = cnt >= 60                       # ignore the first 60 4h candles (EMAs not settled)
    bull = (h4["close"] > h4["ema_s"]) & (h4["ema_f"] > h4["ema_s"]) & warm
    bear = (h4["close"] < h4["ema_s"]) & (h4["ema_f"] < h4["ema_s"]) & warm
    if s.get("use_h4_ema200"):
        e200 = h4["close"].ewm(span=200, adjust=False).mean()
        bull &= (h4["close"] > e200) & (cnt >= 200)
        bear &= (h4["close"] < e200) & (cnt >= 200)
    h4["bull4"], h4["bear4"] = bull, bear
    h4["avail"] = h4.index + H(hours=4)
    return h4.reset_index(drop=True)[["avail", "bull4", "bear4", "atr4"]]


def attach(base, feat, tf_minutes):
    """Add higher-timeframe columns to `base`: each base candle sees only HTF candles closed by its own close time."""
    left = base[["time"]].copy()
    left["ct"] = left["time"] + H(minutes=tf_minutes)
    m = pd.merge_asof(left, feat.sort_values("avail"), left_on="ct", right_on="avail", direction="backward")
    for c in feat.columns:
        if c == "avail":
            continue
        v = m[c].values
        base[c] = pd.Series(v).fillna(False).astype(bool).values if feat[c].dtype == bool else v
    return base


def swing_structure(h, l, n, keep=3):
    """Fractal swings (a swing high = highest high of 2n+1 candles). Confirmed n candles AFTER the swing candle.
    Returns: struct_ok[k] (last 2 swing highs rising AND last 2 swing lows rising, known at candle k's close),
             sh[k, :] last `keep` confirmed swing highs (newest first)."""
    N = len(h)
    ok = np.zeros(N, bool)
    sh = np.full((N, keep), np.nan)
    shs, sls = [], []
    for k in range(N):
        j = k - n
        if j >= n:
            if h[j] > h[j - n:j].max() and h[j] > h[j + 1:k + 1].max():
                shs.append(h[j])
            if l[j] < l[j - n:j].min() and l[j] < l[j + 1:k + 1].min():
                sls.append(l[j])
        if len(shs) >= 2 and len(sls) >= 2:
            ok[k] = shs[-1] > shs[-2] and sls[-1] > sls[-2]
        for q in range(min(keep, len(shs))):
            sh[k, q] = shs[-1 - q]
    return ok, sh


def smc_scan(o, h, l, c, bias, struct, h1sh, s):
    """Scan 15m candles (LONG logic; shorts are run on the mirrored series -price).
    Returns entry flag, stop distance (fraction of price), liquidity-target distance, zone kind (1=FVG, 2=OB)."""
    N, n = len(c), s["swing_n"]
    entry = np.zeros(N, bool)
    stopf = np.full(N, np.nan)
    liqf = np.full(N, np.nan)
    kind = np.zeros(N, np.int8)
    last_sh, sh_broken, last_sl, sweep, setup = None, True, None, None, None
    for i in range(N):
        j = i - n
        if j >= n:   # confirm a 15m swing high / low
            if h[j] > h[j - n:j].max() and h[j] > h[j + 1:i + 1].max():
                last_sh, sh_broken = h[j], False
            if l[j] < l[j - n:j].min() and l[j] < l[j + 1:i + 1].min():
                last_sl = l[j]
        # (3) entry: price pulls back into the FVG / order block and a bullish candle closes
        if setup is not None and i > setup["bos"]:
            if i > setup["bos"] + s["setup_expiry_bars"] or c[i] < setup["zlo"]:
                setup = None                                   # expired, or invalidated by a close below the zone
            elif l[i] <= setup["zhi"] and c[i] > o[i] and bias[i] and struct[i]:
                stop = setup["leg_low"] - s["stop_buffer_pct"] / 100 * abs(c[i])
                d = c[i] - stop
                frac = d / abs(c[i])
                if s["min_stop_pct"] / 100 <= frac <= s["max_stop_pct"] / 100:
                    entry[i], stopf[i], kind[i] = True, frac, setup["kind"]
                    above = [x for x in h1sh[i] if x == x and x > c[i]]
                    if above:                                  # nearest recent 1h swing high above = liquidity target
                        dist = min(above) - c[i]
                        if dist >= s["liq_min_r"] * d:
                            liqf[i] = min(dist, s["liq_max_r"] * d) / abs(c[i])
                setup = None
        # (4) liquidity sweep: wick below the last swing low, close back above it
        if last_sl is not None:
            if l[i] < last_sl and c[i] > last_sl:
                sweep = (i, l[i])
            elif c[i] < last_sl:
                last_sl = None                                 # genuinely broken, not a sweep
        # (2) break of structure: first close above the last 15m swing high
        if last_sh is not None and not sh_broken and c[i] > last_sh:
            sh_broken = True
            sw_ok = sweep is not None and i - sweep[0] <= s["sweep_lookback_bars"]
            if sw_ok or not s["require_sweep"]:
                ws = sweep[0] if sw_ok else max(0, i - s["leg_lookback_bars"])
                ls = ws + int(np.argmin(l[ws:i + 1]))          # start of the up-leg = its lowest low
                leg_low = l[ls]
                zone, kd = None, 0
                for ci in range(i, ls + 1, -1):                # newest bullish FVG inside the leg
                    a = ci - 2
                    if l[ci] > h[a] and (l[ci] - h[a]) / abs(c[ci]) >= s["min_fvg_pct"] / 100:
                        zone, kd = (h[a], l[ci]), 1
                        break
                if zone is None:                               # else order block: last down candle followed by an up-close above its high
                    for k in range(i - 1, ls - 1, -1):
                        if c[k] < o[k] and c[k + 1] > h[k]:
                            zone, kd = (l[k], h[k]), 2
                            break
                if zone is not None:
                    setup = dict(bos=i, zlo=zone[0], zhi=zone[1], leg_low=leg_low, kind=kd)
    return entry, stopf, liqf, kind


# ------------------------------------------------------------------ prepare
def prepare(name, df, s):
    df = df.copy()
    if name == "ema_cross":
        df["ema_fast"] = df["close"].ewm(span=s["ema_fast"], adjust=False).mean()
        df["ema_slow"] = df["close"].ewm(span=s["ema_slow"], adjust=False).mean()
    elif name == "mtf_ema":
        df["ema_fast"] = df["close"].ewm(span=s["ema_fast"], adjust=False).mean()
        df["ema_slow"] = df["close"].ewm(span=s["ema_slow"], adjust=False).mean()
        below = (df["close"] < df["ema_fast"]).astype(float)
        df["dipped"] = below.rolling(s["dip_lookback_bars"]).max().shift(1).fillna(0).astype(bool)
        attach(df, h4_features(resample(df, "4h", 4), s), 60)
    elif name == "smc":
        attach(df, h4_features(resample(df, "4h", 16), s), 15)
        h1 = resample(df, "1h", 4)
        n1 = s["h1_swing_n"]
        okL, shL = swing_structure(h1["high"].values, h1["low"].values, n1)
        okS, shS = swing_structure(-h1["low"].values, -h1["high"].values, n1)   # mirrored: lower highs & lower lows
        f = pd.DataFrame({"avail": h1.index + H(hours=1), "h1_ok_long": okL, "h1_ok_short": okS})
        for q in range(3):
            f[f"h1_sh{q}"], f[f"h1_sl{q}"] = shL[:, q], shS[:, q]
        attach(df, f, 15)
        o, h, l, c = (df[k].values for k in ("open", "high", "low", "close"))
        long_ = smc_scan(o, h, l, c, df["bull4"].values, df["h1_ok_long"].values, df[[f"h1_sh{q}" for q in range(3)]].values, s)
        short = smc_scan(-o, -l, -h, -c, df["bear4"].values, df["h1_ok_short"].values, df[[f"h1_sl{q}" for q in range(3)]].values, s)
        for tag, r in (("long", long_), ("short", short)):
            df[f"smc_{tag}"], df[f"smc_{tag}_stop"], df[f"smc_{tag}_liq"], df[f"smc_{tag}_kind"] = r
    else:
        raise ValueError(name)
    return df


# ------------------------------------------------------------------ signals
def _ok(x):
    return x == x and x is not None


def signal(name, s, row, prev, side):
    """side = current position (+1 long, -1 short, 0 flat). Returns an order for the next open, or None."""
    if name == "ema_cross":
        if prev is None:
            return None
        up = prev["ema_fast"] <= prev["ema_slow"] and row["ema_fast"] > row["ema_slow"]
        down = prev["ema_fast"] >= prev["ema_slow"] and row["ema_fast"] < row["ema_slow"]
        ok = (row["close"] > row["ema_slow"]) if s["require_close_above_slow_ema"] else True
        if side == 0 and up and ok:
            sl = s["stop_loss_pct"] / 100
            return dict(action="open", side=1, stop_frac=sl, take_frac=s["take_profit_pct"] / 100, reason="ema_cross_up")
        if side == 1 and down and s["exit_on_cross_down"]:
            return dict(action="close", reason="ema_cross_down")
        return None
    if name == "mtf_ema":
        c = row["close"]
        if side == 0:
            if row["bull4"] and row["dipped"] and c > row["ema_fast"] and c > row["open"] and c > row["ema_slow"] and _ok(row["atr4"]):
                sf = max(s["atr_mult"] * row["atr4"] / c, s["min_stop_pct"] / 100)
                return dict(action="open", side=1, stop_frac=sf, take_frac=s["rr"] * sf, reason="4h_bull_1h_pullback_reclaim")
        elif side == 1 and not row["bull4"]:
            return dict(action="close", reason="4h_trend_down")
        return None
    if name == "smc":
        if side == 0:
            for tag, sd in (("long", 1), ("short", -1)):
                if tag == "short" and not s["allow_shorts"]:
                    continue
                if tag == "long" and not s.get("allow_longs", True):   # short-only mode (research only)
                    continue
                if row[f"smc_{tag}"]:
                    sf = row[f"smc_{tag}_stop"]
                    liq = row[f"smc_{tag}_liq"]
                    tf = liq if (s["target_mode"] == "liquidity" and _ok(liq)) else s["rr"] * sf
                    z = "fvg" if row[f"smc_{tag}_kind"] == 1 else "ob"
                    return dict(action="open", side=sd, stop_frac=float(sf), take_frac=float(tf), reason=f"smc_{tag}_{z}")
        elif s["exit_on_h4_turn"]:
            if side == 1 and not row["bull4"]:
                return dict(action="close", reason="4h_bias_lost")
            if side == -1 and not row["bear4"]:
                return dict(action="close", reason="4h_bias_lost")
        return None
    raise ValueError(name)
