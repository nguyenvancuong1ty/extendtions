# Reg_gpt

Browser automation utilities with optional proxy, SMS-Activate, and email
verification integrations.

## Local setup

1. Copy `config.example.json` to `config.json`.
2. Replace every placeholder with your own proxy, SMS, and email credentials.
3. Run the appropriate script, for example `python main.py`.

`config.json`, `accounts.txt`, browser profiles, and debug screenshots are kept
out of Git because they can contain credentials, sessions, or personal data.

`accounts.txt` is created automatically after a successful run. See
`accounts.example.txt` for its record format.
