#!/bin/bash
# Run the smoke test with Windows Chrome (real GPU) from WSL.
W=/mnt/c/Users/David/AppData/Local/Temp/rl-shot; cp "$(dirname "$0")/smoke.mjs" $W/smoke.mjs && cd $W && node.exe smoke.mjs
