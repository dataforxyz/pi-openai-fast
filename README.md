# pi-openai-fast

Pi extension for OpenAI Fast Mode.

## Install

```bash
pi install git:github.com/studioarray/pi-openai-fast
```

## Commands and CLI flags

- `/fast` toggles the desired Fast Mode state. With persistence enabled it writes `desiredActive`; with persistence disabled it is session-only. If the current model is unsupported or absent, the desired state stays true but Fast Mode remains inactive until an allow-listed model is selected.
- `--fast` starts one run with desired Fast Mode enabled and never writes config.

## Default supported models

```json
[
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5"
]
```

## Config

Config is read from Global Config at `~/.pi/agent/extensions/pi-openai-fast.json` and Project Config at `.pi/extensions/pi-openai-fast.json`.

By default, `/fast` is session-only because `persistState` defaults to `false`. Set `persistState` to `true` in JSON to have `/fast` write `desiredActive` for future sessions.

Default config:

```json
{
  "persistState": false,
  "desiredActive": false,
  "supportedModels": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5"
  ],
  "footer": {
    "mode": "replace",
    "vars": {},
    "darkFastColor": "#ff50be",
    "lightFastColor": "#d20000"
  }
}
```

`footer.mode` values:

- `replace` installs the Footer Clone and shows inline `fast` after the model name only while Fast Mode is active.
- `status` leaves Pi's footer in place and publishes only a `fast` status indicator while active.
- `off` leaves footer/status UI untouched.

Fast colors accept six-digit hex values, 256-color indexes, variable references from `footer.vars`, or an empty string for the terminal default foreground. Pi's built-in `light` theme uses `lightFastColor`; other themes use `darkFastColor`.


## Reference attribution

Inspired by https://github.com/mattleong/pi-better-openai/