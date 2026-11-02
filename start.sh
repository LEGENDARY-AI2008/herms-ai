#!/bin/bash
set -e

export HERMES_HOME="${HERMES_HOME:-/opt/data}"
mkdir -p "$HERMES_HOME"

# First-boot config
[ -f "$HERMES_HOME/.env" ] || touch "$HERMES_HOME/.env"
if [ ! -f "$HERMES_HOME/config.yaml" ] && [ -f /opt/hermes/cli-config.yaml.example ]; then
  cp /opt/hermes/cli-config.yaml.example "$HERMES_HOME/config.yaml"
fi

# Personality (re-applied every boot, so edit SOUL.md on GitHub to change it)
cp /app/SOUL.md "$HERMES_HOME/SOUL.md"

# WhatsApp: restore saved login (WA_CREDS_B64) and enable the bridge only once paired
WA_SESSION="$HERMES_HOME/platforms/whatsapp/session"
mkdir -p "$WA_SESSION"
if [ ! -f "$WA_SESSION/creds.json" ] && [ -n "$WA_CREDS_B64" ]; then
  echo "$WA_CREDS_B64" | base64 -d > "$WA_SESSION/creds.json" || rm -f "$WA_SESSION/creds.json"
fi
if [ -f "$WA_SESSION/creds.json" ]; then
  export WHATSAPP_ENABLED=true
  export WHATSAPP_ALLOW_ALL_USERS=false
fi

# Write secrets from Render env vars into Hermes .env
write_env () {
  local key="$1" val="${!1}"
  [ -z "$val" ] && return 0
  grep -v "^${key}=" "$HERMES_HOME/.env" > "$HERMES_HOME/.env.tmp" || true
  echo "${key}=${val}" >> "$HERMES_HOME/.env.tmp"
  mv "$HERMES_HOME/.env.tmp" "$HERMES_HOME/.env"
}
for k in OPENROUTER_API_KEY HERMES_INFERENCE_PROVIDER HERMES_MODEL LLM_MODEL \
         TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USERS OPENAI_API_KEY OPENAI_BASE_URL \
         WHATSAPP_ENABLED WHATSAPP_ALLOWED_USERS WHATSAPP_ALLOW_ALL_USERS WHATSAPP_MODE; do
  write_env "$k"
done

# Web server: "/" for Render health + UptimeRobot, "/pair?key=PAIR_KEY" for WhatsApp pairing
python3 /app/pair_server.py &

if [ -n "$HERMES_MODEL" ]; then
  hermes config set model "$HERMES_MODEL" || true
fi
hermes config set whatsapp.unauthorized_dm_behavior ignore || true
exec hermes gateway run
