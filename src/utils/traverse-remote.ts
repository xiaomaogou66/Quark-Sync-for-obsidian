import { Mutex } from 'async-mutex'
import type { StatModel } from '~/model/stat.model'
import { remoteEntryToStatModel } from '~/remote/remote-fs.interface'
import type { RemoteFs } from '~/remote/remote-fs.interface'
import { remoteTraversalKV } from '~/storage'
import type { RemoteTraversalCache } from '~/storage/kv'
import logger from './logger'
import sleep from './sleep'
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
	/**
	 * How many directories to list in parallel, defaults to 1 (serial walk).
	 * A full walk of a large vault is one round trip per directory, so this is
	 * the dominant cost of a sync start. Keep it below the transport limiter's
	 * concurrency or the extra workers just queue up again.
	 */
	concurrency?: number
	/**
	 * Trust the persisted snapshot instead of re-walking the remote tree.
	 * There is no change feed for these backends, so a full walk is otherwise
	 * unavoidable; this trades freshness for startup time.
	 */
	fastMode?: boolean
	/** Age after which fast mode gives up and performs a full walk. */
	fullScanIntervalMs?: number
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
	private readonly concurrency: number
	private readonly fastMode: boolean
	private readonly fullScanIntervalMs: number

	private queue: string[] = []
	private nodes: Record<string, StatModel[]> = {}
	private processedCount = 0
	private discoveredCount = 0
	/** Serialises snapshot writes so parallel workers never interleave them. */
	private saveChain: Promise<void> = Promise.resolve()

	constructor(options: RemoteTraversalOptions) {
		this.remote = options.remote
		this.remoteBaseDir = options.remoteBaseDir
		this.kvKey = options.kvKey
		this.saveInterval = Math.max(options.saveInterval ?? 1, 1)
		this.onProgress = options.onProgress
		this.throwIfCancelled = options.throwIfCancelled
		this.maxRetries = Math.max(options.maxRetries ?? 3, 1)
		this.retryDelayMs = Math.max(options.retryDelayMs ?? 1000, 0)
		this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1))
		this.fastMode = options.fastMode ?? false
		this.fullScanIntervalMs = Math.max(
			options.fullScanIntervalMs ?? 24 * 60 * 60 * 1000,
			0,
		)
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

			const trusted = await this.loadTrustedSnapshot()
			if (trusted) {
				this.queue = []
				this.nodes = trusted.nodes
				this.processedCount = Object.keys(trusted.nodes).length
				this.discoveredCount = this.getAllFromCache().length
				logger.info('[RemoteTraversal] fast sync: reusing cached snapshot', {
					remoteBaseDir: this.remoteBaseDir,
					directories: this.processedCount,
					items: this.discoveredCount,
					fullScanAt: new Date(trusted.fullScanAt ?? 0).toISOString(),
				})
				this.emitProgress('complete')
				return this.getAllFromCache()
			}

			this.queue = [stdRemotePath(this.remoteBaseDir)]
			this.nodes = {}
			this.processedCount = 0
			this.discoveredCount = 0
			this.saveChain = Promise.resolve()

			if (this.concurrency > 1) {
				await this.walkParallel()
				await this.saveState()
				this.emitProgress('complete')
				return this.getAllFromCache()
			}

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

					await this.maybeSaveState()
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

	/**
	 * Parallel BFS over the remote tree.
	 *
	 * Same result as the serial walk, but `concurrency` directories are listed at
	 * once. Workers exit only when the queue is empty *and* no sibling is still
	 * listing, otherwise a worker could finish early while another one is about
	 * to enqueue children.
	 */
	private async walkParallel(): Promise<void> {
		const visited = new Set<string>()
		let inFlight = 0
		let failure: unknown

		const worker = async () => {
			while (failure === undefined) {
				this.throwIfCancelled?.()
				const currentPath = this.queue.shift()
				if (currentPath === undefined) {
					if (inFlight === 0) {
						return
					}
					await sleep(20)
					continue
				}

				const normalizedPath = stdRemotePath(currentPath)
				if (visited.has(normalizedPath)) {
					continue
				}
				visited.add(normalizedPath)
				inFlight += 1
				try {
					this.emitProgress('scanning', currentPath)
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
					this.processedCount += 1
					this.emitProgress('scanning', currentPath)
					await this.maybeSaveState()
				} catch (error) {
					if (failure === undefined) {
						failure = error
						logger.error(`[RemoteTraversal] failed at ${currentPath}`, error)
					}
				} finally {
					inFlight -= 1
				}
			}
		}

		await Promise.all(Array.from({ length: this.concurrency }, () => worker()))

		if (failure !== undefined) {
			await this.saveState()
			throw failure instanceof Error
				? failure
				: new Error('Remote traversal failed')
		}
	}

	private async maybeSaveState(): Promise<void> {
		if (this.processedCount % this.saveInterval !== 0) {
			return
		}
		this.saveChain = this.saveChain.then(() => this.saveState())
		await this.saveChain
	}

	/**
	 * Returns the persisted snapshot when fast mode may trust it.
	 *
	 * Only a *completed* snapshot is eligible (`queue` empty) and only while it is
	 * younger than `fullScanIntervalMs`, so a remote deletion made from another
	 * device is still picked up by the periodic full walk.
	 */
	private async loadTrustedSnapshot(): Promise<RemoteTraversalCache | null> {
		if (!this.fastMode) {
			return null
		}
		const cache = await remoteTraversalKV.get(this.kvKey)
		if (!cache || (cache.queue?.length ?? 0) > 0) {
			return null
		}
		if (!isTraversalCacheCompatible(cache, this.remoteBaseDir)) {
			return null
		}
		const nodes = cache.nodes ?? {}
		if (Object.keys(nodes).length === 0) {
			return null
		}
		const fullScanAt = cache.fullScanAt ?? 0
		if (Date.now() - fullScanAt > this.fullScanIntervalMs) {
			logger.info(
				'[RemoteTraversal] fast sync skipped: snapshot older than the full-scan interval',
			)
			return null
		}
		return cache
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
			// Only a finished walk is a valid "the remote looked like this at T"
			// marker for fast mode.
			fullScanAt: this.queue.length === 0 ? Date.now() : undefined,
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
