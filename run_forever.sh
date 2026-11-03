#!/usr/bin/env bash
# Runs live.py ~20 seconds after every quarter hour (when each 15m candle has just closed). Paper money only.
cd "$(dirname "$0")"
while true; do
  timeout -k 30 600 python3 live.py >> logs/live.log 2>&1 || echo "[$(date "+%F %T") Athens] live.py exit $? (timeout=124)" >> logs/live.log
  NOW=$(date +%s); NEXT=$(( (NOW/900 + 1) * 900 + 20 ))
  sleep $(( NEXT - NOW ))
done
