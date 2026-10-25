import { isAbsolute, join, normalize } from 'path-browserify'
import {
	compileFilterRules,
	GlobFilterRule,
	isPathIncluded,
} from '~/utils/glob-match'
import { isSub } from '~/utils/is-sub'
import { stdRemotePath } from '~/utils/std-remote-path'

function normalizeRemotePath(path: string): string {
	const normalized = normalize(path)
	return normalized.length > 1 && normalized.endsWith('/')
		? normalized.slice(0, -1)
		: normalized
}

/**
 * Builds the "should this remote directory be listed at all" predicate used to
 * prune the remote walk.
 *
 * Excluded directories are dropped from the walk *results* anyway, but listing
 * them still costs one round trip per level — a synced `.venv` can be a thousand
 * requests on its own. Paths are absolute here, so they are rebased onto the
 * remote base dir before matching against the (vault-relative) filter rules.
 */
export function buildDirPruningPredicate(
	remoteBaseDir: string,
	rules: GlobFilterRule[],
): (path: string) => boolean {
	const compiled = compileFilterRules(rules)
	if (compiled.length === 0) {
		return () => true
	}
	const base = normalizeRemotePath(stdRemotePath(remoteBaseDir))

	return (path: string) => {
		const absolutePath = normalizeRemotePath(
			isAbsolute(path) ? path : join(base, path),
		)
		if (absolutePath === base || !isSub(base, absolutePath)) {
			return true
		}
		const relativePath = absolutePath
			.slice(base === '/' ? 1 : base.length)
			.replace(/^\/+/, '')
		return isPathIncluded(relativePath, compiled, true)
	}
}
