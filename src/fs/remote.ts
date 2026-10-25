import { Vault } from 'obsidian'
import type { RemoteFs } from '~/remote/remote-fs.interface'
import type { NutstoreSettings } from '~/settings'
import {
	ConfigDirSyncMode,
	computeEffectiveFilterRulesFromParts,
} from '~/utils/config-dir-rules'
import { getTraversalWebDAVDBKey } from '~/utils/get-db-key'
import { GlobFilterRule } from '~/utils/glob-match'
import { getRemoteBackendEndpoint } from '~/utils/remote-endpoints'
import { ResumableRemoteTraversal } from '~/utils/traverse-remote'
import type { WebDAVTraversalProgress } from '~/utils/traverse-webdav'
import AbstractFileSystem from './fs.interface'
import { buildRemoteWalkResults } from './utils/build-remote-walk-results'

/**
 * File system view over a generic `RemoteFs` backend (currently Quark Drive).
 *
 * Unlike `NutstoreFileSystem` there is no change feed to consume, so each sync
 * performs a full BFS walk through `ResumableRemoteTraversal`.
 */
export class RemoteFileSystem implements AbstractFileSystem {
	constructor(
		private options: {
			remote: RemoteFs
			vault: Vault
			settings: NutstoreSettings
			remoteAccountId: string
			remoteBaseDir: string
			filterRules?: {
				rules: GlobFilterRule[]
				configDir?: string
				configDirSyncMode?: ConfigDirSyncMode
			}
			onTraversalProgress?: (progress: WebDAVTraversalProgress) => void
			throwIfCancelled?: () => void
			/** Skip retries for unit tests. */
			maxRetries?: number
		},
	) {}

	async walk() {
		const traversal = new ResumableRemoteTraversal({
			remote: this.options.remote,
			remoteBaseDir: this.options.remoteBaseDir,
			kvKey: await getTraversalWebDAVDBKey(
				this.options.remoteAccountId,
				getRemoteBackendEndpoint(this.options.settings),
				this.options.remoteBaseDir,
			),
			saveInterval: 1,
			onProgress: this.options.onTraversalProgress,
			throwIfCancelled: this.options.throwIfCancelled,
			maxRetries: this.options.maxRetries,
		})
		const traversedStats = await traversal.traverse()

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

		return buildRemoteWalkResults({
			traversedStats,
			remoteBaseDir: this.options.remoteBaseDir,
			configDir: this.options.vault.configDir,
			filterRules: { rules: filterRules?.rules ?? [] },
		})
	}
}
