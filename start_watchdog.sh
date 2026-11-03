#!/usr/bin/env bash
cd "$(dirname "$0")"; mkdir -p logs
if [ -f logs/watchdog.pid ] && kill -0 "$(cat logs/watchdog.pid)" 2>/dev/null; then echo "Watchdog running (pid $(cat logs/watchdog.pid))"; exit 0; fi
nohup setsid ./watchdog.sh > /dev/null 2>&1 &
echo $! > logs/watchdog.pid; echo "Started watchdog, pid $!"
