# PayPal MCP token refresher

The PayPal AI Toolkit's sandbox MCP server needs `PAYPAL_SANDBOX_ACCESS_TOKEN` in `~/.claude/settings.json`, and sandbox tokens expire after about 8.5–9 hours. `refresh.py` mints a new token from the sandbox app's client ID and secret and writes it there. It never prints the token, refuses any non-sandbox base URL, writes the settings file atomically with mode 600, and logs only the outcome and expiry to `~/.config/stood/paypal-mcp-token.log`.

## Install (macOS)

```bash
mkdir -p ~/.config/stood && chmod 700 ~/.config/stood
cp .env ~/.config/stood/.env && chmod 600 ~/.config/stood/.env   # needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET
cp tools/paypal-mcp-token/refresh.py ~/.config/stood/refresh-paypal-mcp-token.py
chmod 700 ~/.config/stood/refresh-paypal-mcp-token.py
sed "s#__HOME__#$HOME#g" tools/paypal-mcp-token/com.stood.paypal-mcp-token.plist \
  > ~/Library/LaunchAgents/com.stood.paypal-mcp-token.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.stood.paypal-mcp-token.plist
tail -1 ~/.config/stood/paypal-mcp-token.log   # "refreshed; expires in … s"
```

It runs at login, every morning at 07:00 and every 8 hours. Claude Code reads the token when it starts, so after a refresh either restart Claude Code or run `/paypal:setup refresh` in the running session.

Remove it with `launchctl bootout gui/$(id -u)/com.stood.paypal-mcp-token`.
