import { isAbsolute, join, normalize } from 'path-browserify'
import type { FsWalkResult } from '~/fs/fs.interface'
import completeLossDir from '~/fs/utils/complete-loss-dir'
import type { StatModel } from '~/model/stat.model'
import {
	compileFilterRules,
	GlobFilterRule,
	isPathIncluded,
} from '~/utils/glob-match'
import { isSub } from '~/utils/is-sub'
import { stdRemotePath } from '~/utils/std-remote-path'
import { isSyncCacheLocalPath } from '~/utils/sync-cache-file'

export interface BuildRemoteWalkResultsOptions {
	traversedStats: StatModel[]
	remoteBaseDir: string
	configDir: string
	filterRules: { rules: GlobFilterRule[] }
}

function normalizeRemotePath(path: string): string {
	const normalized = normalize(path)
	return normalized.length > 1 && normalized.endsWith('/')
		? normalized.slice(0, -1)
		: normalized
}

/**
 * Converts absolute remote stats into vault-relative `FsWalkResult`s.
 *
 * Shared by every backend so that path normalisation, filter rules, sync-cache
 * exclusion and "parent directory was filtered out" repair behave identically
 * for Nutstore and Quark.
 */
export function buildRemoteWalkResults(
	options: BuildRemoteWalkResultsOptions,
): FsWalkResult[] {
	const { traversedStats, configDir } = options
	if (traversedStats.length === 0) {
		return []
	}

	const base = normalizeRemotePath(stdRemotePath(options.remoteBaseDir))
	const statsByLocalPath = new Map<string, StatModel>()
	for (const stat of traversedStats) {
		const absolutePath = normalizeRemotePath(
			isAbsolute(stat.path) ? stat.path : join(base, stat.path),
		)
		if (!isSub(base, absolutePath)) {
			continue
		}
		const localPath = absolutePath
			.slice(base === '/' ? 1 : base.length)
			.replace(/^\/+/, '')
		if (!statsByLocalPath.has(localPath)) {
			statsByLocalPath.set(localPath, { ...stat, path: localPath })
		}
	}
	const stats = [...statsByLocalPath.values()]

	const compiledRules = compileFilterRules(options.filterRules.rules)
	const includedStats = stats.filter(
		(stat) =>
			!isSyncCacheLocalPath(stat.path, configDir) &&
			isPathIncluded(stat.path, compiledRules, stat.isDir),
	)
	const completeStats = completeLossDir(stats, includedStats)
	const completeStatPaths = new Set(completeStats.map((s) => s.path))
	return stats.map((stat) => ({
		stat,
		ignored: !completeStatPaths.has(stat.path),
	}))
}
