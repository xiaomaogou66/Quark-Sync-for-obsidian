import { basename, dirname } from 'path-browserify'
import type {
	RemoteEntry,
	RemoteFileContent,
	RemoteFs,
	WriteRemoteFileOptions,
} from '~/remote/remote-fs.interface'
import { normalizeRemoteMtime } from '~/remote/remote-fs.interface'
import type { QuarkOverwriteMode } from '~/settings'
import { stdRemotePath } from '~/utils/std-remote-path'
import { QUARK_ROOT_FID } from './constants'
import type { QuarkHttpFn } from './http'
import { md5Hex } from './md5'
import type { QuarkClient } from './quark-client'
import type { QuarkFile } from './types'

/**
 * Storage for the `path → fid` map.
 *
 * Injected instead of imported so the adapter stays independent of Obsidian's
 * IndexedDB layer (unit tests and the live probe supply an in-memory map).
 */
export interface QuarkFidStore {
	get(key: string): Promise<Record<string, string> | null | undefined>
	set(key: string, value: Record<string, string>): Promise<unknown>
	unset?(key: string): Promise<void>
}

export interface QuarkRemoteFsOptions {
	client: QuarkClient
	http: QuarkHttpFn
	/** Folder that acts as `/` for the sync engine (usually root, fid `0`). */
	rootFid?: string
	/** KV namespace for the path → fid map. */
	kvKey: string
	fidStore: QuarkFidStore
	/**
	 * How to handle "upload over an existing name".
	 * - `reuse`: let `same_path_reuse` on the server decide (fewest requests).
	 * - `delete-first`: delete the existing fid, then upload (guarantees a
	 *   single entry, at the cost of recycle-bin litter).
	 */
	overwriteMode?: QuarkOverwriteMode
	onProgress?: (message: string) => void
}

/**
 * `RemoteFs` implementation for Quark Drive.
 *
 * Quark is fid addressed: there is no `stat(path)` and no atomic rename-by-path,
 * so this class maintains a persisted `path → fid` map, hydrated lazily from
 * directory listings and updated on every mutation.
 */
export class QuarkRemoteFs implements RemoteFs {
	readonly kind = 'quark' as const

	private readonly client: QuarkClient
	private readonly http: QuarkHttpFn
	private readonly rootFid: string
	private readonly kvKey: string
	private readonly fidStore: QuarkFidStore
	private readonly overwriteMode: QuarkOverwriteMode
	private readonly onProgress?: (message: string) => void

	private fids = new Map<string, string>()
	private initialized = false
	private persistPromise: Promise<void> | null = null
	private persistDirty = false
	private listingsSincePersist = 0

	constructor(options: QuarkRemoteFsOptions) {
		this.client = options.client
		this.http = options.http
		this.rootFid = options.rootFid ?? QUARK_ROOT_FID
		this.kvKey = options.kvKey
		this.fidStore = options.fidStore
		this.overwriteMode = options.overwriteMode ?? 'reuse'
		this.onProgress = options.onProgress
	}

	async init() {
		if (this.initialized) {
			return
		}
		const stored = await this.fidStore.get(this.kvKey)
		if (stored) {
			this.fids = new Map(Object.entries(stored))
		}
		this.fids.set('/', this.rootFid)
		if (!this.client.userId) {
			await this.client.userInfo()
		}
		this.initialized = true
	}

	private normalize(path: string) {
		const std = stdRemotePath(path)
		return std.length > 1 ? std.slice(0, -1) : std
	}

	private segments(path: string) {
		return this.normalize(path)
			.split('/')
			.filter((segment) => segment.length > 0)
	}

	private toEntry(file: QuarkFile, parentPath: string): RemoteEntry {
		const isDir = this.client.isFolder(file)
		const path =
			this.normalize(parentPath) === '/'
				? `/${file.filename}`
				: `${this.normalize(parentPath)}/${file.filename}`
		return {
			path,
			basename: file.filename,
			isDir,
			size: isDir ? 0 : (file.size ?? 0),
			mtime: normalizeRemoteMtime(file.updated_at),
			id: file.fid,
			hash: file.content_hash || undefined,
		}
	}

