import { beforeAll, describe, expect, it, vi } from 'vitest'
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

import { remoteTraversalKV } from '~/storage'
import type { RemoteTraversalCache } from '~/storage/kv'
import { apiLimiter } from './api-limiter'
import { ResumableRemoteTraversal } from './traverse-remote'

// `sleep()` relies on `window.setTimeout` (Obsidian runs in a browser context).
beforeAll(() => {
	if (typeof globalThis.window === 'undefined') {
		vi.stubGlobal('window', globalThis)
	}
})

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

	it('walks the same tree with parallel workers', async () => {
		const tree: Record<string, RemoteEntry[]> = {
			'/Vault': [
				entry('/Vault/a.md', false),
				entry('/Vault/d1', true),
				entry('/Vault/d2', true),
				entry('/Vault/d3', true),
			],
			'/Vault/d1': [entry('/Vault/d1/x.md', false)],
			'/Vault/d2': [entry('/Vault/d2/y.md', false)],
			'/Vault/d3': [entry('/Vault/d3/z', true)],
			'/Vault/d3/z': [entry('/Vault/d3/z/w.md', false)],
		}
		const traversal = new ResumableRemoteTraversal({
			remote: createRemote(tree),
			remoteBaseDir: '/Vault',
			kvKey: 'key-parallel',
			concurrency: 4,
			maxRetries: 1,
		})

		const stats = await traversal.traverse()
		expect(stats.map((stat) => stat.path).sort()).toEqual([
			'/Vault/a.md',
			'/Vault/d1',
			'/Vault/d1/x.md',
			'/Vault/d2',
			'/Vault/d2/y.md',
			'/Vault/d3',
			'/Vault/d3/z',
			'/Vault/d3/z/w.md',
		])
	})

	it('fast mode reuses a fresh snapshot without walking', async () => {
		const list = vi.fn(async () => [entry('/Vault/a.md', false)])
		const remote: RemoteFs = { ...createRemote({}), list }
		const first = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: 'key-fast',
			maxRetries: 1,
		})
		expect(await first.traverse()).toHaveLength(1)
		expect(list).toHaveBeenCalledTimes(1)

		list.mockClear()
		const second = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: 'key-fast',
			fastMode: true,
			maxRetries: 1,
		})
		const reused = await second.traverse()
		expect(reused.map((stat) => stat.path)).toEqual(['/Vault/a.md'])
		expect(list).not.toHaveBeenCalled()
	})

	it('fast mode falls back to a full walk when the snapshot is stale', async () => {
		kvStore.set('key-stale', {
			rootCursor: '',
			queue: [],
			nodes: { '/Vault': [entry('/Vault/old.md', false)] },
			fullScanAt: Date.now() - 10 * 60 * 60 * 1000,
		})

		const list = vi.fn(async () => [entry('/Vault/a.md', false)])
		const traversal = new ResumableRemoteTraversal({
			remote: { ...createRemote({}), list },
			remoteBaseDir: '/Vault',
			kvKey: 'key-stale',
			fastMode: true,
			fullScanIntervalMs: 60 * 60 * 1000,
			maxRetries: 1,
		})
		const stats = await traversal.traverse()
		expect(list).toHaveBeenCalledTimes(1)
		expect(stats.map((stat) => stat.path)).toEqual(['/Vault/a.md'])
	})

	it('does not trust an unfinished snapshot in fast mode', async () => {
		kvStore.set('key-partial', {
			rootCursor: '',
			queue: ['/Vault/d1'],
			nodes: { '/Vault': [entry('/Vault/a.md', false)] },
			fullScanAt: Date.now(),
		})

		const list = vi.fn(async () => [entry('/Vault/a.md', false)])
		const traversal = new ResumableRemoteTraversal({
			remote: { ...createRemote({}), list },
			remoteBaseDir: '/Vault',
			kvKey: 'key-partial',
			fastMode: true,
			maxRetries: 1,
		})
		await traversal.traverse()
		expect(list).toHaveBeenCalledTimes(1)
	})
})

describe('ResumableRemoteTraversal rate limiting', () => {
	/**
	 * Regression: the traversal used to wrap `remote.list` in `apiLimiter.wrap`
	 * while the backend client scheduled the same call through the same
	 * single-slot limiter. The outer job held the slot, the inner one waited for
	 * it, and the first listing never reached the network — the sync hung at
	 * "scanning remote directory" with no request and no error.
	 */
	it('completes when the backend schedules through apiLimiter itself', async () => {
		const tree: Record<string, RemoteEntry[]> = {
			'/Vault': [entry('/Vault/a.md', false), entry('/Vault/sub', true)],
			'/Vault/sub': [entry('/Vault/sub/b.md', false)],
		}
		const remote: RemoteFs = {
			...createRemote(tree),
			list: (path) =>
				apiLimiter.schedule(async () => tree[normalizeKey(path)] ?? []),
		}

		const traversal = new ResumableRemoteTraversal({
			remote,
			remoteBaseDir: '/Vault',
			kvKey: `key-limiter-${Date.now()}`,
			maxRetries: 1,
		})

		const stats = await traversal.traverse()
		expect(stats.map((stat) => stat.path).sort()).toEqual([
			'/Vault/a.md',
			'/Vault/sub',
			'/Vault/sub/b.md',
		])
	}, 15_000)
})

describe('RemoteTraversal snapshot completeness', () => {
	const readCache = async (key: string) =>
		(await remoteTraversalKV.get(key)) as RemoteTraversalCache | null

	it('marks a finished parallel walk as complete', async () => {
		const tree: Record<string, RemoteEntry[]> = {
			'/Vault': [entry('/Vault/a', true), entry('/Vault/b', true)],
			'/Vault/a': [entry('/Vault/a/x.md', false)],
			'/Vault/b': [],
		}
		const key = `key-complete-${Date.now()}`
		await new ResumableRemoteTraversal({
			remote: createRemote(tree),
			remoteBaseDir: '/Vault',
			kvKey: key,
			concurrency: 4,
			maxRetries: 1,
		}).traverse()

		expect((await readCache(key))?.fullScanAt).toBeTypeOf('number')
	})

	it('does not mark an interrupted walk as complete', async () => {
		const remote: RemoteFs = {
			...createRemote({ '/Vault': [entry('/Vault/sub', true)] }),
			list: async (path) => {
				if (normalizeKey(path) === '/Vault/sub') {
					throw new Error('gateway exploded')
				}
				return [entry('/Vault/sub', true)]
			},
		}
		const key = `key-interrupted-${Date.now()}`

		await expect(
			new ResumableRemoteTraversal({
				remote,
				remoteBaseDir: '/Vault',
				kvKey: key,
				concurrency: 4,
				maxRetries: 1,
			}).traverse(),
		).rejects.toThrow(/gateway exploded/)

		// Fast mode must not trust a snapshot taken mid-walk, even though the
		// queue happened to be empty at that instant.
		expect((await readCache(key))?.fullScanAt).toBeUndefined()
	})
})
