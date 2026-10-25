import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuarkFidStore } from './quark-remote-fs'

function createMemoryFidStore(): QuarkFidStore {
	const store = new Map<string, Record<string, string>>()
	return {
		get: async (key) => store.get(key) ?? null,
		set: async (key, value) => {
			store.set(key, value)
			return value
		},
		unset: async (key) => {
			store.delete(key)
		},
	}
}

import { createFakeQuarkServer } from './fake-quark-server'
import { QuarkClient } from './quark-client'
import { QuarkRemoteFs } from './quark-remote-fs'

const CREDENTIALS = {
	appId: 'app',
	signKey: 'sign',
	accessToken: 'token',
	userId: 'user-1',
}

function setup(options: { overwriteMode?: 'reuse' | 'delete-first' } = {}) {
	const server = createFakeQuarkServer()
	const client = new QuarkClient({ credentials: { ...CREDENTIALS }, http: server.http })
	const remote = new QuarkRemoteFs({
		client,
		http: server.http,
		rootFid: '0',
		kvKey: `kv-${Math.random()}`,
		fidStore: createMemoryFidStore(),
		overwriteMode: options.overwriteMode,
	})
	return { server, remote }
}

describe('QuarkRemoteFs', () => {
	beforeEach(() => {
		vi.useRealTimers()
	})

	it('creates nested folders one level at a time and caches fids', async () => {
		const { server, remote } = setup()
		await remote.mkdir('/A/B/C')

		const names = server.listDir('0').map((node) => node.name)
		expect(names).toEqual(['A'])

		const b = server.listDir(server.fidOf('/A')).map((node) => node.name)
		expect(b).toEqual(['B'])

		// Second call must not issue more mkdir requests.
		const before = server.countRequests('/open/v1/dir')
		await remote.mkdir('/A/B/C')
		expect(server.countRequests('/open/v1/dir')).toBe(before)
	})

	it('lists entries with absolute paths and folder flags', async () => {
		const { server, remote } = setup()
		server.addDir('dir-1', '0', 'Notes')
		server.addFile('file-1', '0', 'root.md', 'root')

		const entries = await remote.list('/')
		expect(entries.map((entry) => [entry.path, entry.isDir])).toEqual([
			['/Notes', true],
			['/root.md', false],
		])

		const nested = await remote.list('/Notes')
		expect(nested).toEqual([])
	})

	it('writes a file, preserving mtime and content', async () => {
		const { server, remote } = setup()
		await remote.writeFile('/Notes/note.md', '# hello', { mtime: 1690000000000 })

		const nodes = server.listDir(server.fidOf('/Notes'))
		expect(nodes).toHaveLength(1)
		expect(nodes[0].name).toBe('note.md')
		expect(nodes[0].mtime).toBe(1690000000000)
		expect(server.contentOf('/Notes/note.md')).toBe('# hello')

		const read = await remote.readFile('/Notes/note.md')
		expect(new TextDecoder().decode(read)).toBe('# hello')

		const range = await remote.readFileRange?.('/Notes/note.md', 2, 3)
		expect(new TextDecoder().decode(range)).toBe('hel')
	})

	it('uses a rapid upload when the content is unchanged', async () => {
		const { server, remote } = setup()
		await remote.writeFile('/note.md', 'stable content')
		const putCount = server.countRequests('oss.test')

		await remote.writeFile('/note.md', 'stable content')
		expect(server.countRequests('oss.test')).toBe(putCount)
		expect(server.listDir('0')).toHaveLength(1)
	})

	it('reports existence and stats, and fails for missing paths', async () => {
		const { server, remote } = setup()
		server.addFile('file-1', '0', 'a.md', 'body')

		expect(await remote.exists('/a.md')).toBe(true)
		expect(await remote.exists('/missing.md')).toBe(false)

		const stat = await remote.stat('/a.md')
		expect(stat).toMatchObject({ path: '/a.md', isDir: false, size: 4 })

		await expect(remote.stat('/missing.md')).rejects.toThrow(/not found/)
	})

	it('removes folders recursively and drops cached fids', async () => {
		const { server, remote } = setup()
		server.addDir('dir-1', '0', 'Notes')
		server.addFile('file-1', 'dir-1', 'a.md', 'body')

		expect(await remote.exists('/Notes/a.md')).toBe(true)
		await remote.remove('/Notes')

		expect(server.listDir('0')).toEqual([])
		expect(await remote.exists('/Notes')).toBe(false)
	})

	it('moves and renames an entry', async () => {
		const { server, remote } = setup()
		server.addDir('dir-1', '0', 'Notes')
		server.addDir('dir-2', '0', 'Archive')
		server.addFile('file-1', 'dir-1', 'a.md', 'body')

		await remote.move('/Notes/a.md', '/Archive/b.md')

		expect(server.listDir('dir-1')).toEqual([])
		expect(server.listDir('dir-2').map((node) => node.name)).toEqual(['b.md'])
		expect(server.contentOf('/Archive/b.md')).toBe('body')
	})

	it('deletes the previous entry first in delete-first mode', async () => {
		const { server, remote } = setup({ overwriteMode: 'delete-first' })
		await remote.writeFile('/note.md', 'first')
		await remote.writeFile('/note.md', 'second', { mtime: 1690000001000 })

		const nodes = server.listDir('0')
		expect(nodes).toHaveLength(1)
		expect(server.contentOf('/note.md')).toBe('second')
		expect(nodes[0].mtime).toBe(1690000001000)
	})

	it('refuses to overwrite a folder with a file', async () => {
		const { server, remote } = setup()
		server.addDir('dir-1', '0', 'Notes')
		await expect(remote.writeFile('/Notes', 'x')).rejects.toThrow(/folder/)
	})
})

describe('fake server sanity', () => {
	it('exposes sha1 content hashes through the list endpoint', async () => {
		const { server, remote } = setup()
		server.addFile('f', '0', 'a.md', 'body')

		const entries = await remote.list('/')
		expect(entries[0].hash).toBe(await server.contentHashOf('f'))
	})
})
