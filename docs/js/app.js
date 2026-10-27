/* Altcoins Trader. Reads data.json (published by publish_data.py) and draws the phone dashboard. */
(function () {
  "use strict";

  var CHAT = "grokbot://app/v1/agent?id=ef94bdb9-5286-43c2-819b-f60f81925a68";
  var GOAL = 20;
  var COIN = { BTC: "#F7931A", ETH: "#3B6FF0", SOL: "#8B6CF0" };
  var ORDER = ["BTC", "ETH", "SOL"];
  var KIND = {
    bear: "#E5484D", wait: "#B5B5AE", structure: "#3B6FF0", setup: "#8B6CF0",
    buy: "#1F9D63", sell: "#FF6A1A", error: "#E5484D", check: "#C9C8C2"
  };
  var PERIODS = [
    ["FULL", "Full 2 years"],
    ["IN-SAMPLE (first 70%)", "In-sample"],
    ["OUT-OF-SAMPLE (last 30%)", "Out-of-sample"]
  ];
  var STRATS = [
    ["ema_cross (old, 1h)", "Old 1h EMA cross"],
    ["mtf_ema (4h trend + 1h pullback)", "4h/1h EMA"],
    ["smc (4h bias, 1h struct, 15m entry)", "SMC (live)"],
    ["smc variant: no sweep required", "SMC, no sweep needed"],
    ["smc variant: target = next 1h swing high", "SMC, swing-high target"],
    ["smc variant: shorts allowed (paper margin)", "SMC + shorts"]
  ];
  var COIN_STRATS = [STRATS[2], STRATS[1], STRATS[0]];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var PLOT = { x: 90, y: 186, w: 72, h: 34 };
  var EYES = [
    { id: "pupil-l", cx: 74, cy: 102 },
    { id: "pupil-r", cx: 108, cy: 100 }
  ];
  var MOUTH = {
    trade: "M84 132 Q100 138 116 130",
    profit: "M80 128 Q102 150 124 128",
    loss: "M82 142 Q102 128 122 142"
  };
  var BROW = {
    trade: ["M62 90 Q74 96 88 90", "M96 88 Q110 94 124 86"],
    profit: ["M60 88 Q76 70 90 86", "M96 84 Q112 66 126 84"],
    loss: ["M62 94 Q76 106 90 92", "M96 90 Q112 104 126 90"]
  };

  var state = { data: null, period: "FULL", backtestOpen: false, failedRefresh: false, sample: false, pinScroll: true };

  function h(tag, props, children) {
    var n = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = String(v);
      else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return n;
  }

  function num(n) {
    if (n == null || n === "") return null;
    var v = Number(n);
    return isFinite(v) ? v : null;
  }

  function euros(n) {
    var v = num(n);
    if (v == null) return "–";
    return (v < 0 ? "-" : "") + "€" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function signedEuros(n) {
    var v = num(n);
    if (v == null) return "–";
    return (v < 0 ? "-" : "+") + "€" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pct(n, digits) {
    var v = num(n);
    if (v == null) return "–";
    return (v < 0 ? "" : "+") + v.toFixed(digits == null ? 2 : digits) + "%";
  }

  function pct0(n) {
    var v = num(n);
    if (v == null) return "–";
    return (v > 0 ? "+" : "") + Math.round(v) + "%";
  }

  function tone(n) {
    var v = num(n);
    if (v == null || v === 0) return "flat";
    return v > 0 ? "up" : "down";
  }

  function px(n) {
    var v = num(n);
    if (v == null) return "–";
    if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (Math.abs(v) >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function when(s) {
    var m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return s ? String(s) : "–";
    return String(Number(m[3])) + " " + MONTHS[Number(m[2]) - 1] + " " + m[4] + ":" + m[5];
  }

  function clock(s) {
    var m = String(s || "").match(/(\d{2}):(\d{2})\s*$/);
    return m ? m[1] + ":" + m[2] : "";
  }

  function coinsOf(per) {
    var keys = Object.keys(per || {});
    var out = ORDER.filter(function (c) { return keys.indexOf(c) !== -1; });
    keys.forEach(function (c) { if (out.indexOf(c) === -1) out.push(c); });
    if (!out.length) out = ORDER.slice();
    return out;
  }

  function badge(coin, size) {
    return h("span", { class: "badge", style: "background:" + (COIN[coin] || "#888") + (size ? ";width:" + size + "px;height:" + size + "px" : ""), text: String(coin || "?").slice(0, 1) });
  }

  function tile(opts) {
    var good = num(opts.big);
    var cls = "tile" + (good != null && good < 0 ? " loss" : "") + (opts.hi ? " hi" : "");
    var kids = [
      h("div", { class: "tile-top" }, [
        badge(opts.coin),
        h("b", { text: opts.coin }),
        h("span", { class: "side", text: opts.side || "" })
      ]),
      h("div", { class: "tile-nums" }, [
        h("span", { class: "pct " + tone(opts.big), text: pct0(opts.big) }),
        h("span", { class: "eur " + (good != null && good < 0 ? "down" : "flat"), text: signedEuros(opts.pnl) })
      ])
    ];
    if (opts.note) kids.push(h("div", { class: "foot", text: opts.note }));
    return h("article", { class: cls, style: "--c:" + (COIN[opts.coin] || "#888") }, kids);
  }

  function moon() {
    return h("svg", { class: "moon", viewBox: "0 0 48 48", "aria-hidden": "true", html:
      '<path d="M28 8a16 16 0 1 0 12 26A14 14 0 1 1 28 8z" fill="#111"/>' });
  }

  function emptyTrades() {
    return h("div", { class: "empty" }, [
      moon(),
      h("strong", { text: "No trades yet" }),
      h("p", { text: "The bot is patient. It only buys after a full setup: 4h bullish, 1h higher highs and lows, a liquidity sweep, a 15m break of structure, then a pullback. Until then it stays in cash." })
    ]);
  }

  function profitCard(D) {
    var coins = coinsOf(D.per_coin);
    var pnls = coins.map(function (c) { return num((D.per_coin[c] || {}).pnl_eur) || 0; });
    var total = pnls.reduce(function (s, v) { return s + Math.abs(v); }, 0);
    var bar = h("div", { class: "bar", role: "img", "aria-label": "Profit split across BTC, ETH and SOL" });
    coins.forEach(function (c, i) {
      var w = total > 0 ? (Math.abs(pnls[i]) / total) * 100 : 100 / coins.length;
      bar.appendChild(h("i", { style: "width:" + w + "%;background:" + (COIN[c] || "#888") + ";opacity:" + (total > 0 ? "1" : "0.28") }));
    });
    var legend = h("div", { class: "legend" });
    coins.forEach(function (c, i) {
      legend.appendChild(h("span", { class: "item" }, [
        h("i", { class: "dot", style: "background:" + (COIN[c] || "#888") }),
        document.createTextNode(c + " "),
        h("b", { class: pnls[i] < 0 ? "down" : "", text: signedEuros(pnls[i]) })
      ]));
    });
    var card = h("section", { class: "card", "aria-label": "Profit by coin" }, [
      h("div", { class: "card-h" }, [
        h("h2", { text: "Profit by coin" }),
        h("span", { text: "Trading " + coins.length + (coins.length === 1 ? " coin" : " coins") })
      ]),
      bar,
      legend
    ]);
    if (total === 0) card.appendChild(h("p", { class: "note", text: "No profit or loss yet, so the bar stays grey until the first closed trade." }));
    return card;
  }

  function biasCard(D) {
    var bias = D.h4_bias || {};
    var coins = coinsOf(bias);
    var grid = h("div", { class: "bias" });
    var closed = "";
    coins.forEach(function (c) {
      var b = bias[c] || {};
      if (!closed && b.last_closed_4h_close_athens) closed = b.last_closed_4h_close_athens;
      var word = b.bias || "unknown";
      var col = word === "BULL" ? "#1F9D63" : word === "BEAR" ? "#E5484D" : "#6f6e68";
      var ema = b.ema20 != null && b.ema50 != null
        ? "EMA20 " + px(b.ema20) + " vs EMA50 " + px(b.ema50)
        : "No 4h reading in this update";
      grid.appendChild(h("article", { style: "--c:" + (COIN[c] || "#888") }, [
        h("div", { class: "name" }, [badge(c, 18), h("b", { text: c })]),
        h("div", { class: "dir", style: "color:" + col, text: word }),
        h("div", { class: "ema", text: ema })
      ]));
    });
    return h("section", { class: "card" }, [
      h("div", { class: "card-h" }, [
        h("h2", { text: "4h bias now" }),
        h("span", { text: "long entries only when bull" })
      ]),
      grid,
      h("p", { class: "note", text: closed
        ? "Last closed 4h candle: " + when(closed) + " Athens time."
        : "No 4h candle in this update. The next publish from the server fills this in." })
    ]);
  }

  function activityCard(D) {
    var rows = Array.isArray(D.activity) ? D.activity : [];
    var pills = h("div", { class: "pills" });
    if (!rows.length) {
      pills.appendChild(h("p", { class: "note", text: "No log lines yet. After the next 15-minute check, a short note shows up here." }));
    }
    rows.forEach(function (x) {
      pills.appendChild(h("div", { class: "pill" }, [
        h("span", { class: "tick", style: "background:" + (KIND[x.kind] || "#B5B5AE") }),
        h("span", { class: "txt", text: x.text || "" }),
        h("time", { text: clock(x.t) })
      ]));
    });
    return h("section", { class: "card", id: "activity" }, [
      h("div", { class: "who" }, [
        h("span", { class: "avatar", html:
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
          '<ellipse cx="8.5" cy="13" rx="1.7" ry="2.1" fill="#fff"/>' +
          '<ellipse cx="15.2" cy="12" rx="1.7" ry="2.1" fill="#fff"/>' +
          '<path d="M8.2 17.2 Q 12 19.2 15.6 16.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>' +
          '</svg>' }),
        h("div", {}, [
          h("b", { text: "Altcoins Trader" }),
          h("span", { text: "live log · Athens time" })
        ])
      ]),
      pills
    ]);
  }

  function equityCard(D, start) {
    var pts = (Array.isArray(D.equity_curve) ? D.equity_curve : []).filter(function (p) { return num(p.equity_eur) != null; });
    var head = h("div", { class: "card-h" }, [
      h("h2", { text: "Equity curve" }),
      h("span", { text: pts.length ? euros(pts[pts.length - 1].equity_eur) : "euros" })
    ]);
    var card = h("section", { class: "card", "aria-label": "Equity curve" }, [head]);
    if (pts.length < 2) {
      card.appendChild(h("p", { class: "note", text: "The line shows up after the bot has saved a couple of snapshots. It writes one every 15 minutes." }));
      return card;
    }
    var w = 360, ht = 148, padL = 2, padR = 2, padT = 10, padB = 8;
    var vals = pts.map(function (p) { return num(p.equity_eur); });
    var base = num(start);
    var lo = Math.min.apply(null, base == null ? vals : vals.concat([base]));
    var hi = Math.max.apply(null, base == null ? vals : vals.concat([base]));
    var extra = Math.max((hi - lo) * 0.18, hi === lo ? 5 : 1);
    lo -= extra;
    hi += extra;
    function x(i) { return padL + (i / (vals.length - 1)) * (w - padL - padR); }
    function y(v) { return padT + (1 - (v - lo) / (hi - lo)) * (ht - padT - padB); }
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); }).join("");
    var last = vals[vals.length - 1];
    var col = base != null && last < base ? "#E5484D" : "#1F9D63";
    var area = d + " L" + x(vals.length - 1).toFixed(1) + "," + (ht - padB) + " L" + x(0).toFixed(1) + "," + (ht - padB) + " Z";
    var svg = '<svg class="chart" viewBox="0 0 ' + w + ' ' + ht + '" role="img" aria-label="Account equity from ' + euros(vals[0]) + ' to ' + euros(last) + '">';
    svg += '<defs><linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + col + '" stop-opacity="0.28"/><stop offset="100%" stop-color="' + col + '" stop-opacity="0.02"/></linearGradient></defs>';
    if (base != null) {
      var ys = y(base);
      svg += '<line x1="' + padL + '" y1="' + ys.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + ys.toFixed(1) + '" stroke="#D9D8D2" stroke-dasharray="3 4" stroke-width="1"/>';
    }
    svg += '<path d="' + area + '" fill="url(#eqfill)"/>';
    svg += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    svg += '</svg>';
    card.appendChild(h("div", { html: svg }));
    card.appendChild(h("div", { class: "chart-times" }, [
      h("span", { text: when(pts[0].time_athens) }),
      h("span", { text: "start " + euros(base) }),
      h("span", { text: when(pts[pts.length - 1].time_athens) })
    ]));
    card.appendChild(h("p", { class: "note", text: "From the 15-minute snapshots, in euros." }));
    return card;
  }

  function fmt1(n) {
    var v = num(n);
    if (v == null) return "–";
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }

  function cell(text, cls) {
    return h("td", { class: cls || "", text: text });
  }

  function backtestTable(headers, rows) {
    var numeric = { Return: 1, "Win rate": 1, "Max drawdown": 1, "Max DD": 1, Trades: 1, Fees: 1 };
    var trh = h("tr", {}, headers.map(function (name) {
      return h("th", { class: numeric[name] ? "num" : "", text: name });
    }));
    var body = rows.map(function (row) {
      return h("tr", { class: row.live ? "live" : "" }, row.cells.map(function (c) {
        return cell(c.text, (c.num ? "num " : "") + (c.down ? "down" : ""));
      }));
    });
    return h("div", { class: "table-wrap" }, [
      h("table", {}, [h("thead", {}, [trh]), h("tbody", {}, body)])
    ]);
  }

  function statRow(label, block, live) {
    if (!block) return null;
    var wr = block.win_rate;
    return {
      live: !!live,
      cells: [
        { text: label },
        { text: fmt1(block.ret_pct), down: num(block.ret_pct) < 0, num: true },
        { text: wr == null ? "–" : Math.round(wr) + "%", num: true },
        { text: block.max_dd_pct == null ? "–" : Number(block.max_dd_pct).toFixed(1) + "%", num: true },
        { text: block.trades == null ? "–" : String(block.trades), num: true },
        { text: block.fees_eur == null ? "–" : "€" + Math.round(block.fees_eur), num: true }
      ]
    };
  }

  function honest(bt) {
    var full = bt.periods && bt.periods.FULL;
    var oos = bt.periods && bt.periods["OUT-OF-SAMPLE (last 30%)"];
    function grab(block, key) {
      if (!block) return null;
      if (key === "buy") return block.buy_hold && block.buy_hold.COMBINED;
      var s = block.strategies && block.strategies["smc (4h bias, 1h struct, 15m entry)"];
      return s && s.COMBINED;
    }
    var bits = [];
    var a = grab(full, "smc");
    var b = grab(oos, "smc");
    var c = grab(oos, "buy");
    if (a && num(a.ret_pct) != null) bits.push("Over the full window the live SMC rules returned " + fmt1(a.ret_pct) + " combined.");
    if (b && num(b.ret_pct) != null) bits.push("On the later out-of-sample stretch they returned " + fmt1(b.ret_pct) + ".");
    if (c && num(c.ret_pct) != null) bits.push("Buy and hold of the same three coins returned " + fmt1(c.ret_pct) + " in that stretch.");
    bits.push("Every fill in the test pays a 0.25% fee plus slippage. A backtest is one past window, not a promise. This page is paper money only.");
    return bits.join(" ");
  }

  function backtestBody(D) {
    var bt = D.backtest || {};
    if (!bt.periods) {
      return h("div", { class: "fold-body", id: "backtest-body" }, [
        h("p", { class: "note", text: "No backtest was on the server when this file was published." })
      ]);
    }
    var keys = PERIODS.filter(function (p) { return bt.periods[p[0]]; });
    if (!bt.periods[state.period] && keys.length) state.period = keys[0][0];
    var block = bt.periods[state.period] || {};
    var seg = h("div", { class: "seg", role: "tablist", "aria-label": "Backtest window" });
    keys.forEach(function (p) {
      seg.appendChild(h("button", {
        type: "button",
        class: p[0] === state.period ? "on" : "",
        role: "tab",
        "aria-selected": p[0] === state.period ? "true" : "false",
        onclick: function () { state.period = p[0]; render(); },
        text: p[1]
      }));
    });
    var comb = [];
    STRATS.forEach(function (s) {
      var row = statRow(s[1], block.strategies && block.strategies[s[0]] && block.strategies[s[0]].COMBINED, s[1] === "SMC (live)");
      if (row) comb.push(row);
    });
    var bh = block.buy_hold && block.buy_hold.COMBINED;
    if (bh) comb.push({ live: false, cells: [
      { text: "Buy & hold (1/3 each)" },
      { text: fmt1(bh.ret_pct), down: num(bh.ret_pct) < 0, num: true },
      { text: "–", num: true },
      { text: bh.max_dd_pct == null ? "–" : Number(bh.max_dd_pct).toFixed(1) + "%", num: true },
      { text: "–", num: true },
      { text: "–", num: true }
    ] });
    var coinRows = [];
    COIN_STRATS.forEach(function (s) {
      ORDER.forEach(function (c) {
        var blockC = block.strategies && block.strategies[s[0]] && block.strategies[s[0]][c];
        if (!blockC) return;
        var row = statRow(s[1], blockC, s[1] === "SMC (live)");
        row.cells.unshift({ text: c });
        coinRows.push(row);
      });
    });
    ORDER.forEach(function (c) {
      var b = block.buy_hold && block.buy_hold[c];
      if (!b) return;
      coinRows.push({ live: false, cells: [
        { text: c },
        { text: "Buy & hold" },
        { text: fmt1(b.ret_pct), down: num(b.ret_pct) < 0, num: true },
        { text: "–", num: true },
        { text: b.max_dd_pct == null ? "–" : Number(b.max_dd_pct).toFixed(1) + "%", num: true },
        { text: "–", num: true },
        { text: "–", num: true }
      ] });
    });
    var info = bt.info || {};
    var cap = "Real Binance euro candles";
    if (info.eval_start) cap += ", " + String(info.eval_start).slice(0, 10) + " to " + String(info.end || "").slice(0, 10) + " UTC";
    if (info.split) cap += ". Out-of-sample starts " + String(info.split).slice(0, 10);
    cap += ". Each run starts with €1,000. A coin test uses at most 30% of the account. Buy and hold is fully invested.";
    return h("div", { class: "fold-body", id: "backtest-body" }, [
      seg,
      h("p", { class: "note", text: cap }),
      h("p", { class: "blk", text: "All 3 coins sharing one €1,000 account" }),
      backtestTable(["Strategy", "Return", "Win rate", "Max drawdown", "Trades", "Fees"], comb),
      h("p", { class: "blk", text: "Each coin on its own" }),
      backtestTable(["Coin", "Strategy", "Return", "Win rate", "Max DD", "Trades", "Fees"], coinRows),
      h("div", { class: "callout" }, [h("b", { text: "Honest read" }), document.createTextNode(honest(bt))])
    ]);
  }

  function backtestSection(D) {
    var open = state.backtestOpen;
    return h("section", { id: "backtest" }, [
      h("button", {
        type: "button",
        class: "fold",
        id: "backtest-toggle",
        "aria-expanded": open ? "true" : "false",
        "aria-controls": "backtest-body",
        onclick: function () { state.backtestOpen = !state.backtestOpen; render(); }
      }, [
        h("span", {}, [
          h("b", { text: "Backtest" }),
          h("span", { class: "sub", text: "SMC vs simple EMA vs buy & hold" })
        ]),
        h("span", { class: "chev", "aria-hidden": "true", text: "›" })
      ]),
      open ? backtestBody(D) : h("div", { id: "backtest-body", hidden: true })
    ]);
  }

  function pendingNote(pending) {
    var lines = [];
    Object.keys(pending || {}).forEach(function (coin) {
      var o = pending[coin];
      if (!o) return;
      var act = o.action === "close" ? "close" : "entry";
      var why = o.reason ? " (" + String(o.reason).replace(/_/g, " ") + ")" : "";
      lines.push(coin + " " + act + " is waiting for the next candle" + why + ".");
    });
    return lines;
  }

  function watchSeries(D) {
    var eq = (Array.isArray(D.equity_curve) ? D.equity_curve : []).map(function (p) {
      return num(p.equity_eur);
    }).filter(function (v) { return v != null; });
    if (eq.length >= 2) return eq.slice(-36);
    var prices = ORDER.map(function (c) { return num((D.per_coin[c] || {}).price_eur); }).filter(function (v) { return v != null; });
    return prices.length >= 2 ? prices : [1, 1];
  }

  function moodOf(D) {
    var pos = Array.isArray(D.open_positions) ? D.open_positions : [];
    var unreal = 0;
    var known = false;
    pos.forEach(function (p) {
      var u = num(p.unrealised_pnl_eur);
      if (u != null) { unreal += u; known = true; }
    });
    var pnl = num((D.account || {}).pnl_eur) || 0;
    if (pos.length && known && unreal < -0.05) return "loss";
    if (pos.length && known && unreal > 0.05) return "profit";
    if (pnl > 0.05) return "profit";
    if (pnl < -0.05) return "loss";
    return "trade";
  }

  function candleBars(values) {
    var src = values.slice(-8);
    if (src.length < 2) src = [src[0] == null ? 1 : src[0], src[0] == null ? 1 : src[0]];
    var bars = [];
    var i;
    for (i = 1; i < src.length; i++) {
      var o = src[i - 1];
      var c = src[i];
      bars.push({
        o: o,
        c: c,
        h: Math.max(o, c),
        l: Math.min(o, c),
        up: c >= o
      });
    }
    return bars;
  }

  function layoutCandles(bars) {
    var lo = bars[0].l;
    var hi = bars[0].h;
    var i;
    for (i = 1; i < bars.length; i++) {
      if (bars[i].l < lo) lo = bars[i].l;
      if (bars[i].h > hi) hi = bars[i].h;
    }
    var flat = hi - lo < 1e-6;
    var gap = PLOT.w / bars.length;
    return bars.map(function (b, idx) {
      function yOf(v) {
        if (flat) return PLOT.y + PLOT.h * 0.55;
        return PLOT.y + PLOT.h - ((v - lo) / (hi - lo)) * PLOT.h;
      }
      var x = PLOT.x + idx * gap + gap * 0.2;
      var bw = Math.max(4.5, gap * 0.6);
      var yO = yOf(b.o);
      var yC = yOf(b.c);
      var top = Math.min(yO, yC);
      var bot = Math.max(yO, yC);
      return {
        x: x,
        w: bw,
        top: top,
        h: Math.max(flat ? 3.4 : 3.6, bot - top),
        wickX: x + bw / 2,
        yH: flat ? yOf(b.c) - 1.4 : yOf(b.h),
        yL: flat ? yOf(b.c) + 1.4 : yOf(b.l),
        up: b.up,
        tip: [x + bw / 2, yC]
      };
    });
  }

  function stageMarkup() {
    var ink = ' stroke="#F7F1E8" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"';
    return '<svg class="mascot" viewBox="0 0 200 250" aria-hidden="true">' +
      '<g class="bull">' +
      '<path fill="#121212"' + ink + ' d="M38 128 C24 78 46 40 92 38 C136 36 162 76 152 128 C146 158 126 172 92 174 C58 176 44 156 38 128 Z"/>' +
      '<g class="horn-l"><path fill="#F6E7CF"' + ink + ' d="M52 82 C36 62 34 30 54 18 C72 8 84 36 76 70 C72 82 62 90 52 82 Z"/></g>' +
      '<g class="horn-r"><path fill="#F6E7CF"' + ink + ' d="M114 74 C128 48 152 26 170 36 C186 46 176 74 158 86 C142 96 122 88 114 74 Z"/></g>' +
      '<g transform="rotate(-26 44 112)"><ellipse cx="44" cy="112" rx="16" ry="20" fill="#8B5A2B"' + ink + '/><ellipse cx="46" cy="114" rx="8" ry="11" fill="#F4A8C6" stroke="#1A120C" stroke-width="2.2"/></g>' +
      '<g class="ear-r"><g transform="rotate(24 146 100)"><ellipse cx="146" cy="100" rx="15" ry="19" fill="#8B5A2B"' + ink + '/><ellipse cx="144" cy="102" rx="7.5" ry="10" fill="#F4A8C6" stroke="#1A120C" stroke-width="2.2"/></g></g>' +
      '<circle cx="92" cy="112" r="42" fill="#8B5A2B"' + ink + '/>' +
      '<ellipse cx="100" cy="128" rx="22" ry="15" fill="#F0D2A4"' + ink + '/>' +
      '<ellipse cx="92" cy="130" rx="2.6" ry="3.4" fill="#1A120C"/>' +
      '<ellipse cx="108" cy="130" rx="2.6" ry="3.4" fill="#1A120C"/>' +
      '<path class="brow" d="M62 90 Q74 96 88 90" fill="none" stroke="#1A120C" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path class="brow" d="M96 88 Q110 94 124 86" fill="none" stroke="#1A120C" stroke-width="3.4" stroke-linecap="round"/>' +
      '<ellipse class="eye" cx="74" cy="102" rx="9" ry="10" fill="#1A120C"/>' +
      '<ellipse class="eye" cx="108" cy="100" rx="9" ry="10" fill="#1A120C"/>' +
      '<circle id="pupil-l" cx="77" cy="102" r="3" fill="#fff"/>' +
      '<circle id="pupil-r" cx="111" cy="100" r="3" fill="#fff"/>' +
      '<ellipse class="lid" data-cx="74" data-cy="102" cx="74" cy="102" rx="10" ry="11" fill="#8B5A2B" transform="translate(74 102) scale(1 0.05) translate(-74 -102)"/>' +
      '<ellipse class="lid" data-cx="108" data-cy="100" cx="108" cy="100" rx="10" ry="11" fill="#8B5A2B" transform="translate(108 100) scale(1 0.05) translate(-108 -100)"/>' +
      '<path class="mouth" d="M84 132 Q100 138 116 130" fill="none" stroke="#1A120C" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path fill="#141414"' + ink + ' d="M46 146 C32 176 34 224 56 246 L136 246 C166 216 164 172 140 146 C120 164 66 166 46 146 Z"/>' +
      '<circle cx="78" cy="176" r="13" fill="#FF6A1A" stroke="#F7F1E8" stroke-width="2.8"/>' +
      '<path d="M70 172 C64 158 74 156 78 168" fill="none" stroke="#1A120C" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M88 172 C94 158 84 156 80 168" fill="none" stroke="#1A120C" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="74" cy="178" r="1.7" fill="#1A120C"/>' +
      '<circle cx="84" cy="178" r="1.7" fill="#1A120C"/>' +
      '<path d="M70 156 C64 170 60 184 58 194" fill="none" stroke="#FF6A1A" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M96 156 C106 172 112 186 116 198" fill="none" stroke="#FF6A1A" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="58" cy="196" r="3.6" fill="#FF6A1A" stroke="#F7F1E8" stroke-width="2"/>' +
      '<circle cx="116" cy="200" r="3.6" fill="#FF6A1A" stroke="#F7F1E8" stroke-width="2"/>' +
      '<path fill="#141414"' + ink + ' d="M52 162 C28 170 12 190 16 210 C22 218 38 208 44 194 C50 178 58 168 52 162 Z"/>' +
      '<g class="mug">' +
      '<path class="puff" d="M14 176 q8 -10 0 -18" fill="none" stroke="#F7F1EA" stroke-width="3.2" stroke-linecap="round"/>' +
      '<path class="puff" d="M28 170 q-8 -10 0 -18" fill="none" stroke="#F7F1EA" stroke-width="3.2" stroke-linecap="round"/>' +
      '<path class="puff" d="M40 178 q7 -9 0 -16" fill="none" stroke="#F7F1EA" stroke-width="3.2" stroke-linecap="round"/>' +
      '<rect x="6" y="188" width="38" height="34" rx="8" fill="#161616"' + ink + '/>' +
      '<path d="M8 200 C1 198 1 216 8 214" fill="none" stroke="#F7F1E8" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path d="M22 208 C22 196 34 192 30 204 C38 194 42 208 30 216 C24 216 22 212 22 208 Z" fill="#FF6A1A" stroke="#1A120C" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M26 206 C26 202 31 202 29 207 C32 204 33 210 27 212 C25 211 26 208 26 206 Z" fill="#FFE08A"/>' +
      '</g>' +
      '<g class="sweat" opacity="0"><path d="M142 58 c0-18 16-20 16-3 0 12-16 16-16 3z" fill="#9AD8FF" stroke="#F7F1E8" stroke-width="2.2"/></g>' +
      '</g>' +
      '<g class="laptop">' +
      '<rect x="78" y="172" width="96" height="64" rx="8" fill="#2A211B"' + ink + '/>' +
      '<rect x="84" y="178" width="84" height="46" rx="3" fill="#0C0A08"/>' +
      '<g class="candles"></g>' +
      '<circle class="tip" r="2.8" fill="#FF6A1A" stroke="#F7F1E8" stroke-width="1.3" opacity="0"/>' +
      '<rect x="68" y="230" width="110" height="14" rx="5" fill="#3A322A"' + ink + '/>' +
      '<rect x="76" y="224" width="98" height="8" rx="2" fill="#221C16" stroke="#F7F1E8" stroke-width="2.6"/>' +
      '</g>' +
      '<g class="tap">' +
      '<ellipse cx="130" cy="228" rx="18" ry="9" fill="#8B5A2B"' + ink + '/>' +
      '<ellipse cx="116" cy="220" rx="4.2" ry="7" fill="#8B5A2B" stroke="#F7F1E8" stroke-width="2.4"/>' +
      '<ellipse cx="128" cy="216" rx="4.2" ry="7.4" fill="#8B5A2B" stroke="#F7F1E8" stroke-width="2.4"/>' +
      '<ellipse cx="140" cy="220" rx="4.2" ry="6.6" fill="#8B5A2B" stroke="#F7F1E8" stroke-width="2.4"/>' +
      '</g></svg>';
  }


  function stopWatch() {
    state.watchToken = (state.watchToken || 0) + 1;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
  }

  function startWatch(D) {
    var svg = document.querySelector(".hero .mascot");
    if (!svg) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var token = state.watchToken || 0;
    var mood = moodOf(D);
    var bars = layoutCandles(candleBars(watchSeries(D)));
    svg.setAttribute("class", "mascot mood-" + mood);
    var mouth = svg.querySelector(".mouth");
    var bull = svg.querySelector(".bull");
    var tap = svg.querySelector(".tap");
    var mug = svg.querySelector(".mug");
    var sweat = svg.querySelector(".sweat");
    var ear = svg.querySelector(".ear-r");
    var hornL = svg.querySelector(".horn-l");
    var hornR = svg.querySelector(".horn-r");
    var tip = svg.querySelector(".tip");
    var puffs = svg.querySelectorAll(".puff");
    var brows = svg.querySelectorAll(".brow");
    var lids = svg.querySelectorAll(".lid");
    var eyes = svg.querySelectorAll(".eye");
    var pupils = EYES.map(function (eye) { return { eye: eye, el: svg.querySelector("#" + eye.id) }; });
    var host = svg.querySelector(".candles");
    var ns = "http://www.w3.org/2000/svg";
    host.textContent = "";
    var candleEls = bars.map(function (b) {
      var g = document.createElementNS(ns, "g");
      g.setAttribute("class", "candle");
      var wick = document.createElementNS(ns, "line");
      wick.setAttribute("x1", b.wickX.toFixed(2));
      wick.setAttribute("x2", b.wickX.toFixed(2));
      wick.setAttribute("y1", b.yH.toFixed(2));
      wick.setAttribute("y2", b.yL.toFixed(2));
      wick.setAttribute("stroke", "#F6E7CF");
      wick.setAttribute("stroke-width", "2");
      wick.setAttribute("stroke-linecap", "round");
      var body = document.createElementNS(ns, "rect");
      body.setAttribute("x", b.x.toFixed(2));
      body.setAttribute("y", b.top.toFixed(2));
      body.setAttribute("width", b.w.toFixed(2));
      body.setAttribute("height", b.h.toFixed(2));
      body.setAttribute("rx", "1.3");
      body.setAttribute("fill", b.up ? "#FF6A1A" : "#F4E6CF");
      body.setAttribute("stroke", "#F6E7CF");
      body.setAttribute("stroke-width", "1.4");
      g.appendChild(wick);
      g.appendChild(body);
      host.appendChild(g);
      return g;
    });
    if (mouth) mouth.setAttribute("d", MOUTH[mood]);
    if (brows.length === 2) {
      brows[0].setAttribute("d", BROW[mood][0]);
      brows[1].setAttribute("d", BROW[mood][1]);
    }
    var ry = mood === "trade" ? 6.4 : mood === "loss" ? 8.4 : 8;
    eyes.forEach(function (el) { el.setAttribute("ry", String(ry)); });

    function look(x, y) {
      var mid = PLOT.y + PLOT.h * 0.5;
      var along = (y - mid) / (PLOT.h * 0.5);
      if (along > 1) along = 1;
      if (along < -1) along = -1;
      var roomX = 3.6;
      var roomY = mood === "trade" ? 2.6 : 4;
      var bias = mood === "loss" ? 0.7 : 0;
      pupils.forEach(function (p) {
        if (!p.el) return;
        var ang = Math.atan2(y - p.eye.cy, x - p.eye.cx);
        var ox = Math.cos(ang) * roomX;
        var oy = Math.sin(ang) * 0.8 + along * roomY + bias;
        var n = Math.hypot(ox / roomX, oy / roomY);
        if (n > 1) { ox /= n; oy /= n; }
        p.el.setAttribute("cx", (p.eye.cx + ox).toFixed(2));
        p.el.setAttribute("cy", (p.eye.cy + oy).toFixed(2));
      });
    }

    function pose(t, draw) {
      var hop = reduce ? 0 : Math.sin(t * 1.6) * 1.1;
      if (mood === "profit" && !reduce) hop -= Math.pow(Math.sin(t * 2.55), 2) * 8;
      var breath = 1 + Math.sin(t * 1.7) * (reduce ? 0 : 0.018);
      var lean = mood === "profit" ? 5 : mood === "loss" ? 7 : 10;
      var body = "translate(0 " + hop.toFixed(2) + ") translate(90 236) rotate(" + lean + ") scale(1 " + breath.toFixed(4) + ") translate(-90 -236)";
      bull.setAttribute("transform", body);
      var tapY = 0;
      if (!reduce) tapY = Math.sin(t * 14) > 0 ? 0 : 2.6;
      tap.setAttribute("transform", body + " translate(0 " + tapY.toFixed(2) + ")");
      var sip = 0;
      if (!reduce) {
        var sc = t % 7.2;
        if (sc > 5.7) {
          var su = (sc - 5.7) / 1.15;
          if (su < 1) sip = Math.sin(su * Math.PI);
        }
      }
      if (sip > 0.2) tap.setAttribute("transform", body);
      mug.setAttribute("transform", "translate(" + (sip * 22).toFixed(2) + " " + (sip * -34).toFixed(2) + ") rotate(" + (sip * -16).toFixed(2) + " 24 202)");
      var twitch = 0;
      if (!reduce) {
        var et = t % 4.6;
        if (et > 4.15) {
          var eu = (et - 4.15) / 0.4;
          twitch = Math.sin(Math.min(eu, 1) * Math.PI) * 14;
        }
      }
      ear.setAttribute("transform", "rotate(" + twitch.toFixed(2) + " 140 98)");
      var perk = mood === "profit" ? 11 : 0;
      if (mood === "profit" && !reduce) perk += Math.pow(Math.sin(t * 2.55), 2) * 7;
      hornL.setAttribute("transform", "rotate(" + (-perk).toFixed(2) + " 70 78)");
      hornR.setAttribute("transform", "rotate(" + perk.toFixed(2) + " 118 74)");
      puffs.forEach(function (p, i) {
        if (reduce) {
          p.setAttribute("transform", "translate(0 " + (-4 - i * 3) + ")");
          p.setAttribute("opacity", "0.75");
          return;
        }
        var u = ((t * 0.42) + i * 0.33) % 1;
        var op = u < 0.16 ? u / 0.16 : u > 0.72 ? Math.max(0, (1 - u) / 0.28) : 1;
        p.setAttribute("transform", "translate(0 " + (-u * 16).toFixed(2) + ")");
        p.setAttribute("opacity", (op * 0.9).toFixed(2));
      });
      var lidK = 0.05;
      var blinkT = t % 4.4;
      if (!reduce && blinkT > 4.12) {
        var bu = (blinkT - 4.12) / 0.26;
        var tri = bu < 0.5 ? bu * 2 : Math.max(0, 1 - (bu - 0.5) * 2);
        lidK = 0.05 + tri * 0.95;
      }
      lids.forEach(function (el) {
        var cx = +el.getAttribute("data-cx");
        var cy = +el.getAttribute("data-cy");
        el.setAttribute("transform", "translate(" + cx + " " + cy + ") scale(1 " + lidK.toFixed(3) + ") translate(" + (-cx) + " " + (-cy) + ")");
      });
      if (mood === "loss") {
        var drip = reduce ? 0.45 : (t % 2.6) / 2.6;
        var sop = drip < 0.12 ? drip / 0.12 : drip > 0.78 ? Math.max(0, 1 - (drip - 0.78) / 0.22) : 1;
        sweat.setAttribute("opacity", sop.toFixed(2));
        sweat.setAttribute("transform", "translate(0 " + (reduce ? 8 : drip * 18).toFixed(2) + ")");
      } else {
        sweat.setAttribute("opacity", "0");
      }
      var e = reduce ? 1 : Math.max(0, Math.min(1, draw));
      e = 1 - Math.pow(1 - e, 3);
      var seen = 0;
      candleEls.forEach(function (el, i) {
        var on = e >= (candleEls.length <= 1 ? 1 : i / candleEls.length);
        el.setAttribute("opacity", on ? "1" : "0");
        if (on) seen = i;
      });
      var xy = bars[seen].tip;
      tip.setAttribute("cx", xy[0].toFixed(2));
      tip.setAttribute("cy", xy[1].toFixed(2));
      tip.setAttribute("opacity", e > 0.02 ? "1" : "0");
      look(xy[0], xy[1]);
    }

    var t0 = performance.now();
    function frame(now) {
      if (token !== state.watchToken) return;
      if (document.hidden) {
        state.frame = requestAnimationFrame(frame);
        return;
      }
      var elapsed = now - t0;
      pose(elapsed / 1000, (elapsed - 280) / 2100);
      state.frame = requestAnimationFrame(frame);
    }
    if (reduce) pose(0, 1);
    else {
      pose(0, 0);
      state.frame = requestAnimationFrame(frame);
    }
  }

  function hero(D) {
    var a = D.account || {};
    var pnl = num(a.pnl_eur);
    var pnlPct = num(a.pnl_pct);
    var equity = num(a.equity_eur);
    var start = num(a.start_eur);
    var mult = equity != null && start ? equity / start : null;
    var closedN = num(a.closed_trades) || 0;
    var wins = num(a.wins) || 0;
    var wr = closedN > 0 ? Math.round((wins / closedN) * 100) + "% win" : "no wins yet";
    var goal = pnlPct == null ? 0 : Math.max(0, Math.min(100, (pnlPct / GOAL) * 100));
    var strat = String(D.strategy || "SMC").toUpperCase();
    var box = h("section", { class: "hero", id: "home" });
    box.insertAdjacentHTML("beforeend", stageMarkup());
    box.appendChild(h("div", { class: "hero-copy" }, [
      h("div", { class: "hero-top" }, [
        h("h1", { text: "Altcoins Trader" }),
        h("div", { class: "live" }, [h("i"), document.createTextNode("LIVE")])
      ]),
      h("div", { class: "tag", text: "PAPER · " + strat }),
      h("p", { class: "kicker", text: "PROFIT" }),
      h("p", { class: "profit", style: "color:" + (pnl != null && pnl < 0 ? "#FF5A5F" : "#3DDC84"), text: signedEuros(pnl) }),
      h("p", { class: "meta", text: pct(pnlPct) + " · " + euros(equity) }),
      h("div", { class: "row" }, [
        h("span", { class: "mult", text: mult == null ? "–" : mult.toFixed(2) + "×" }),
        h("span", { class: "trades", text: closedN + " trades · " + wr })
      ]),
      h("p", { class: "goal-lab", text: "goal +" + GOAL + "%" }),
      h("div", { class: "track", "aria-hidden": "true" }, [h("span", { style: "width:" + goal + "%" })])
    ]));
    return box;
  }

  function render() {
    var D = state.data;
    if (!D) return;
    stopWatch();
    var top = state.pinScroll ? window.scrollY : null;
    var a = D.account || {};
    var app = document.getElementById("app");
    app.textContent = "";
    var scroll = h("div", { class: "scroll" });
    var updated = "Last updated " + when(D.last_updated_athens) + " · Athens";
    if (state.failedRefresh) updated = "Couldn’t refresh · still showing " + when(D.last_updated_athens) + " Athens";
    scroll.appendChild(h("p", { class: "updated" + (state.failedRefresh ? " warn" : ""), text: updated }));
    if (state.sample || D.preview) {
      scroll.appendChild(h("p", { class: "preview-note", text: "Sample preview. These trades are an example layout, not the live paper account." }));
    }
    scroll.appendChild(hero(D));
    scroll.appendChild(profitCard(D));

    var closed = Array.isArray(D.recent_closed_trades) ? D.recent_closed_trades : [];
    var shown = closed.slice(0, 12);
    scroll.appendChild(h("div", { class: "head", id: "trades" }, [
      h("h2", { text: "Closed trades" }),
      h("span", { text: (num(a.closed_trades) || closed.length) + " total" })
    ]));
    if (shown.length) {
      scroll.appendChild(h("div", { class: "tiles" }, shown.map(function (t, i) {
        return tile({
          coin: t.coin, side: t.side, big: t.pnl_pct, pnl: t.pnl_eur,
          hi: i === 0 && num(t.pnl_eur) >= 0
        });
      })));
      if ((num(a.closed_trades) || closed.length) > shown.length) {
        scroll.appendChild(h("p", { class: "note", text: "Latest " + shown.length + " closed trades." }));
      }
    } else {
      scroll.appendChild(emptyTrades());
    }

    var pos = Array.isArray(D.open_positions) ? D.open_positions : [];
    scroll.appendChild(h("div", { class: "head" }, [
      h("h2", { text: "Open positions" }),
      h("span", { text: pos.length + " open" })
    ]));
    if (pos.length) {
      scroll.appendChild(h("div", { class: "tiles" }, pos.map(function (p) {
        var side = p.side === "short" ? -1 : 1;
        var entry = num(p.entry_price);
        var now = num(p.price_now);
        var chg = entry && now != null ? side * (now / entry - 1) * 100 : null;
        var note = "in " + px(p.entry_price) + " · SL " + px(p.stop) + " · TP " + px(p.take_profit);
        return tile({ coin: p.coin, side: p.side, big: chg, pnl: p.unrealised_pnl_eur, note: note });
      })));
    } else {
      scroll.appendChild(h("div", { class: "empty left" }, [
        h("p", { text: "Nothing open right now." })
      ]));
    }
    var waits = pendingNote(D.pending_orders);
    waits.forEach(function (line) { scroll.appendChild(h("p", { class: "note", text: line })); });

    scroll.appendChild(biasCard(D));
    scroll.appendChild(activityCard(D));
    scroll.appendChild(equityCard(D, a.start_eur));
    scroll.appendChild(backtestSection(D));
    app.appendChild(scroll);
    app.appendChild(h("nav", { class: "dock", "aria-label": "Sections" }, [
      h("button", { type: "button", "data-tab": "home", onclick: function () { go("home"); }, text: "Home" }),
      h("button", { type: "button", "data-tab": "trades", onclick: function () { go("trades"); }, text: "Trades" }),
      h("a", { class: "chat", href: CHAT, text: "Chat" }),
      h("button", { type: "button", "data-tab": "backtest", onclick: function () { go("backtest"); }, text: "Backtest" })
    ]));
    startWatch(D);
    requestAnimationFrame(function () {
      if (top != null) window.scrollTo(0, top);
      markNav();
    });
  }

  function go(id) {
    if (id === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (id === "backtest") state.backtestOpen = true;
    if (id === "backtest") {
      state.pinScroll = false;
      render();
      state.pinScroll = true;
    }
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function markNav() {
    var name = "home";
    var line = window.innerHeight * 0.35;
    ["trades", "backtest"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line) name = id;
    });
    document.querySelectorAll(".dock button[data-tab]").forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("on", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  function showError(err) {
    stopWatch();
    var app = document.getElementById("app");
    app.textContent = "";
    app.appendChild(h("div", { class: "err" }, [
      h("h1", { text: "Waiting for the bot" }),
      h("p", { text: "The phone reads one file, data.json, from this same folder. It is not here yet." }),
      h("p", {}, [document.createTextNode("On the server, run "), h("code", { text: "python3 publish_data.py" }), document.createTextNode(". This page tries again every minute.")]),
      h("p", { text: err && err.message ? String(err.message) : "" })
    ]));
  }

  function load() {
    var file = state.sample ? "sample_data.json" : "data.json";
    fetch(file + "?ts=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("Could not read " + file + " (" + r.status + ")");
      return r.json();
    }).then(function (data) {
      if (!data || !data.account) throw new Error(file + " has no account");
      state.data = data;
      state.failedRefresh = false;
      render();
    }).catch(function (e) {
      if (state.data) {
        state.failedRefresh = true;
        render();
      } else {
        showError(e);
      }
    });
  }

  function boot() {
    state.sample = new URLSearchParams(location.search).get("sample") === "1";
    window.addEventListener("scroll", markNav, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") load();
    });
    load();
    setInterval(load, 60000);
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
