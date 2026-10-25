import { createClient, WebDAVClient } from 'webdav'
import { QuarkClient } from '~/remote/quark/quark-client'
import { QUARK_API_BASE } from '~/remote/quark/constants'
import { obsidianQuarkHttp } from '~/remote/quark/http-obsidian'
import { QuarkRemoteFs } from '~/remote/quark/quark-remote-fs'
import { remoteFidKV } from '~/storage'
import { refreshQuarkTokensViaRelay } from '~/remote/quark/token-refresh'
import type { QuarkCredentials } from '~/remote/quark/quark-client'
import type { RemoteFs } from '~/remote/remote-fs.interface'
import { WebDAVRemoteFs } from '~/remote/webdav/webdav-remote-fs'
import NutstorePlugin from '../index'
import { getTraversalWebDAVDBKey } from '../utils/get-db-key'
import { getNutstoreDavEndpoint } from '../utils/nutstore-endpoints'
import { createRateLimitedWebDAVClient } from '../utils/rate-limited-client'
import { BaseService } from './service.interface'

/**
 * Creates the active remote backend.
 *
 * Historically this service only produced a WebDAV client for Nutstore; it now
 * dispatches on `settings.remoteProvider` and hands the sync engine a
 * backend-neutral `RemoteFs`.
 */
export class WebDAVService extends BaseService {
	constructor(private plugin: NutstorePlugin) {
		super()
	}

	async createRemoteFs(): Promise<RemoteFs> {
		if (this.plugin.settings.remoteProvider === 'quark') {
			return await this.createQuarkRemoteFs()
		}
		return new WebDAVRemoteFs(await this.createWebDAVClient())
	}

	async createQuarkRemoteFs(): Promise<QuarkRemoteFs> {
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
		}
		if (client.userId && client.userId !== quark.userId) {
			quark.userId = client.userId
			await this.plugin.saveData(this.plugin.settings)
		}

		const remoteFs = new QuarkRemoteFs({
			client,
			http: obsidianQuarkHttp,
			rootFid: quark.rootFid.trim() || '0',
			overwriteMode: quark.overwriteMode,
			fidStore: remoteFidKV,
			kvKey: await getTraversalWebDAVDBKey(
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

	async createWebDAVClient(): Promise<WebDAVClient> {
		const davEndpoint = getNutstoreDavEndpoint(this.plugin.settings)
		let client: WebDAVClient
		if (this.plugin.settings.loginMode === 'manual') {
			client = createClient(davEndpoint, {
				username: this.plugin.settings.account,
				password: this.plugin.settings.credential,
			})
		} else {
			const oauth = await this.plugin.getDecryptedOAuthInfo()
			client = createClient(davEndpoint, {
				username: oauth.username,
				password: oauth.access_token,
			})
		}
		return createRateLimitedWebDAVClient(client)
	}

	async checkWebDAVConnection(): Promise<{ error?: Error; success: boolean }> {
		try {
			const client = await this.createWebDAVClient()
			return { success: await client.exists('/') }
		} catch (error) {
			const normalizedError =
				error instanceof Error ? error : new Error(String(error))
			return {
				error: normalizedError,
				success: false,
			}
		}
	}

	/** Connectivity check for the active backend, used by the settings UI. */
	async checkRemoteConnection(): Promise<{
		error?: Error
		success: boolean
		detail?: string
	}> {
		try {
			if (this.plugin.settings.remoteProvider !== 'quark') {
				return await this.checkWebDAVConnection()
			}
			const remote = await this.createQuarkRemoteFs()
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
