#!/bin/bash
# 乐器百科音频补齐（Commons 独奏源，温和节奏 + 零进展长冷却）
cd "$(dirname "$0")/.."
for i in $(seq 1 40); do
  A=$(ls tools/instrument-atlas/assets/audio/*.mp3 2>/dev/null | wc -l | tr -d ' ')
  if [ "$A" -ge 50 ]; then
    echo "[$(date +%H:%M:%S)] 已达 $A/50，退出"
    exit 0
  fi
  IA_PROXY=http://127.0.0.1:7890 timeout 200 node scripts/instrument-assets.mjs fetch > /tmp/fx.log 2>&1
  A=$(ls tools/instrument-atlas/assets/audio/*.mp3 2>/dev/null | wc -l | tr -d ' ')
  OK=$(grep -cE '^✓' /tmp/fx.log)
  echo "[$(date +%H:%M:%S)] 第 $i 轮 +${OK} → $A/50"
  grep -E '^✓' /tmp/fx.log | tail -3
  if [ "$A" -ge 50 ]; then
    echo "全部齐了"
    exit 0
  fi
  if [ "$OK" -eq 0 ]; then
    echo "零进展，冷却 330s 等限流窗口"
    sleep 330
  else
    sleep 25
  fi
done
echo "循环结束，最终 $(ls tools/instrument-atlas/assets/audio/*.mp3 2>/dev/null | wc -l | tr -d ' ')/50"
