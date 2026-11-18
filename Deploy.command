#!/bin/bash
# Frontend-only Pages publish. Never rebuilds the backend or touches the database.
# Finder has a minimal PATH; never rely on its working directory.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/share/pnpm:$PATH"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1
cd -- "$ROOT" || exit 1
python3 "$ROOT/scripts/deploy-instabox.py" "$@"
status=$?
if [ "$#" -eq 0 ] && [ -t 0 ]; then
  printf '\nDeployment exited with status %s. Press Return to close. ' "$status"
  read -r _
fi
exit "$status"