	/**
	 * Persists the fid map.
	 *
	 * Coalesced instead of debounced: while a write is in flight further calls
	 * only mark the map dirty, and the running writer loops once more. This
	 * keeps IndexedDB traffic bounded without depending on timers (which behave
	 * differently in popout windows and unit tests).
	 */
	private async persist() {
		if (this.persistPromise) {
			this.persistDirty = true
			return this.persistPromise
		}
		this.persistPromise = (async () => {
			do {
				this.persistDirty = false
				await this.fidStore.set(this.kvKey, Object.fromEntries(this.fids))
			} while (this.persistDirty)
			this.persistPromise = null
		})()
		return this.persistPromise
	}

	private schedulePersist() {
		void this.persist()
	}

	async flush() {
		await this.persist()
	}

	private async rawList(path: string, create: boolean): Promise<QuarkFile[]> {
		const fid = await this.fidOf(path, create)
		const files = await this.client.list(fid)
		for (const file of files) {
			this.fids.set(this.join(path, file.filename), file.fid)
		}
		this.listingsSincePersist += 1
		if (this.listingsSincePersist >= 25) {
			this.listingsSincePersist = 0
			this.schedulePersist()
		}
		return files
	}

	private join(parentPath: string, name: string) {
		const parent = this.normalize(parentPath)
		return parent === '/' ? `/${name}` : `${parent}/${name}`
	}

	/**
	 * Resolves (and optionally creates) the fid for `path`.
	 * Walks segment by segment because Quark has no lookup-by-path endpoint.
	 */
	private async fidOf(path: string, create = false): Promise<string> {
		await this.init()
		const normalized = this.normalize(path)
		if (normalized === '/') {
			return this.rootFid
		}

		const cached = this.fids.get(normalized)
		if (cached) {
			return cached
		}

		let currentPath = ''
		let currentFid = this.rootFid

		for (const segment of this.segments(normalized)) {
			const nextPath =
				currentPath === '' ? `/${segment}` : `${currentPath}/${segment}`
			const known = this.fids.get(nextPath)
			if (known) {
				currentPath = nextPath
				currentFid = known
				continue
			}

			const siblings = await this.client.list(currentFid)
			const match = siblings.find(
				(file) => file.filename === segment && this.client.isFolder(file),
			)
			if (match) {
				this.fids.set(nextPath, match.fid)
				currentPath = nextPath
				currentFid = match.fid
				continue
			}

			if (!create) {
				throw new Error(`[quark] remote folder not found: ${nextPath}`)
			}

			this.onProgress?.(`mkdir ${nextPath}`)
			await this.client.mkdir(currentFid, segment)
			const created = (await this.client.list(currentFid)).find(
				(file) => file.filename === segment && this.client.isFolder(file),
			)
			if (!created) {
				throw new Error(`[quark] failed to create remote folder: ${nextPath}`)
			}
			this.fids.set(nextPath, created.fid)
			currentPath = nextPath
			currentFid = created.fid
		}

		this.schedulePersist()
		return currentFid
	}

	private async findEntry(path: string): Promise<QuarkFile | undefined> {
		const normalized = this.normalize(path)
		if (normalized === '/') {
			return undefined
		}
		const parent = dirname(normalized) || '/'
		const name = basename(normalized)
		const siblings = await this.rawList(parent, false)
		return siblings.find((file) => file.filename === name)
	}

	/**
	 * Single entry of a path, reusing the fid cache when possible.
	 *
	 * Downloads only need the fid, and the fid map is hydrated by `list()`, so a
	 * run of pulls inside one folder avoids a directory listing per file.
	 */
	private async fidOfEntry(path: string): Promise<string | undefined> {
		const normalized = this.normalize(path)
		const cached = this.fids.get(normalized)
		if (cached) {
			return cached
		}
		const entry = await this.findEntry(normalized)
		return entry?.fid
	}

	async exists(path: string) {
		if (this.normalize(path) === '/') {
			return true
		}
		try {
			const entry = await this.findEntry(path)
			return entry !== undefined
		} catch {
			return false
		}
	}

	async stat(path: string): Promise<RemoteEntry> {
		if (this.normalize(path) === '/') {
			return { path: '/', basename: '', isDir: true, size: 0 }
		}
		const entry = await this.findEntry(path)
		if (!entry) {
			throw new Error(`[quark] remote path not found: ${path}`)
		}
		return this.toEntry(entry, dirname(this.normalize(path)) || '/')
	}

	async list(path: string): Promise<RemoteEntry[]> {
		const parent = this.normalize(path)
		const files = await this.rawList(parent, false)
		return files.map((file) => this.toEntry(file, parent))
	}

	async mkdir(path: string) {
		await this.fidOf(path, true)
	}

