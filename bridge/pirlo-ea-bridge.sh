#!/bin/bash
# PIRLO BOT · Puente de EA (Mac/Linux)
#
# Cada ejecución pide a EA los últimos partidos de cada club configurado y se los envía a PIRLO.
# Corre en un equipo con internet de casa porque EA bloquea las peticiones desde la nube.
# Solo lee de EA y envía a PIRLO; no guarda partidos ni toca ninguna base de datos.
set -u
DIR="${PIRLO_BRIDGE_DIR:-$HOME/.pirlo-bridge}"
CONFIG="$DIR/config"
LOG="$DIR/bridge.log"
[ -f "$CONFIG" ] || { echo "Falta $CONFIG. Ejecuta el instalador." >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"   # define EA_BRIDGE_TOKEN, CLUBS ("55341:common-gen5 otro:plataforma") y PIRLO_URL
PIRLO_URL="${PIRLO_URL:-https://pirlo-bot.vercel.app}"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# El registro no crece sin límite: se quedan las últimas 2000 líneas.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 4000 ]; then tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

for entry in $CLUBS; do
  club="${entry%%:*}"; platform="${entry##*:}"
  case "$club" in (*[!0-9]*|'') log "club no válido: $club"; continue;; esac
  for type in leagueMatch playoffMatch friendlyMatch; do
    url="https://proclubs.ea.com/api/fc/clubs/matches?platform=$platform&clubIds=$club&matchType=$type"
    code=$(curl -sS -o "$TMP/ea.json" -w '%{http_code}' --max-time 20 \
      -H "User-Agent: $UA" -H 'Accept: application/json' -H 'Referer: https://www.ea.com/' "$url" 2>/dev/null || echo 000)
    if [ "$code" != 200 ] || [ "$(head -c 1 "$TMP/ea.json")" != "[" ]; then
      log "EA $club $type → HTTP $code"; continue
    fi
    [ "$(cat "$TMP/ea.json")" = "[]" ] && continue
    { printf '{"platform":"%s","eaClubId":"%s","matchType":"%s","matches":' "$platform" "$club" "$type"
      cat "$TMP/ea.json"; printf '}'; } > "$TMP/body.json"
    res=$(curl -sS -o "$TMP/res.json" -w '%{http_code}' --max-time 30 -X POST \
      -H "Authorization: Bearer $EA_BRIDGE_TOKEN" -H 'Content-Type: application/json' \
      --data-binary @"$TMP/body.json" "$PIRLO_URL/api/ingest/ea" 2>/dev/null || echo 000)
    log "EA $club $type → PIRLO HTTP $res $(head -c 200 "$TMP/res.json" 2>/dev/null)"
  done
done
