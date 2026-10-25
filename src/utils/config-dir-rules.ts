import type QuarkSyncPlugin from '~/index'
import GlobMatch, {
	compileFilterRules,
	type GlobFilterRule,
	type GlobMatchOptions,
	isPathIncluded,
	isVoidGlobMatchOptions,
} from './glob-match'
import {
	REMOTE_SYNC_CACHE_DIR,
	REMOTE_SYNC_CACHE_FILENAME,
	getSyncCacheLocalPath,
} from './sync-cache-file'

export type ConfigDirSyncMode = 'none' | 'bookmarks' | 'all'

export interface EffectiveFilterRules {
	rules: GlobFilterRule[]
	configDir: string
	configDirSyncMode: ConfigDirSyncMode
}

export interface ConfigDirFilterRuleInput {
	rules: GlobFilterRule[]
}

const CONFIG_DIR_SYSTEM_EXCLUSION_SUFFIXES = [
	'plugins/**/node_modules',
	'plugins/**/.git',
	'plugins/**/.pnpm-store',
	'plugins/quark-sync/data.local.json',
	`${REMOTE_SYNC_CACHE_DIR}/${REMOTE_SYNC_CACHE_FILENAME}`,
	'workspace',
	'workspace.json',
] as const

function makeCaseSensitiveRule(
	expr: string,
	type: 'include' | 'exclude' = 'exclude',
): GlobFilterRule {
	return { expr, options: { caseSensitive: true }, type }
}

export function getConfigDirSystemTraversalRules(
	configDir: string,
): GlobMatchOptions[] {
	return CONFIG_DIR_SYSTEM_EXCLUSION_SUFFIXES.map((suffix) =>
		makeCaseSensitiveRule(`${configDir}/${suffix}`),
	)
}

export function getConfigDirSystemFilterRules(
	configDir: string,
): GlobFilterRule[] {
	return CONFIG_DIR_SYSTEM_EXCLUSION_SUFFIXES.flatMap((suffix) => [
		makeCaseSensitiveRule(`${configDir}/${suffix}`),
		makeCaseSensitiveRule(`${configDir}/${suffix}/**`),
	])
}

/**
 * The remote traversal cache is implementation state, but its current remote
 * location is inside the vault config directory. Respect the config-directory
 * sync mode and the user's own filter rules before accessing it.
 *
 * System filter rules are intentionally not considered here: they prevent the
 * cache file from being synchronized as user content, while this check decides
 * whether the cache service may access its dedicated remote storage.
 */
export function shouldUseRemoteTraversalCache(
	configDir: string,
	mode: ConfigDirSyncMode,
	filterRules: ConfigDirFilterRuleInput,
): boolean {
	if (mode !== 'all') {
		return false
	}
	return isPathIncluded(
		getSyncCacheLocalPath(configDir),
		compileFilterRules(filterRules.rules),
	)
}

/**
 * Returns the filter rule that last matches the config directory directory
 * node when it is an exclude — the rule that actually prunes the config
 * directory subtree in `all` mode. Returns undefined when no rule prunes it.
 *
 * Used to tell the user exactly which rule prevents "Sync all" from syncing
 * the config directory.
 */
export function getConfigDirPruningRule(
	configDir: string,
	rules: GlobFilterRule[],
): GlobFilterRule | undefined {
	const candidate = `${configDir}/`
	let last: GlobFilterRule | undefined
	for (const rule of rules) {
		if (rule.disabled === true || isVoidGlobMatchOptions(rule)) {
			continue
		}
		if (new GlobMatch(rule.expr, rule.options).test(candidate)) {
			last = rule
		}
	}
	return last?.type === 'exclude' ? last : undefined
}

export function computeEffectiveFilterRulesFromParts(
	configDir: string,
	mode: ConfigDirSyncMode,
	filterRules: ConfigDirFilterRuleInput,
): EffectiveFilterRules {
	const rules: GlobFilterRule[] = [...filterRules.rules]

	if (mode === 'none') {
		rules.push({
			expr: configDir,
			options: { caseSensitive: false },
			type: 'exclude',
		})
	} else if (mode === 'bookmarks') {
		// gitignore-style: re-include the config dir itself first so the
		// parent is not pruned. Root-anchor this slashless rule so it does not
		// re-include nested directories with the same name.
		rules.push({
			expr: `/${configDir}`,
			options: { caseSensitive: false },
			type: 'include',
		})
		rules.push({
			expr: `${configDir}/**`,
			options: { caseSensitive: false },
			type: 'exclude',
		})
		rules.push({
			expr: `${configDir}/bookmarks.json`,
			options: { caseSensitive: false },
			type: 'include',
		})
	}
	// mode === 'all': no additional rules — configDir traversed freely

	// System hard-exclusions come last so they always win (highest priority).
	rules.push(...getConfigDirSystemFilterRules(configDir))

	return {
		rules,
		configDir,
		configDirSyncMode: mode,
	}
}

/**
 * Returns true if `path` points to a file or folder inside this plugin's own
 * directory `<configDir>/plugins/quark-sync/` (or that directory itself).
 *
 * The plugin must never delete its own files during sync — when the remote
 * vault simply does not have the plugin installed, the local plugin files
 * should be preserved, not removed. Used by mirror deciders to short-circuit
 * self-deletion.
 */
export function isPluginSelfPath(path: string, configDir: string): boolean {
	const pluginDir = `${configDir}/plugins/quark-sync`
	return path === pluginDir || path.startsWith(`${pluginDir}/`)
}

/**
 * Computes the effective exclusion/inclusion filter rules by merging the
 * user's stored rules with the system-managed configDir rules derived from
 * the current configDirSyncMode setting.
 *
 * Does NOT modify plugin.settings — returns a new rule set for use at
 * sync time only.
 */
export function computeEffectiveFilterRules(
	plugin: QuarkSyncPlugin,
): EffectiveFilterRules {
	const configDir = plugin.app.vault.configDir
	const mode: ConfigDirSyncMode = plugin.settings.configDirSyncMode ?? 'none'
	return computeEffectiveFilterRulesFromParts(
		configDir,
		mode,
		plugin.settings.filterRules,
	)
}
