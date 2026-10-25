import { basename as pathBasename } from 'path-browserify'
import type { FileStat, WebDAVClient } from 'webdav'
import { normalizeRemoteMtime } from '~/remote/remote-fs.interface'
import type {
	RemoteEntry,
	RemoteFileContent,
	RemoteFs,
	WriteRemoteFileOptions,
} from '~/remote/remote-fs.interface'

function toEntry(stat: FileStat): RemoteEntry {
	return {
		path: stat.filename,
		basename: stat.basename || pathBasename(stat.filename),
		isDir: stat.type === 'directory',
		size: typeof stat.size === 'number' ? stat.size : 0,
		mtime: normalizeRemoteMtime(
			stat.lastmod ? new Date(stat.lastmod).valueOf() : undefined,
		),
		id: stat.etag ?? undefined,
	}
}

/**
 * `RemoteFs` view over a `webdav` client.
 *
 * Used for WebDAV gateways that expose Quark Drive (Alist / OpenList), which is
 * the route that needs no Quark open-platform app credentials: the gateway owns
 * the Quark login and the plugin only speaks plain WebDAV to it.
 *
 * The adapter is a thin translation layer; rate limiting is applied by the
 * caller through `createRateLimitedWebDAVClient`.
 */
export class WebDAVRemoteFs implements RemoteFs {
	readonly kind = 'webdav' as const

	constructor(private readonly client: WebDAVClient) {}

	async exists(path: string) {
		return this.client.exists(path)
	}

	async stat(path: string): Promise<RemoteEntry> {
		const stat = (await this.client.stat(path, {
			details: false,
		})) as FileStat
		return toEntry(stat)
	}

	async list(path: string): Promise<RemoteEntry[]> {
		const contents = (await this.client.getDirectoryContents(path)) as
			| FileStat[]
			| { data: FileStat[] }
		const items = Array.isArray(contents) ? contents : contents.data
		return items.map(toEntry)
	}

	async mkdir(path: string) {
		await this.client.createDirectory(path, { recursive: true })
	}

	async readFile(path: string) {
		const content = (await this.client.getFileContents(path, {
			format: 'binary',
		})) as unknown
		return toArrayBuffer(content)
	}

	async readFileRange(path: string, offset: number, length: number) {
		const response = await this.client.customRequest(path, {
			method: 'GET',
			headers: { Range: `bytes=${offset}-${offset + length - 1}` },
		})
		if (response.status !== 206) {
			throw new Error(`Range download failed with status ${response.status}`)
		}
		return toArrayBuffer(await response.arrayBuffer())
	}

	async writeFile(
		path: string,
		data: RemoteFileContent,
		_options?: WriteRemoteFileOptions,
	) {
		const success = await this.client.putFileContents(path, data, {
			overwrite: true,
		})
		if (!success) {
			throw new Error('Upload failed')
		}
	}

	async remove(path: string) {
		await this.client.deleteFile(path)
	}

	async move(from: string, to: string) {
		await this.client.moveFile(from, to)
	}
}

function toArrayBuffer(content: unknown): ArrayBuffer {
	if (content instanceof ArrayBuffer) {
		return content
	}
	if (typeof content === 'string') {
		return new TextEncoder().encode(content).buffer
	}
	if (ArrayBuffer.isView(content)) {
		const view: ArrayBufferView = content
		const copy = new ArrayBuffer(view.byteLength)
		new Uint8Array(copy).set(
			new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
		)
		return copy
	}
	throw new Error('Unsupported remote content type')
}
