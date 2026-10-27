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
  var BOARD = { x: 138, y: 78, w: 104, h: 74 };
  var EYES = [
    { id: "pupil-l", cx: 56, cy: 114 },
    { id: "pupil-r", cx: 86, cy: 107 }
  ];
  var MOUTH = {
    wait: "M52 136 Q72 148 92 134",
    trade: "M56 138 Q74 142 92 136",
    profit: "M50 132 Q74 154 98 130",
    loss: "M50 150 Q74 128 98 150"
  };
  var BROW = {
    wait: ["M44 96 Q56 88 68 96", "M74 90 Q88 82 102 92"],
    trade: ["M44 102 Q56 100 68 102", "M74 96 Q88 94 102 98"],
    profit: ["M44 94 Q56 86 68 94", "M74 88 Q88 80 102 90"],
    loss: ["M46 100 Q56 108 68 100", "M74 94 Q88 104 102 96"]
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
    if (pos.length) return "trade";
    if (pnl > 0.05) return "profit";
    if (pnl < -0.05) return "loss";
    return "wait";
  }

  function linePoints(values) {
    var padX = 12, padY = 12;
    var x0 = BOARD.x + padX;
    var y0 = BOARD.y + padY;
    var w = BOARD.w - padX * 2;
    var ht = BOARD.h - padY * 2;
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var flat = hi - lo < 1e-6;
    return values.map(function (v, i) {
      var x = values.length === 1 ? x0 + w / 2 : x0 + (i / (values.length - 1)) * w;
      var y = flat ? y0 + ht * 0.55 : y0 + ht - ((v - lo) / (hi - lo)) * ht;
      return [x, y];
    });
  }

  function pathFrom(pts) {
    return pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
  }

  function sparkColor(values) {
    var a = values[0], b = values[values.length - 1];
    if (Math.abs(b - a) < 0.05) return "#FFB067";
    return b >= a ? "#3DDC84" : "#FF5A5F";
  }

  function stageMarkup() {
    return '<svg class="mascot" viewBox="0 0 250 196" aria-hidden="true">' +
      '<defs><radialGradient id="pebble" cx="32%" cy="28%" r="72%">' +
      '<stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#f6f3f0"/><stop offset="100%" stop-color="#d3ccc5"/>' +
      '</radialGradient></defs>' +
      '<rect class="board" x="138" y="78" width="104" height="74" rx="14" fill="#120e0b" stroke="#4a2c18" stroke-width="2"/>' +
      '<path class="spark-area" fill="#3DDC84" opacity="0"/>' +
      '<path class="spark" fill="none" stroke="#FFB067" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d=""/>' +
      '<circle class="tip" r="3.2" fill="#fff" opacity="0"/>' +
      '<g class="guy">' +
      '<ellipse cx="78" cy="176" rx="48" ry="7" fill="#000" opacity="0.28"/>' +
      '<ellipse cx="58" cy="166" rx="13" ry="7" fill="#efeae5"/>' +
      '<ellipse cx="98" cy="164" rx="13" ry="7" fill="#e6e0da"/>' +
      '<path d="M48 132 C 30 142 24 158 34 166" fill="none" stroke="#f4f0eb" stroke-width="11" stroke-linecap="round"/>' +
      '<circle cx="34" cy="168" r="7.5" fill="#fff" stroke="#e4ddd6" stroke-width="1"/>' +
      '<path fill="url(#pebble)" d="M34 154 C 26 128 32 96 56 80 C 76 66 108 66 124 84 C 140 102 144 132 132 154 C 122 172 96 180 68 178 C 46 176 36 166 34 154 Z"/>' +
      '<ellipse cx="104" cy="128" rx="11" ry="6.5" fill="#ffb088" opacity="0.5"/>' +
      '<path class="brow" d="M44 96 Q56 88 68 96" fill="none" stroke="#1c1917" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="brow" d="M74 90 Q88 82 102 92" fill="none" stroke="#1c1917" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse class="eye" cx="56" cy="114" rx="9" ry="11" fill="#1c1917"/>' +
      '<ellipse class="eye" cx="86" cy="107" rx="9" ry="11" fill="#1c1917"/>' +
      '<circle id="pupil-l" cx="58" cy="114" r="3.2" fill="#fff"/>' +
      '<circle id="pupil-r" cx="88" cy="107" r="3.2" fill="#fff"/>' +
      '<ellipse class="lid" data-cx="56" data-cy="114" cx="56" cy="114" rx="10" ry="12" fill="#f6f3f0" transform="translate(56 114) scale(1 0.05) translate(-56 -114)"/>' +
      '<ellipse class="lid" data-cx="86" data-cy="107" cx="86" cy="107" rx="10" ry="12" fill="#f6f3f0" transform="translate(86 107) scale(1 0.05) translate(-86 -107)"/>' +
      '<path class="mouth" d="M52 136 Q72 148 92 134" fill="none" stroke="#1c1917" stroke-width="3.4" stroke-linecap="round"/>' +
      '<g class="sweat" opacity="0"><path d="M116 58c0-18 18-20 18-3 0 13-18 18-18 3z" fill="#9ad8ff"/><ellipse cx="125" cy="76" rx="6" ry="3.6" fill="#9ad8ff"/></g>' +
      '</g>' +
      '<g class="reach">' +
      '<path class="arm" fill="none" stroke="#f7f4f0" stroke-width="11" stroke-linecap="round"/>' +
      '<circle class="hand" r="8" fill="#fff" stroke="#e4ddd6" stroke-width="1"/>' +
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
    var values = watchSeries(D);
    var pts = linePoints(values);
    var col = sparkColor(values);
    svg.setAttribute("class", "mascot mood-" + mood);
    var spark = svg.querySelector(".spark");
    var area = svg.querySelector(".spark-area");
    var tip = svg.querySelector(".tip");
    var mouth = svg.querySelector(".mouth");
    var guy = svg.querySelector(".guy");
    var sweat = svg.querySelector(".sweat");
    var arm = svg.querySelector(".arm");
    var hand = svg.querySelector(".hand");
    var brows = svg.querySelectorAll(".brow");
    var lids = svg.querySelectorAll(".lid");
    var eyes = svg.querySelectorAll(".eye");
    var pupils = EYES.map(function (eye) { return { eye: eye, el: svg.querySelector("#" + eye.id) }; });
    spark.setAttribute("d", pathFrom(pts));
    spark.setAttribute("stroke", col);
    var sparkLen = spark.getTotalLength();
    if (!sparkLen || !isFinite(sparkLen)) sparkLen = 1;
    spark.setAttribute("stroke-dasharray", sparkLen.toFixed(2));
    area.setAttribute("d", pathFrom(pts) + " L" + pts[pts.length - 1][0].toFixed(1) + " " + (BOARD.y + BOARD.h - 12) + " L" + pts[0][0].toFixed(1) + " " + (BOARD.y + BOARD.h - 12) + " Z");
    area.setAttribute("fill", col);
    tip.setAttribute("fill", col);
    if (mouth) mouth.setAttribute("d", MOUTH[mood]);
    if (brows.length === 2) {
      brows[0].setAttribute("d", BROW[mood][0]);
      brows[1].setAttribute("d", BROW[mood][1]);
    }
    var ry = mood === "wait" ? 12 : mood === "trade" ? 8 : mood === "loss" ? 10.5 : 10.5;
    eyes.forEach(function (el) { el.setAttribute("ry", ry); });

    function pointAt(p) {
      if (!pts.length) return [BOARD.x + BOARD.w * 0.5, BOARD.y + BOARD.h * 0.5];
      var idx = Math.max(0, Math.min(1, p)) * (pts.length - 1);
      var i = Math.max(0, Math.min(pts.length - 1, Math.floor(idx)));
      var f = Math.max(0, idx - i);
      var a = pts[i];
      var b = pts[Math.min(pts.length - 1, i + 1)] || a;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    function look(x, y) {
      var mid = BOARD.y + BOARD.h * 0.5;
      var along = (y - mid) / (BOARD.h * 0.42);
      if (along > 1) along = 1;
      if (along < -1) along = -1;
      var roomY = mood === "trade" ? 3.2 : 6.2;
      var bias = mood === "loss" ? 1.4 : mood === "wait" ? -1.1 : 0;
      pupils.forEach(function (p) {
        if (!p.el) return;
        var ang = Math.atan2(y - p.eye.cy, x - p.eye.cx);
        var ox = Math.cos(ang) * 5.2;
        var oy = Math.sin(ang) * 1.4 + along * roomY + bias;
        var nx = ox / 5.2;
        var ny = oy / roomY;
        var n = Math.hypot(nx, ny);
        if (n > 1) { ox /= n; oy /= n; }
        p.el.setAttribute("cx", (p.eye.cx + ox).toFixed(2));
        p.el.setAttribute("cy", (p.eye.cy + oy).toFixed(2));
      });
    }
    function world(x, y, bob, breath, lean) {
      var lx = x - 78;
      var ly = (y - 160) * breath;
      var rad = lean * Math.PI / 180;
      var c = Math.cos(rad);
      var s = Math.sin(rad);
      return [lx * c + ly * s + 78, -lx * s + ly * c + 160 + bob];
    }
    function pose(t, draw) {
      var bob = Math.sin(t * 1.65) * (mood === "profit" ? 1.05 : 1.45);
      if (mood === "profit") bob -= Math.pow(Math.sin(t * 2.45) * Math.sin(t * 2.45), 0.75) * 5.2;
      var breath = 1 + Math.sin(t * 1.8) * (reduce ? 0 : 0.02);
      var lean = mood === "trade" ? 12 : mood === "wait" ? 4 : mood === "loss" ? 7 : 6;
      guy.setAttribute("transform", "translate(0 " + bob.toFixed(2) + ") translate(78 160) rotate(" + lean + ") scale(1 " + breath.toFixed(4) + ") translate(-78 -160)");
      var shoulder = world(108, 124, bob, breath, lean);
      var hx = 146;
      var hy = 114;
      var cx = (shoulder[0] + hx) * 0.5 + 2;
      var cy = Math.min(shoulder[1], hy) - 10;
      arm.setAttribute("d", "M" + shoulder[0].toFixed(1) + " " + shoulder[1].toFixed(1) + " Q" + cx.toFixed(1) + " " + cy.toFixed(1) + " " + hx + " " + hy);
      hand.setAttribute("cx", String(hx));
      hand.setAttribute("cy", String(hy));
      var lidK = 0.05;
      var blinkT = t % 4.7;
      if (!reduce && blinkT > 4.4) {
        var u = (blinkT - 4.4) / 0.26;
        var tri = u < 0.5 ? u * 2 : Math.max(0, 1 - (u - 0.5) * 2);
        lidK = 0.05 + tri * 0.95;
      }
      lids.forEach(function (el) {
        var cx = +el.getAttribute("data-cx");
        var cy = +el.getAttribute("data-cy");
        el.setAttribute("transform", "translate(" + cx + " " + cy + ") scale(1 " + lidK.toFixed(3) + ") translate(" + (-cx) + " " + (-cy) + ")");
      });
      if (mood === "loss") {
        var drip = reduce ? 0.4 : (t % 2.5) / 2.5;
        var op = drip < 0.12 ? drip / 0.12 : drip > 0.8 ? Math.max(0, 1 - (drip - 0.8) / 0.2) : 1;
        sweat.setAttribute("opacity", op.toFixed(2));
        sweat.setAttribute("transform", "translate(0 " + ((reduce ? 6 : drip * 16)).toFixed(2) + ")");
      } else {
        sweat.setAttribute("opacity", "0");
      }
      var e = reduce ? 1 : Math.max(0, Math.min(1, draw));
      e = 1 - Math.pow(1 - e, 3);
      spark.setAttribute("stroke-dashoffset", ((1 - e) * sparkLen).toFixed(2));
      area.setAttribute("opacity", (0.2 * e).toFixed(3));
      var xy = pointAt(e);
      tip.setAttribute("cx", xy[0].toFixed(2));
      tip.setAttribute("cy", xy[1].toFixed(2));
      tip.setAttribute("opacity", e > 0.04 ? "1" : "0");
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
      pose(elapsed / 1000, (elapsed - 320) / 2300);
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
