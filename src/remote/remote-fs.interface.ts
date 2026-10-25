import type { StatModel } from '~/model/stat.model'

/**
 * Backend-neutral description of one remote entry.
 *
 * Every remote backend (currently Quark Drive) is expected to
 * normalise its own payload into this shape so that the sync engine never has
 * to know which protocol it is talking to.
 */
export interface RemoteEntry {
	/** Absolute remote path, e.g. `/Apps/obsidian/note.md`. */
	path: string
	basename: string
	isDir: boolean
	size: number
	/** Milliseconds since epoch. Directories may legitimately lack this. */
	mtime?: number
	/** Backend-native id (Quark `fid`, WebDAV `etag`). */
	id?: string
	/** Backend-native content hash (Quark exposes SHA-1). */
	hash?: string
}

export interface WriteRemoteFileOptions {
	/** Preserve a local mtime on the remote side when the backend supports it. */
	mtime?: number
}

export type RemoteFileContent = ArrayBuffer | string

/**
 * The only surface the sync engine needs from a storage backend.
 *
 * Keep this interface small: every method added here has to be implemented for
 * every backend, and Quark in particular has no `stat`-by-path primitive (it is
 * fid addressed), so expensive operations are spelled out explicitly:
 * `list()` is the primitive, `stat()`/`exists()` are convenience wrappers.
 */
export interface RemoteFs {
	/** Backend discriminator, used to pick traversal strategies and UI copy. */
	readonly kind: 'quark' | 'webdav'

	/** One-off initialisation (token → user id, caches, ...). */
	init?(): Promise<void>

	exists(path: string): Promise<boolean>
	stat(path: string): Promise<RemoteEntry>
	list(path: string): Promise<RemoteEntry[]>

	/** Recursive: creates all missing parents. */
	mkdir(path: string): Promise<void>

	readFile(path: string): Promise<ArrayBuffer>
	/** Optional HTTP-Range read, used by the mobile chunked downloader. */
	readFileRange?(
		path: string,
		offset: number,
		length: number,
	): Promise<ArrayBuffer>

	writeFile(
		path: string,
		data: RemoteFileContent,
		options?: WriteRemoteFileOptions,
	): Promise<void>

	/** Removes a file, or a directory with all of its content. */
	remove(path: string): Promise<void>

	/** Optional rename/move, enables rename detection instead of delete+upload. */
	move?(from: string, to: string): Promise<void>
}

export function remoteEntryToStatModel(entry: RemoteEntry): StatModel {
	if (entry.isDir) {
		return {
			path: entry.path,
			basename: entry.basename,
			isDir: true,
			isDeleted: false,
			mtime: entry.mtime,
		}
	}
	return {
		path: entry.path,
		basename: entry.basename,
		isDir: false,
		isDeleted: false,
		mtime: entry.mtime ?? 0,
		size: entry.size,
	}
}

export function normalizeRemoteMtime(mtime: number | undefined) {
	if (mtime === undefined || !Number.isFinite(mtime)) {
		return undefined
	}
	return mtime > 0 ? mtime : undefined
}
