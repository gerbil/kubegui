#!/usr/bin/env bash
set -euo pipefail

reset_tty() {
  # Restore canonical tty behavior after Ctrl+C from Vite dev server.
  stty sane 2>/dev/null || true

  # Reset common terminal modes Vite/chokidar sessions can leave behind.
  {
    printf '\033[?25h'      # show cursor
    printf '\033[?7h'       # wrap mode on
    printf '\033[?1000l'    # mouse tracking off
    printf '\033[?1002l'    # mouse drag off
    printf '\033[?1003l'    # all-motion mouse off
    printf '\033[?1006l'    # SGR mouse off
    printf '\033[?2004l'    # bracketed paste off
  } > /dev/tty 2>/dev/null || true
}

trap reset_tty EXIT INT TERM

./node_modules/.bin/vite "$@"