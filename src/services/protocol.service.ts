import { Notice } from 'obsidian'
import { getProviderById } from '~/ai/catalog/config'
import type { ChatModalMountTarget } from '~/ai/chat/ui/modal-mount'
import ProviderEditorModal from '~/components/ProviderEditorModal'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import type QuarkSyncPlugin from '..'
import { BaseService } from './service.interface'

/**
 * Handles `obsidian://quark-sync/…` deep links.
 *
 * Only the AI provider editor is routed here; the Nutstore SSO callback that
 * used to live in this service was removed together with the Nutstore backend.
 */
export default class ProtocolService extends BaseService {
	constructor(private plugin: QuarkSyncPlugin) {
		super()
	}

	override onload() {
		this.plugin.registerObsidianProtocolHandler(
			'quark-sync/modal/provider-edit',
			async (data) => {
				const providerId =
					typeof data?.providerId === 'string' ? data.providerId.trim() : ''
				if (!providerId) {
					return
				}
				await this.openProviderEditor(providerId)
			},
		)
	}

	async openProviderEditor(
		providerId: string,
		mountTarget?: ChatModalMountTarget,
	) {
		const provider = getProviderById(
			this.plugin.settings.ai.providers,
			providerId,
		)
		if (!provider) {
			logger.warn(`Provider not found for protocol open: ${providerId}`)
			new Notice(
				i18n.t('settings.ai.errors.providerNotFoundForProtocolOpen', {
					providerId,
				}),
			)
			return
		}

		new ProviderEditorModal(
			this.plugin,
			provider,
			async (savedProvider) => {
				this.plugin.settings.ai.providers = {
					...this.plugin.settings.ai.providers,
					[savedProvider.id]: savedProvider,
				}
				await this.plugin.settingsService.saveSettings()
				return true
			},
			false,
			mountTarget,
		).open()
	}
}
