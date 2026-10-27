#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f logs/bot.pid ] && kill -- -"$(cat logs/bot.pid)" 2>/dev/null || kill "$(cat logs/bot.pid)" 2>/dev/null; rm -f logs/bot.pid; echo stopped
