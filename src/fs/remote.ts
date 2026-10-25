import { Vault } from 'obsidian'
import type { RemoteFs } from '~/remote/remote-fs.interface'
import type { PluginSettings } from '~/settings'
import {
	ConfigDirSyncMode,
	computeEffectiveFilterRulesFromParts,
} from '~/utils/config-dir-rules'
import { getRemoteTraversalDBKey } from '~/utils/get-db-key'
import { GlobFilterRule } from '~/utils/glob-match'
import {
	ResumableRemoteTraversal,
	type RemoteTraversalProgress,
} from '~/utils/traverse-remote'
import { QUARK_API_BASE } from '~/remote/quark/constants'
import AbstractFileSystem from './fs.interface'
import { buildRemoteWalkResults } from './utils/build-remote-walk-results'
import { buildDirPruningPredicate } from './utils/dir-pruning'

/**
 * File system view over a generic `RemoteFs` backend (Quark open platform or a
 * WebDAV gateway such as Alist/OpenList).
 *
 * Unlike `NutstoreFileSystem` there is no change feed to consume, so each sync
 * performs a full BFS walk through `ResumableRemoteTraversal`.
 */
export class RemoteFileSystem implements AbstractFileSystem {
	constructor(
		private options: {
			remote: RemoteFs
			vault: Vault
			settings: PluginSettings
			remoteAccountId: string
			/** Backend identity for cache/DB keys (endpoint URL). */
			backendEndpoint?: string
			remoteBaseDir: string
			filterRules?: {
				rules: GlobFilterRule[]
				configDir?: string
				configDirSyncMode?: ConfigDirSyncMode
			}
			onTraversalProgress?: (progress: RemoteTraversalProgress) => void
			throwIfCancelled?: () => void
			/** Skip retries for unit tests. */
			maxRetries?: number
			/**
			 * Traversal tuning: directory listing concurrency and whether the
			 * persisted remote snapshot may be trusted instead of re-walking.
			 */
			traversal?: {
				concurrency?: number
				fastMode?: boolean
				fullScanIntervalMs?: number
			}
		},
	) {}

	async walk() {
		const settings = this.options.filterRules
			? undefined
			: this.options.settings
		const filterRules =
			this.options.filterRules ??
			(settings
				? computeEffectiveFilterRulesFromParts(
						this.options.vault.configDir,
						settings.configDirSyncMode ?? 'none',
						settings.filterRules,
					)
				: undefined)

		const shouldVisitDir = buildDirPruningPredicate(
			this.options.remoteBaseDir,
			filterRules?.rules ?? [],
		)

		const traversal = new ResumableRemoteTraversal({
			remote: this.options.remote,
			remoteBaseDir: this.options.remoteBaseDir,
			kvKey: await getRemoteTraversalDBKey(
				this.options.remoteAccountId,
				this.options.backendEndpoint ?? QUARK_API_BASE,
				this.options.remoteBaseDir,
			),
			saveInterval: 1,
			onProgress: this.options.onTraversalProgress,
			throwIfCancelled: this.options.throwIfCancelled,
			maxRetries: this.options.maxRetries,
			concurrency: this.options.traversal?.concurrency,
			fastMode: this.options.traversal?.fastMode,
			fullScanIntervalMs: this.options.traversal?.fullScanIntervalMs,
			shouldVisitDir,
		})
		const traversedStats = await traversal.traverse()

		return buildRemoteWalkResults({
			traversedStats,
			remoteBaseDir: this.options.remoteBaseDir,
			configDir: this.options.vault.configDir,
			filterRules: { rules: filterRules?.rules ?? [] },
		})
	}
}
