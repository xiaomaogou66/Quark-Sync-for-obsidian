import type { RemoteEntry } from '~/remote/remote-fs.interface'

/**
 * Pure path helpers behind the remote directory picker.
 *
 * Kept separate from the modal so the navigation logic is unit testable.
 */

/** Collapses duplicate slashes and drops the trailing one (root stays `/`). */
export function normalizeDirPath(path: string): string {
	const trimmed = `/${path}`.replace(/\/{2,}/g, '/')
	return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : '/'
}

export function joinDirPath(parent: string, name: string): string {
	const base = normalizeDirPath(parent)
	return base === '/' ? `/${name}` : `${base}/${name}`
}

export function parentDirPath(path: string): string {
	const normalized = normalizeDirPath(path)
	if (normalized === '/') {
		return '/'
	}
	const index = normalized.lastIndexOf('/')
	return index <= 0 ? '/' : normalized.slice(0, index)
}

export interface DirBreadcrumb {
	label: string
	path: string
}

/** `'/quark/vault'` → `[根/, quark, vault]`. */
export function breadcrumbs(
	path: string,
	rootLabel: string,
): DirBreadcrumb[] {
	const normalized = normalizeDirPath(path)
	const crumbs: DirBreadcrumb[] = [{ label: rootLabel, path: '/' }]
	if (normalized === '/') {
		return crumbs
	}
	let current = ''
	for (const segment of normalized.split('/').filter(Boolean)) {
		current = `${current}/${segment}`
		crumbs.push({ label: segment, path: current })
	}
	return crumbs
}

/** Directories first, then case-insensitive name order. */
export function sortDirEntries(entries: RemoteEntry[]): RemoteEntry[] {
	return [...entries]
		.filter((entry) => entry.isDir)
		.sort((a, b) =>
			a.basename.localeCompare(b.basename, undefined, {
				numeric: true,
				sensitivity: 'base',
			}),
		)
}

/**
 * Suggests the folder a user most likely wants.
 *
 * `<current>/<vaultName>` when that does not exist yet, otherwise the current
 * path itself. Used for the "create and use" shortcut.
 */
export function suggestTargetDir(currentPath: string, vaultName: string): string {
	return joinDirPath(currentPath, vaultName.trim() || 'vault')
}
