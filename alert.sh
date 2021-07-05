#!/usr/bin/env bash
set -o pipefail
set -o nounset
set -o errexit

dimensions=$(xdpyinfo | awk '/dimensions/{print $2}')
w=$(echo "$dimensions" | cut -f1 -dx); \
h=$(echo "$dimensions" | cut -f2 -dx); \
zenity --error \
--text "$1" \
--width=$w --height=$h &
