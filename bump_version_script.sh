#!/usr/bin/env bash
# 如果在图形文件管理器中双击运行，自动调起终端窗口
if [ ! -t 0 ]; then
    if command -v x-terminal-emulator >/dev/null 2>&1; then
        exec x-terminal-emulator -e "$0" "$@"
    elif command -v gnome-terminal >/dev/null 2>&1; then
        exec gnome-terminal -- "$0" "$@"
    elif command -v ptyxis >/dev/null 2>&1; then
        exec ptyxis -- "$0" "$@"
    fi
fi

cd "$(dirname "$0")" || exit 1

/home/parani-ubt/my-file-with-nooo-sync/system-env/bin/python bump_version_script.py
status=$?
exit $status
