#!/usr/bin/env bash
# Every 5 min: restart bot if live.log idle >25 min; restart publish_loop if publish.log idle >40 min.
cd "$(dirname "$0")"; mkdir -p logs
log(){ echo "[$(date '+%F %T') Athens] $*" >> logs/watchdog.log; }
age(){ [ -f "$1" ] && echo $(( $(date +%s) - $(stat -c %Y "$1") )) || echo 999999; }
log "watchdog started pid $$"
while true; do
  A=$(age logs/live.log)
  if [ "$A" -gt 1500 ] || ! { [ -f logs/bot.pid ] && kill -0 "$(cat logs/bot.pid)" 2>/dev/null; }; then
    log "live.log idle ${A}s or runner dead -> restarting bot"
    pkill -f run_forever.sh; pkill -f 'python3 live.py'; sleep 2
    ./stop.sh >/dev/null 2>&1; ./start.sh >> logs/watchdog.log 2>&1
    (sleep 5; timeout 600 python3 live.py >> logs/live.log 2>&1) &
  fi
  P=$(age logs/publish.log)
  if [ "$P" -gt 2400 ] || ! pgrep -f publish_loop.sh >/dev/null; then
    log "publish.log idle ${P}s -> restarting publish_loop"
    pkill -f publish_loop.sh; sleep 1
    nohup setsid ./publish_loop.sh > /dev/null 2>&1 &
    log "publish_loop pid $!"
  fi
  sleep 300
done