	async readFile(path: string) {
		const fid = await this.fidOfEntry(path)
		if (!fid) {
			throw new Error(`[quark] remote file not found: ${path}`)
		}
		const { download_url } = await this.client.downloadUrl(fid)
		const response = await this.http({
			url: download_url,
			method: 'GET',
			headers: this.client.downloadHeaders(),
		})
		if (response.status >= 400) {
			throw new Error(
				`[quark] download failed (HTTP ${response.status}): ${path}`,
			)
		}
		return response.arrayBuffer
	}

	async readFileRange(path: string, offset: number, length: number) {
		const fid = await this.fidOfEntry(path)
		if (!fid) {
			throw new Error(`[quark] remote file not found: ${path}`)
		}
		const { download_url } = await this.client.downloadUrl(fid)
		const end = offset + length - 1
		const response = await this.http({
			url: download_url,
			method: 'GET',
			headers: {
				...this.client.downloadHeaders(),
				Range: `bytes=${offset}-${end}`,
			},
		})
		if (response.status !== 206) {
			throw new Error(
				`[quark] range download failed (HTTP ${response.status}): ${path}`,
			)
		}
		return response.arrayBuffer
	}

	async writeFile(
		path: string,
		data: RemoteFileContent,
		options?: WriteRemoteFileOptions,
	) {
		const buffer = toArrayBuffer(data)
		const normalized = this.normalize(path)
		const parent = dirname(normalized) || '/'
		const name = basename(normalized)
		const parentFid = await this.fidOf(parent, true)

		const { md5, sha1 } = await hashContent(buffer)

		const existing = (await this.client.list(parentFid)).find(
			(file) => file.filename === name,
		)

		if (existing && this.client.isFolder(existing)) {
			throw new Error(
				`[quark] remote path is a folder, cannot write file: ${path}`,
			)
		}
		if (existing && this.overwriteMode === 'delete-first') {
			const unchanged =
				existing.size === buffer.byteLength &&
				existing.content_hash?.toLowerCase() === sha1
			if (!unchanged) {
				await this.client.remove(existing.fid)
				this.fids.delete(normalized)
			}
		}

		await this.client.upload({
			parentFid,
			name,
			data: buffer,
			mime: guessMimeType(normalized),
			mtime: options?.mtime,
			md5,
			sha1,
		})

		// The fid of a rewritten file may change; let the next listing re-resolve.
		this.fids.delete(normalized)
		this.schedulePersist()
	}

	async remove(path: string) {
		const normalized = this.normalize(path)
		const fid = await this.fidOfEntry(normalized)
		if (!fid) {
			return
		}
		await this.client.remove(fid)
		this.fids.delete(normalized)
		// Drop descendants of the removed folder from the cache.
		const prefix = `${normalized}/`
		for (const key of [...this.fids.keys()]) {
			if (key.startsWith(prefix)) {
				this.fids.delete(key)
			}
		}
		this.schedulePersist()
	}

	async move(from: string, to: string) {
		const entry = await this.findEntry(from)
		if (!entry) {
			throw new Error(`[quark] cannot move missing path: ${from}`)
		}
		const targetParentFid = await this.fidOf(dirname(this.normalize(to)), true)
		const targetName = basename(this.normalize(to))

		if (entry.filename !== targetName) {
			await this.client.rename(entry.fid, targetName)
		}
		await this.client.move(entry.fid, targetParentFid)

		this.fids.delete(this.normalize(from))
		this.fids.delete(this.normalize(to))
		this.schedulePersist()
	}

}

function toArrayBuffer(data: RemoteFileContent): ArrayBuffer {
	if (typeof data === 'string') {
		return new TextEncoder().encode(data).buffer
	}
	return data
}

async function hashContent(data: ArrayBuffer) {
	const md5Hash = md5Hex(new Uint8Array(data))
	const sha1Buffer = await crypto.subtle.digest('SHA-1', data)
	const sha1 = [...new Uint8Array(sha1Buffer)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
	return { md5: md5Hash, sha1 }
}

const MIME_BY_EXTENSION: Record<string, string> = {
	md: 'text/markdown',
	txt: 'text/plain',
	json: 'application/json',
	canvas: 'application/json',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	pdf: 'application/pdf',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	zip: 'application/zip',
}

export function guessMimeType(path: string) {
	const extension = path.split('.').pop()?.toLowerCase() ?? ''
	return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}
