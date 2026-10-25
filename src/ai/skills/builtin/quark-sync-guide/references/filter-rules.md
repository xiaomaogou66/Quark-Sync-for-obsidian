# Filter-rule compatibility contract

The sync filter uses gitignore-style path matching, not raw `.gitignore` files.

## Compatible behavior

- Rules are evaluated in order and the last matching rule wins.
- Excluded parent directories prune their descendants. A descendant can only be
  included after every excluded ancestor has been included again.
- `/`, a trailing `/`, `*`, `?`, bracket expressions, and the documented `**`
  positions follow gitignore path semantics.
- Blank patterns, escaping, unescaped trailing spaces, and path normalization
  follow the same behavior covered by the Git-generated oracle corpus.

## Intentional product extensions

- Include and exclude are explicit rule types. A leading `!` is therefore not
  parsed as negation.
- A leading `#` is a literal filename character, not a comment marker.
- Case sensitivity is stored per rule and is deterministic across devices. Git
  instead controls case folding for the repository through `core.ignoreCase`.
- A rule can be disabled (`disabled: true`); disabled rules do not match
  anything and behave as if absent, without being deleted from the list.
- Every rule is relative to the vault root. Nested `.gitignore` scopes are not
  supported.
- Wildcards operate on Unicode characters for user-facing vault names; Git's C
  wildmatch implementation can differ for multibyte names.
- Directory decisions are traversal decisions. For example, `directory/**`
  keeps `directory` traversable so a later child include can still take effect,
  even though `git check-ignore directory/` reports a direct pattern match.

Compatibility claims in product copy should use “gitignore-style path rules”,
not “complete `.gitignore` compatibility”.

## Config directory sync mode

The `configDirSyncMode` setting is layered on top of the filter rules:

- `none` excludes the whole config directory.
- `bookmarks` excludes the config directory except `bookmarks.json`.
- `all` adds no system rules: the config directory is included unless the
  user's own rules exclude it. A rule that matches the config directory itself
  (for example a catch-all hidden-path rule) still prunes the whole subtree, so
  `all` can intentionally sync nothing from the config directory until that
  rule is adjusted. The plugin warns about this before enabling `all`.
