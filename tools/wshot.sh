#!/bin/bash
# Capture with Windows Chrome on the real GPU. usage: tools/wshot.sh <name-of-output-folder> name=query ...
# Images land in the Windows temp folder and are copied to shots/<folder>.
W=/mnt/c/Users/David/AppData/Local/Temp/rl-shot; out=$1; shift
mkdir -p "$(dirname "$0")/../shots/$out"
(cd $W && WSLENV=WAIT:W:H:TIMEOUT:HEADED node.exe shot.mjs "out/$out" "$@") && cp $W/out/$out/*.png "$(dirname "$0")/../shots/$out/"
