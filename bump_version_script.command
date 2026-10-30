#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1

/Users/paranim/my-file-with-nooo-sync/my-software-requirment/venvs/quickcmd/bin/python3 bump_version_script.py
exit_code=$?
exit "$exit_code"
