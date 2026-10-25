import { QuarkClient } from '~/remote/quark/quark-client'
import { QUARK_API_BASE } from '~/remote/quark/constants'
import { obsidianQuarkHttp } from '~/remote/quark/http-obsidian'
import { QuarkRemoteFs } from '~/remote/quark/quark-remote-fs'
import { refreshQuarkTokensViaRelay } from '~/remote/quark/token-refresh'
import type { QuarkCredentials } from '~/remote/quark/quark-client'
import type { RemoteFs } from '~/remote/remote-fs.interface'
import { remoteFidKV } from '~/storage'
import QuarkSyncPlugin from '../index'
import { getRemoteTraversalDBKey } from '../utils/get-db-key'
import { BaseService } from './service.interface'

/**
 * Creates the Quark Drive backend for the sync engine.
 *
 * This service used to host the Nutstore WebDAV client as well; the Nutstore
 * backend was removed, so it now only wires the Quark open-platform client into
 * a `RemoteFs`.
 */
export class RemoteBackendService extends BaseService {
	constructor(private plugin: QuarkSyncPlugin) {
		super()
	}

	async createRemoteFs(): Promise<RemoteFs> {
		const quark = this.plugin.settings.quark
		const client: QuarkClient = new QuarkClient({
			credentials: {
				appId: quark.appId.trim(),
				signKey: quark.signKey.trim(),
				accessToken: quark.accessToken.trim(),
				refreshToken: quark.refreshToken.trim(),
				userId: quark.userId.trim() || undefined,
			},
			http: obsidianQuarkHttp,
			folderFileType: quark.folderFileType.trim() || '0',
			refreshCredentials: quark.refreshEndpoint.trim()
				? () => this.refreshQuarkCredentials()
				: undefined,
		})

		// Resolve `user_id` early: it seeds the DB keys and the upload proof.
		if (!client.userId) {
			await client.userInfo()
			if (client.userId && client.userId !== quark.userId) {
				quark.userId = client.userId
				await this.plugin.saveData(this.plugin.settings)
			}
		}

		const remoteFs = new QuarkRemoteFs({
			client,
			http: obsidianQuarkHttp,
			rootFid: quark.rootFid.trim() || '0',
			overwriteMode: quark.overwriteMode,
			fidStore: remoteFidKV,
			kvKey: await getRemoteTraversalDBKey(
				client.userId ?? quark.appId,
				QUARK_API_BASE,
				this.plugin.remoteBaseDir,
			),
		})
		await remoteFs.init()
		return remoteFs
	}

	/**
	 * Refreshes Quark credentials through the configured relay and persists the
	 * rotated tokens so the next launch keeps working.
	 */
	private async refreshQuarkCredentials(): Promise<QuarkCredentials> {
		const quark = this.plugin.settings.quark
		const tokens = await refreshQuarkTokensViaRelay({
			http: obsidianQuarkHttp,
			refreshEndpoint: quark.refreshEndpoint.trim(),
			refreshToken: quark.refreshToken.trim(),
		})

		quark.accessToken = tokens.accessToken
		quark.refreshToken = tokens.refreshToken
		await this.plugin.saveData(this.plugin.settings)

		return {
			appId: quark.appId.trim(),
			signKey: quark.signKey.trim(),
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			userId: quark.userId.trim() || undefined,
		}
	}

	/** Connectivity check for the settings UI. */
	async checkRemoteConnection(): Promise<{
		error?: Error
		success: boolean
		detail?: string
	}> {
		try {
			const remote = await this.createRemoteFs()
			const entries = await remote.list('/')
			return {
				success: true,
				detail: `${entries.length} item(s) in the root folder`,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			}
		}
	}
}
