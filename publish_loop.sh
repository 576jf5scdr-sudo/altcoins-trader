#!/bin/bash
cd /workspace/paper-bot
while true; do sleep 60; python3 publish_data.py >> logs/publish.log 2>&1; sleep 840; done
