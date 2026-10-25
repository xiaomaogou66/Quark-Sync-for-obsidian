import { Mutex } from 'async-mutex'
import type { StatModel } from '~/model/stat.model'
import { remoteEntryToStatModel } from '~/remote/remote-fs.interface'
import type { RemoteFs } from '~/remote/remote-fs.interface'
import { remoteTraversalKV } from '~/storage'
import logger from './logger'
import { stdRemotePath } from './std-remote-path'
import { isTraversalCacheCompatible } from './traversal-cache-compat'
import type { MaybePromise } from './types'

/**
 * Backend-neutral BFS traversal over a `RemoteFs`.
 *
 * Differences from `ResumableWebDAVTraversal`:
 * - no Nutstore `delta` cursor: backends such as Quark expose no change feed,
 *   so every sync performs a full directory walk.
 * - therefore the KV cache is a *diagnostic snapshot* and a cross-device seed
 *   for the sync-record, never a way to skip the walk. Since a stale subtree
 *   must not be able to resurrect deleted remote files, `nodes` is rebuilt from
 *   scratch on every traversal.
 *
 * The persisted shape is identical to the WebDAV cache (`RemoteTraversalCache`)
 * so the existing remote-cache upload/restore code keeps working unchanged.
 */

/**
 * Directory listing for the traversal.
 *
 * Rate limiting deliberately lives in the transport layer (the WebDAV client
 * proxy built by `createRateLimitedWebDAVClient`, see `rate-limited-client.ts`)
 * and *only* there. Wrapping this call in `apiLimiter.wrap` as well would nest
 * two `apiLimiter` jobs: the outer one holds the single concurrency slot
 * (`maxConcurrent: 1`) while the inner `schedule()` waits for it, so the very
 * first listing never reaches the network and the sync deadlocks forever with
 * no request, no error and no timeout.
 */
const getContents = (remote: RemoteFs, path: string) => remote.list(path)

const traversalLocks = new Map<string, Mutex>()

function getTraversalLock(kvKey: string): Mutex {
	if (!traversalLocks.has(kvKey)) {
		traversalLocks.set(kvKey, new Mutex())
	}
	return traversalLocks.get(kvKey)!
}

export interface RemoteTraversalProgress {
	phase: 'scanning' | 'incremental' | 'retrying' | 'complete'
	currentPath?: string
	processedDirectories: number
	queuedDirectories: number
	discoveredItems: number
	processedChanges: number
}

export interface RemoteTraversalOptions {
	remote: RemoteFs
	remoteBaseDir: string
	kvKey: string
	saveInterval?: number
	onProgress?: (progress: RemoteTraversalProgress) => void
	throwIfCancelled?: () => void
	/** Retry budget for transient backend errors, defaults to 3. */
	maxRetries?: number
	/** Base backoff between retries, defaults to 1000ms. */
	retryDelayMs?: number
}

export class ResumableRemoteTraversal {
	private readonly remote: RemoteFs
	private readonly remoteBaseDir: string
	private readonly kvKey: string
	private readonly saveInterval: number
	private readonly onProgress?: (progress: RemoteTraversalProgress) => void
	private readonly throwIfCancelled?: () => void
	private readonly maxRetries: number
	private readonly retryDelayMs: number

	private queue: string[] = []
	private nodes: Record<string, StatModel[]> = {}
	private processedCount = 0
	private discoveredCount = 0

	constructor(options: RemoteTraversalOptions) {
		this.remote = options.remote
		this.remoteBaseDir = options.remoteBaseDir
		this.kvKey = options.kvKey
		this.saveInterval = Math.max(options.saveInterval ?? 1, 1)
		this.onProgress = options.onProgress
		this.throwIfCancelled = options.throwIfCancelled
		this.maxRetries = Math.max(options.maxRetries ?? 3, 1)
		this.retryDelayMs = Math.max(options.retryDelayMs ?? 1000, 0)
	}

	get lock() {
		return getTraversalLock(this.kvKey)
	}

	private emitProgress(
		phase: RemoteTraversalProgress['phase'],
		currentPath?: string,
	) {
		this.onProgress?.({
			phase,
			currentPath,
			processedDirectories: this.processedCount,
			queuedDirectories: this.queue.length,
			discoveredItems: this.discoveredCount,
			processedChanges: 0,
		})
	}

	private async executeWithRetry<T>(
		func: () => MaybePromise<T>,
		currentPath?: string,
	): Promise<T> {
		for (let attempt = 0; ; attempt += 1) {
			this.throwIfCancelled?.()
			try {
				return await func()
			} catch (error) {
				if (attempt >= this.maxRetries - 1) {
					throw error
				}
				logger.warn(
					`[RemoteTraversal] listing failed, retrying ${currentPath ?? ''} (attempt ${attempt + 1}/${this.maxRetries})`,
					error,
				)
				this.emitProgress('retrying', currentPath)
				if (this.retryDelayMs > 0) {
					await new Promise<void>((resolve) =>
						window.setTimeout(resolve, this.retryDelayMs * (attempt + 1)),
					)
				}
			}
		}
	}

	async traverse(): Promise<StatModel[]> {
		return await this.lock.runExclusive(async () => {
			this.throwIfCancelled?.()
			await this.dropIncompatibleCache()

			this.queue = [stdRemotePath(this.remoteBaseDir)]
			this.nodes = {}
			this.processedCount = 0
			this.discoveredCount = 0

			const visited = new Set<string>()

			while (this.queue.length > 0) {
				this.throwIfCancelled?.()
				const currentPath = this.queue[0]
				const normalizedPath = stdRemotePath(currentPath)
				if (visited.has(normalizedPath)) {
					this.queue.shift()
					continue
				}
				visited.add(normalizedPath)
				this.emitProgress('scanning', currentPath)

				try {
					const resultItems = await this.executeWithRetry(async () => {
						const entries = await getContents(this.remote, currentPath)
						return entries.map(remoteEntryToStatModel)
					}, currentPath)

					this.discoveredCount += resultItems.length
					this.nodes[normalizedPath] = resultItems

					for (const item of resultItems) {
						if (item.isDir) {
							this.queue.push(item.path)
						}
					}

					this.queue.shift()
					this.processedCount += 1
					this.emitProgress('scanning', currentPath)

					if (this.processedCount % this.saveInterval === 0) {
						await this.saveState()
					}
				} catch (error) {
					logger.error(`[RemoteTraversal] failed at ${currentPath}`, error)
					await this.saveState()
					throw error
				}
			}

			await this.saveState()
			this.emitProgress('complete')

			return this.getAllFromCache()
		})
	}

	private getAllFromCache(): StatModel[] {
		const results: StatModel[] = []
		for (const items of Object.values(this.nodes)) {
			results.push(...items)
		}
		return results
	}

	private async dropIncompatibleCache() {
		const cache = await remoteTraversalKV.get(this.kvKey)
		if (!cache) {
			return
		}
		if (!isTraversalCacheCompatible(cache, this.remoteBaseDir)) {
			logger.warn(
				'[RemoteTraversal] discarding incompatible traversal cache for current remote directory',
			)
			await remoteTraversalKV.unset(this.kvKey)
		}
	}

	private async saveState() {
		await remoteTraversalKV.set(this.kvKey, {
			rootCursor: '',
			queue: this.queue,
			nodes: this.nodes,
		})
	}

	async clearCache() {
		await remoteTraversalKV.unset(this.kvKey)
		this.queue = []
		this.nodes = {}
		this.processedCount = 0
		this.discoveredCount = 0
	}
}
