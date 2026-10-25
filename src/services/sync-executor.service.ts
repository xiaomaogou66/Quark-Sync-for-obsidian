import { NutstoreSync, SyncStartMode } from '~/sync'
import { Notice } from 'obsidian'
import { IN_DEV } from '~/consts'
import { emitStopGc, emitSyncError } from '~/events'
import i18n from '~/i18n'
import type { SyncStartResult } from '~/sync'
import { getConfigDirPruningRule } from '~/utils/config-dir-rules'
import { getSyncPolicyLabel, getSyncTriggerLabel } from '~/sync/log'
import { type SyncPolicy } from '~/settings'
import logger from '~/utils/logger'
import waitUntil from '~/utils/wait-until'
import { BaseService } from './service.interface'
import type QuarkSyncPlugin from '..'

export interface SyncOptions {
	mode: SyncStartMode
	/** A manual-sync override. This is deliberately not persisted. */
	syncPolicy?: SyncPolicy
}

/** Upper bound for waiting on a leaked `isSyncing` flag before resetting it. */
const SYNC_STATE_TIMEOUT_MS = 10_000

export default class SyncExecutorService extends BaseService {
	private inFlight = false
	private pendingAutoSync = false

	constructor(private plugin: QuarkSyncPlugin) {
		super()
	}

	isRunning() {
		return this.inFlight || this.plugin.isSyncing
	}

	async executeSync(options: SyncOptions) {
		if (this.isRunning()) {
			if (options.mode === SyncStartMode.AUTO_SYNC) {
				this.pendingAutoSync = true
				return false
			}
			new Notice(i18n.t('sync.blockedBySync'))
			return false
		}

		this.inFlight = true
		this.pendingAutoSync = false
		const syncPolicy =
			options.syncPolicy ?? this.plugin.localSettings.syncPolicy

		let result: SyncStartResult | undefined
		try {
			if (this.plugin.gcService.isRunningNow()) {
				if (IN_DEV && options.mode === SyncStartMode.MANUAL_SYNC) {
					new Notice(i18n.t('sync.stoppingGcForSync'))
				}
				emitStopGc()
				const idle = await this.plugin.gcService.waitUntilIdle()
				if (!idle) {
					logger.warn(
						'[Sync] cache GC did not stop in time, starting the sync anyway',
					)
				}
			}

			if (!this.plugin.isAccountConfigured()) {
				new Notice(i18n.t('sync.error.accountNotConfigured'))
				return false
			}

			if (
				options.mode === SyncStartMode.MANUAL_SYNC &&
				(this.plugin.settings.configDirSyncMode ?? 'none') === 'all'
			) {
				const configDir = this.plugin.app.vault.configDir
				const pruningRule = getConfigDirPruningRule(
					configDir,
					this.plugin.settings.filterRules.rules,
				)
				if (pruningRule) {
					new Notice(
						i18n.t('settings.configDirSync.syncNotice', {
							configDir,
							rule: pruningRule.expr,
						}),
					)
				}
			}

			logger.info('Sync starting with settings:', {
				triggerMode: getSyncTriggerLabel(options.mode),
				syncPolicy: getSyncPolicyLabel(syncPolicy),
				remoteBaseDir: this.plugin.remoteBaseDir,
				syncMode: this.plugin.settings.syncMode,
				realtimeSync: this.plugin.settings.realtimeSync,
				autoSyncIntervalSeconds: this.plugin.settings.autoSyncIntervalSeconds,
				startupSyncDelaySeconds: this.plugin.settings.startupSyncDelaySeconds,
				confirmBeforeSync: this.plugin.settings.confirmBeforeSync,
				confirmBeforeDeleteInAutoSync:
					this.plugin.settings.confirmBeforeDeleteInAutoSync,
				configDirSyncMode: this.plugin.settings.configDirSyncMode ?? 'none',
			})

			await waitUntil(
				() => this.plugin.isSyncing === false,
				500,
				SYNC_STATE_TIMEOUT_MS,
			)
			if (this.plugin.isSyncing) {
				// The previous run left the UI flag set (a hung promise, a closed
				// modal that never resolved, …). Force it clear instead of blocking
				// every later attempt with "sync already running" until reload.
				logger.warn(
					'[Sync] stale isSyncing flag detected, resetting sync state',
				)
				this.plugin.toggleSyncUI(false)
			}

			const remote = await this.plugin.remoteBackendService.createRemoteFs()
			const sync = new NutstoreSync(this.plugin, {
				vault: this.plugin.app.vault,
				remoteAccountId: await this.plugin.getRemoteAccountId(),
				remoteBaseDir: this.plugin.remoteBaseDir,
				remote,
				backendEndpoint:
					await this.plugin.remoteBackendService.getBackendEndpoint(),
			})

			result = await sync.start({
				mode: options.mode,
				syncPolicy,
			})

			return result.ended
		} catch (error) {
			emitSyncError(error as Error)
			logger.error('Sync error:', error)
			return false
		} finally {
			this.inFlight = false
			if (result?.ended) {
				if (result.shouldReloadSettings) {
					this.plugin.settingsService.scheduleReloadSettingsFromDisk()
				}
				await this.plugin.gcService.runBlobGc().catch((error) => {
					logger.error('Error running auto GC after sync end:', error)
				})
			}
			if (this.pendingAutoSync && !this.plugin.isSyncing) {
				this.pendingAutoSync = false
				void this.executeSync({ mode: SyncStartMode.AUTO_SYNC })
			}
		}
	}
}
