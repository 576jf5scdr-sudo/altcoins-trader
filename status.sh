#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f logs/bot.pid ] && kill -0 "$(cat logs/bot.pid)" 2>/dev/null; then echo "RUNNING (pid $(cat logs/bot.pid))"; else echo "NOT running"; fi
tail -n 8 logs/live.log 2>/dev/null; echo; python3 -c "
import json;p=json.load(open('portfolio.json'));print('Equity EUR',p['equity_eur'],'| return %',p['total_return_pct'],'| cash',p['cash_eur'],'| open',list(p['open_positions']),'| updated',p['updated'])"
