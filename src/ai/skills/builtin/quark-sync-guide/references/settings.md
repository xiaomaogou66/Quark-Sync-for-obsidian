# Plugin Settings File

Use this reference when the user asks to change plugin sync settings, filters, or
toggles through the chat.

## What this file is

The plugin exposes a whitelist of settings as the virtual file
`/.config/quark-sync/settings.json`. It is not a real file on disk: it
reflects the live plugin settings, and every save is validated and applied on the
spot. It never contains credentials — account, credential, OAuth responses,
enterprise base URL, and AI provider API keys are deliberately excluded and can
never be read or set through it.

## Read the current settings first

```bash
cat /.config/quark-sync/settings.json
```

Always read the file before proposing or making a change, and preserve the
values of any keys you are not changing.

## How to change it

A write applies only the keys present in the JSON you save; keys you omit keep
their current value. The file must be valid JSON and must include at least one
supported setting.

- **With bash**: rewrite the file with `jq` or a direct write, for example:
  `cat /.config/quark-sync/settings.json | jq '.syncMode = "strict"' > /.config/quark-sync/settings.json`.
  An invalid write fails and changes nothing.
- **With apply_patch**: read the file first, then update it with a normal
  `*** Update File: /.config/quark-sync/settings.json` patch.

## Allowed keys and constraints

| Key                             | Type                                                                     | Notes                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filterRules`                   | object `{ rules: [...] }`                                                | Max 200 rules. Each rule: `expr` (non-empty glob string), `type` (`include` or `exclude`), optional `caseSensitive` (boolean), optional `disabled` (boolean, default `false`; disabled rules are ignored). |
| `skipLargeFiles`                | object `{ maxSize: string }`                                             | Byte-size string, at most `500MB` (for example `"50MB"`).                                                                                                                                                  |
| `startupSyncDelaySeconds`       | number                                                                   | Clamped to `0`–`86400`.                                                                                                                                                                                    |
| `autoSyncIntervalSeconds`       | number                                                                   | Clamped to `0`–`86400`.                                                                                                                                                                                    |
| `realtimeSync`                  | boolean                                                                  |                                                                                                                                                                                                            |
| `confirmBeforeSync`             | boolean                                                                  |                                                                                                                                                                                                            |
| `confirmBeforeDeleteInAutoSync` | boolean                                                                  |                                                                                                                                                                                                            |
| `syncMode`                      | `strict` or `loose`                                                      |                                                                                                                                                                                                            |
| `conflictStrategy`              | one of `no-conflict-merge`, `diff3`, `local-priority`, `server-priority` |                                                                                                                                                                                                            |
| `configDirSyncMode`             | one of `none`, `bookmarks`, `all`                                        | `none` excludes the config directory, `bookmarks` syncs only `bookmarks.json`, `all` adds no rules — the config directory is included unless your own filter rules exclude it.                             |
| `language`                      | `zh`, `en`, or `""`                                                      | Empty string means auto.                                                                                                                                                                                   |

No other key is allowed; an unknown key such as `credential` or `account` makes
the whole write fail so credentials can never be modified here.

Use this neutral example only when the user needs the file format:

```json
{
	"syncMode": "strict",
	"realtimeSync": true,
	"startupSyncDelaySeconds": 30,
	"skipLargeFiles": {
		"maxSize": "50MB"
	}
}
```

A successful save requests a settings update confirmation, applies the change
immediately, and does not require a restart. If a write fails, explain the
observed validation error before retrying.
