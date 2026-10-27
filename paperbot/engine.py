"""Paper-trading engine. The SAME code runs the backtest and the live paper mode.

Rules:
  * A signal is computed when a candle CLOSES; the order is filled at the OPEN of the NEXT candle (no peeking).
  * Stop-loss / take-profit are checked against each candle's high / low. If both could have been hit in the
    same candle we assume the stop was hit first (pessimistic).
  * Every fill pays the taker fee and slippage against you.
  * Size: risk_per_trade % of equity if the stop is hit, but never more than max_allocation % of equity per coin.
  * One position per coin. Long-only unless the strategy config allows shorts (paper margin short, not possible on plain spot).
"""
from dataclasses import dataclass, field, asdict
from . import strategies


@dataclass
class Position:
    qty: float            # always positive
    side: int             # +1 long, -1 short
    entry_price: float
    entry_time: str
    stop: float
    take: float
    entry_fee: float
    entry_notional: float


@dataclass
class Engine:
    cfg: dict
    sname: str = ""
    scfg: dict = field(default_factory=dict)
    cash: float = 0.0
    positions: dict = field(default_factory=dict)
    pending: dict = field(default_factory=dict)
    last_close: dict = field(default_factory=dict)
    trades: list = field(default_factory=list)
    fills: list = field(default_factory=list)
    peak_equity: float = 0.0
    max_dd: float = 0.0

    def __post_init__(self):
        if not self.sname:
            self.sname = self.cfg["strategy"]["active"]
        if not self.scfg:
            self.scfg = self.cfg["strategies"][self.sname]
        if not self.cash and not self.positions and not self.trades:
            self.cash = self.cfg["account"]["starting_balance_eur"]
        self.peak_equity = self.peak_equity or self.cash

    @property
    def fee(self): return self.cfg["account"]["taker_fee_pct"] / 100
    @property
    def slip(self): return self.cfg["account"]["slippage_pct"] / 100

    def equity(self, prices=None):
        prices = prices or self.last_close
        return self.cash + sum(p.side * p.qty * prices.get(c, p.entry_price) for c, p in self.positions.items())

    def _record_dd(self):
        e = self.equity()
        self.peak_equity = max(self.peak_equity, e)
        if self.peak_equity > 0:
            self.max_dd = max(self.max_dd, (self.peak_equity - e) / self.peak_equity)
        return e

    def _open(self, coin, price_open, ts, o):
        r, side = self.cfg["risk"], o["side"]
        eq = self.equity()
        px = price_open * (1 + self.slip * side)
        notional = (eq * r["risk_per_trade_pct"] / 100) / o["stop_frac"]
        notional = min(notional, eq * r["max_allocation_per_coin_pct"] / 100, self.cash / (1 + self.fee))
        if notional < 10:
            return
        qty, fee = notional / px, notional * self.fee
        self.cash += -(notional + fee) if side > 0 else (notional - fee)
        self.positions[coin] = Position(qty, side, px, str(ts), px * (1 - side * o["stop_frac"]), px * (1 + side * o["take_frac"]), fee, notional)
        self.fills.append(dict(time=str(ts), coin=coin, side="BUY" if side > 0 else "SELL_SHORT", qty=qty, price=px, fee_eur=fee,
                               value_eur=notional, reason=o["reason"], cash_after=self.cash))

    def _close(self, coin, price, ts, reason):
        p = self.positions.pop(coin)
        px = price * (1 - self.slip * p.side)
        value = p.qty * px
        fee = value * self.fee
        self.cash += (value - fee) if p.side > 0 else -(value + fee)
        pnl = p.side * (value - p.entry_notional) - p.entry_fee - fee
        self.trades.append(dict(coin=coin, side="long" if p.side > 0 else "short", entry_time=p.entry_time, exit_time=str(ts),
                                entry_price=p.entry_price, exit_price=px, qty=p.qty, pnl_eur=pnl, pnl_pct=pnl / p.entry_notional * 100,
                                fees_eur=p.entry_fee + fee, reason=reason))
        self.fills.append(dict(time=str(ts), coin=coin, side="SELL" if p.side > 0 else "BUY_TO_COVER", qty=p.qty, price=px, fee_eur=fee,
                               value_eur=value, reason=reason, cash_after=self.cash))

    def on_candle(self, coin, row, prev):
        ts, o, h, l, c = row["time"], row["open"], row["high"], row["low"], row["close"]
        pend = self.pending.pop(coin, None)                           # 1) fill the order decided at the previous close
        if pend:
            if pend["action"] == "open" and coin not in self.positions:
                self._open(coin, o, ts, pend)
            elif pend["action"] == "close" and coin in self.positions:
                self._close(coin, o, ts, pend["reason"])
        pos = self.positions.get(coin)                                # 2) stop / take-profit inside this candle
        if pos:
            if pos.side > 0:
                if l <= pos.stop: self._close(coin, min(o, pos.stop), ts, "stop_loss")
                elif h >= pos.take: self._close(coin, max(o, pos.take), ts, "take_profit")
            else:
                if h >= pos.stop: self._close(coin, max(o, pos.stop), ts, "stop_loss")
                elif l <= pos.take: self._close(coin, min(o, pos.take), ts, "take_profit")
        self.last_close[coin] = c
        pos = self.positions.get(coin)                                # 3) decide for the next open
        sig = strategies.signal(self.sname, self.scfg, row, prev, pos.side if pos else 0)
        if sig:
            self.pending[coin] = sig
        return self._record_dd()

    def to_state(self):
        return dict(sname=self.sname, cash=self.cash, positions={k: asdict(v) for k, v in self.positions.items()}, pending=self.pending,
                    last_close=self.last_close, trades=self.trades, fills=self.fills, peak_equity=self.peak_equity, max_dd=self.max_dd)

    @classmethod
    def from_state(cls, cfg, st):
        return cls(cfg, sname=st["sname"], cash=st["cash"], positions={k: Position(**v) for k, v in st["positions"].items()},
                   pending=st["pending"], last_close=st["last_close"], trades=st["trades"], fills=st["fills"],
                   peak_equity=st["peak_equity"], max_dd=st["max_dd"])
