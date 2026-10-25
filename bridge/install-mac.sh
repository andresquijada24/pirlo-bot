#!/bin/bash
# PIRLO BOT · Instalador del puente de EA para Mac.
# Uso (en la Terminal):
#   bash <(curl -fsSL https://raw.githubusercontent.com/andresquijada24/pirlo-bot/main/bridge/install-mac.sh)
set -euo pipefail
DIR="$HOME/.pirlo-bridge"
AGENT="$HOME/Library/LaunchAgents/app.pirlo.ea-bridge.plist"
RAW="https://raw.githubusercontent.com/andresquijada24/pirlo-bot/main/bridge"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"

echo "→ Descargando el puente…"
curl -fsSL "$RAW/pirlo-ea-bridge.sh" -o "$DIR/pirlo-ea-bridge.sh"
chmod 700 "$DIR/pirlo-ea-bridge.sh"

if [ -f "$DIR/config" ]; then
  echo "→ Ya había configuración: se conserva (clave y clubes)."
else
  read -r -p "ID del club en EA [55341]: " CLUB < /dev/tty || true
  CLUB="${CLUB:-55341}"
  read -r -p "Plataforma (common-gen5 = PS5/Xbox Series, common-gen4) [common-gen5]: " PLATFORM < /dev/tty || true
  PLATFORM="${PLATFORM:-common-gen5}"
  TOKEN="$(openssl rand -hex 32)"
  umask 077
  cat > "$DIR/config" <<CFG
EA_BRIDGE_TOKEN='$TOKEN'
CLUBS='$CLUB:$PLATFORM'
PIRLO_URL='https://pirlo-bot.vercel.app'
CFG
  printf '%s' "$TOKEN" | pbcopy
  echo
  echo "✅ Clave del puente creada y COPIADA al portapapeles (no se muestra en pantalla)."
  echo "   Pégala ahora en Vercel → pirlo-bot → Settings → Environment Variables:"
  echo "   Nombre: EA_BRIDGE_TOKEN · Sensitive · Production y Preview."
fi

cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.pirlo.ea-bridge</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/pirlo-ea-bridge.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$DIR/bridge.err</string>
</dict></plist>
PLIST
launchctl unload "$AGENT" 2>/dev/null || true
launchctl load "$AGENT"
echo
echo "✅ Puente instalado: se ejecuta cada 5 minutos mientras el Mac esté encendido."
echo "   Ver actividad:  tail -n 20 ~/.pirlo-bridge/bridge.log"
echo "   Desinstalar:    launchctl unload $AGENT && rm -rf $DIR $AGENT"
