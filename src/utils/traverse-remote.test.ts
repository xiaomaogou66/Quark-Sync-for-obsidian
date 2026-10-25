import { describe, expect, it, vi } from 'vitest'
import type { RemoteEntry, RemoteFs } from '~/remote/remote-fs.interface'

const kvStore = new Map<string, unknown>()

vi.mock('~/storage', () => ({
	remoteTraversalKV: {
		get: async (key: string) => kvStore.get(key) ?? null,
		set: async (key: string, value: unknown) => {
			kvStore.set(key, value)
			return value
		},
		unset: async (key: string) => {
			kvStore.delete(key)
		},
	},
}))

import { ResumableRemoteTraversal } from './traverse-remote'

const normalizeKey = (path: string) =>
	path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

function createRemote(tree: Record<string, RemoteEntry[]>): RemoteFs {
	return {
		kind: 'quark',
		exists: async () => true,
		stat: async () => {
			throw new Error('not used')
		},
		list: async (path) => tree[normalizeKey(path)] ?? [],
		mkdir: async () => {},
		readFile: async () => new ArrayBuffer(0),
		writeFile: async () => {},
		remove: async () => {},
	}
}

const entry = (path: string, isDir: boolean): RemoteEntry => ({
	path,
	basename: path.split('/').pop() ?? path,
	isDir,
	size: isDir ? 0 : 1,
	mtime: 1,
})

describe('ResumableRemoteTraversal', () => {
	it('walks nested directories breadth first', async () => {
		const remote = createRemote({
			'/Vault': [entry('/Vault/a.md', false), entry('/Vault/sub', true)],
			'/Vault/sub': [entry('/Vault/sub/b.md', false)],
		})

		const traversal = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: 'key-1',
			maxRetries: 1,
		})

		const stats = await traversal.traverse()
		expect(stats.map((stat) => stat.path).sort()).toEqual([
			'/Vault/a.md',
			'/Vault/sub',
			'/Vault/sub/b.md',
		])
	})

	it('emits progress events', async () => {
		const remote = createRemote({ '/Vault': [entry('/Vault/a.md', false)] })
		const onProgress = vi.fn()

		const traversal = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: 'key-2',
			onProgress,
			maxRetries: 1,
		})
		await traversal.traverse()

		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({ phase: 'complete', discoveredItems: 1 }),
		)
	})

	it('retries transient listing failures', async () => {
		let attempts = 0
		const remote: RemoteFs = {
			...createRemote({}),
			list: async (path) => {
				if (normalizeKey(path) === '/Vault' && attempts++ === 0) {
					throw new Error('boom')
				}
				return [entry('/Vault/a.md', false)]
			},
		}

		const traversal = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: 'key-3',
			maxRetries: 2,
			retryDelayMs: 0,
		})
		const stats = await traversal.traverse()
		expect(stats).toHaveLength(1)
		expect(attempts).toBe(2)
	})

	it('does not resurrect remote files that disappeared', async () => {
		const remote = createRemote({
			'/Vault': [entry('/Vault/a.md', false)],
		})
		const traversal = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: 'key-4',
			maxRetries: 1,
		})
		expect(await traversal.traverse()).toHaveLength(1)

		const emptied = createRemote({ '/Vault': [] })
		const second = new ResumableRemoteTraversal({
			remote: emptied,
			remoteBaseDir: '/Vault',
			kvKey: 'key-4',
			maxRetries: 1,
		})
		expect(await second.traverse()).toEqual([])
	})

	it('aborts when cancelled', async () => {
		const traversal = new ResumableRemoteTraversal({
			remote: createRemote({ '/Vault': [] }),
			remoteBaseDir: '/Vault',
			kvKey: 'key-5',
			throwIfCancelled: () => {
				throw new Error('cancelled')
			},
			maxRetries: 1,
		})
		await expect(traversal.traverse()).rejects.toThrow('cancelled')
	})
})
