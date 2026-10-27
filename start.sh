#!/usr/bin/env bash
cd "$(dirname "$0")"; mkdir -p logs
if [ -f logs/bot.pid ] && kill -0 "$(cat logs/bot.pid)" 2>/dev/null; then echo "Already running (pid $(cat logs/bot.pid))"; exit 0; fi
nohup setsid ./run_forever.sh > logs/runner.out 2>&1 &
echo $! > logs/bot.pid; echo "Started paper bot, pid $(cat logs/bot.pid)"
