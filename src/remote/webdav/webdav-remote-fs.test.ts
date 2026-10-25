import { describe, expect, it, vi } from 'vitest'
import type { FileStat, WebDAVClient } from 'webdav'
import { WebDAVRemoteFs } from './webdav-remote-fs'

function stat(path: string, isDir: boolean, size = 0): FileStat {
	return {
		filename: path,
		basename: path.split('/').pop() ?? path,
		lastmod: '2026-01-02T03:04:05Z',
		size,
		type: isDir ? 'directory' : 'file',
		etag: `etag-${path}`,
		mime: undefined,
	}
}

function createClient(overrides: Partial<WebDAVClient> = {}) {
	const client = {
		exists: vi.fn(async () => true),
		stat: vi.fn(async (path: string) => stat(path, false, 12)),
		getDirectoryContents: vi.fn(async (path: string) => [
			stat(`${path}/note.md`, false, 12),
			stat(`${path}/sub`, true),
		]),
		createDirectory: vi.fn(async () => undefined),
		getFileContents: vi.fn(async () => new TextEncoder().encode('body').buffer),
		putFileContents: vi.fn(async () => true),
		deleteFile: vi.fn(async () => undefined),
		moveFile: vi.fn(async () => undefined),
		customRequest: vi.fn(async () => ({
			status: 206,
			arrayBuffer: async () => new TextEncoder().encode('bod').buffer,
		})),
		...overrides,
	}
	return client as unknown as WebDAVClient & typeof client
}

describe('WebDAVRemoteFs', () => {
	it('exposes webdav entries as RemoteEntry', async () => {
		const client = createClient()
		const remote = new WebDAVRemoteFs(client)

		expect(await remote.list('/vault')).toEqual([
			{
				path: '/vault/note.md',
				basename: 'note.md',
				isDir: false,
				size: 12,
				mtime: Date.parse('2026-01-02T03:04:05Z'),
				id: 'etag-/vault/note.md',
			},
			{
				path: '/vault/sub',
				basename: 'sub',
				isDir: true,
				size: 0,
				mtime: Date.parse('2026-01-02T03:04:05Z'),
				id: 'etag-/vault/sub',
			},
		])
	})

	it('delegates existence, mkdir, write, remove and move', async () => {
		const client = createClient()
		const remote = new WebDAVRemoteFs(client)

		expect(await remote.exists('/vault')).toBe(true)
		await remote.mkdir('/vault/sub/deep')
		await remote.writeFile('/vault/a.md', 'text')
		await remote.remove('/vault/a.md')
		await remote.move('/vault/a.md', '/vault/b.md')

		expect(client.createDirectory).toHaveBeenCalledWith('/vault/sub/deep', {
			recursive: true,
		})
		expect(client.putFileContents).toHaveBeenCalledWith(
			'/vault/a.md',
			'text',
			{ overwrite: true },
		)
		expect(client.deleteFile).toHaveBeenCalledWith('/vault/a.md')
		expect(client.moveFile).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
	})

	it('reads whole files and byte ranges', async () => {
		const client = createClient()
		const remote = new WebDAVRemoteFs(client)

		const whole = await remote.readFile('/vault/a.md')
		expect(new TextDecoder().decode(whole)).toBe('body')

		const range = await remote.readFileRange?.('/vault/a.md', 0, 3)
		expect(new TextDecoder().decode(range)).toBe('bod')
		expect(client.customRequest).toHaveBeenCalledWith('/vault/a.md', {
			method: 'GET',
			headers: { Range: 'bytes=0-2' },
		})
	})

	it('throws when uploading fails or a range request is refused', async () => {
		const failing = createClient({
			putFileContents: vi.fn(async () => false),
		})
		await expect(
			new WebDAVRemoteFs(failing).writeFile('/vault/a.md', 'x'),
		).rejects.toThrow(/Upload failed/)

		const noRange = createClient({
			customRequest: vi.fn(async () => ({
				status: 200,
				arrayBuffer: async () => new ArrayBuffer(3),
			})) as unknown as WebDAVClient['customRequest'],
		})
		await expect(
			new WebDAVRemoteFs(noRange).readFileRange?.('/vault/a.md', 0, 3),
		).rejects.toThrow(/Range download failed/)
	})
})
