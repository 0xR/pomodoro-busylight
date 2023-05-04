#!/usr/bin/env bash
set -o pipefail
set -o nounset
set -o errexit

#dimensions=$(xdpyinfo | awk '/dimensions/{print $2}')
#w=$(echo "$dimensions" | cut -f1 -dx); \
#h=$(echo "$dimensions" | cut -f2 -dx); \
w=2000
h=2000
zenity --error \
--text "<span size=\"xx-large\" weight=\"bold\">$1</span>" \
--width="$w" --height="$h" &
