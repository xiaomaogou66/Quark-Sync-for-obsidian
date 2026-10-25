import { Vault } from 'obsidian'
import type { NutstoreSettings } from '~/settings'
import {
	ConfigDirSyncMode,
	computeEffectiveFilterRulesFromParts,
} from '~/utils/config-dir-rules'
import { getTraversalWebDAVDBKey } from '~/utils/get-db-key'
import { GlobFilterRule } from '~/utils/glob-match'
import { getNutstoreDavEndpoint } from '~/utils/nutstore-endpoints'
import {
	ResumableWebDAVTraversal,
	type WebDAVTraversalProgress,
} from '~/utils/traverse-webdav'
import AbstractFileSystem from './fs.interface'
import { buildRemoteWalkResults } from './utils/build-remote-walk-results'

export class NutstoreFileSystem implements AbstractFileSystem {
	constructor(
		private options: {
			vault: Vault
			settings: NutstoreSettings
			token: string
			remoteAccountId: string
			remoteBaseDir: string
			filterRules?: {
				rules: GlobFilterRule[]
				configDir?: string
				configDirSyncMode?: ConfigDirSyncMode
			}
			onTraversalProgress?: (progress: WebDAVTraversalProgress) => void
			throwIfCancelled?: () => void
		},
	) {}

	async walk() {
		const traversal = new ResumableWebDAVTraversal({
			settings: this.options.settings,
			token: this.options.token,
			remoteBaseDir: this.options.remoteBaseDir,
			kvKey: await getTraversalWebDAVDBKey(
				this.options.remoteAccountId,
				getNutstoreDavEndpoint(this.options.settings),
				this.options.remoteBaseDir,
			),
			saveInterval: 1,
			onProgress: this.options.onTraversalProgress,
			throwIfCancelled: this.options.throwIfCancelled,
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
