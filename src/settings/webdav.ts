import i18n from '~/i18n'
import { Notice, Setting } from 'obsidian'
import type { WebDavSettings } from '~/settings'
import { addClassTokens, removeClassTokens } from '~/utils/class-tokens'
import BaseSettings from './settings.base'

interface WebDavFieldSpec {
	nameKey:
		| 'settings.webdav.baseUrl.name'
		| 'settings.webdav.username.name'
		| 'settings.webdav.password.name'
	descKey:
		| 'settings.webdav.baseUrl.desc'
		| 'settings.webdav.username.desc'
		| 'settings.webdav.password.desc'
	key: keyof WebDavSettings
	password?: boolean
	placeholder?: string
}

/**
 * WebDAV gateway credentials (Alist / OpenList / quarkdrive-webdav / rclone).
 *
 * This path needs no Quark API credentials: the gateway owns the Quark login and
 * the plugin only speaks plain WebDAV to it.
 */
export default class WebDavAccountSettings extends BaseSettings {
	private static readonly FIELDS: WebDavFieldSpec[] = [
		{
			nameKey: 'settings.webdav.baseUrl.name',
			descKey: 'settings.webdav.baseUrl.desc',
			key: 'baseUrl',
			placeholder: 'http://127.0.0.1:5244/dav',
		},
		{
			nameKey: 'settings.webdav.username.name',
			descKey: 'settings.webdav.username.desc',
			key: 'username',
		},
		{
			nameKey: 'settings.webdav.password.name',
			descKey: 'settings.webdav.password.desc',
			key: 'password',
			password: true,
		},
	]

	async display() {
		this.containerEl.empty()

		const hint = new Setting(this.containerEl).setDesc(
			i18n.t('settings.webdav.hint'),
		)
		addClassTokens(hint.settingEl, ':uno: flex-col', ':uno: items-start')

		for (const field of WebDavAccountSettings.FIELDS) {
			new Setting(this.containerEl)
				.setName(i18n.t(field.nameKey))
				.setDesc(i18n.t(field.descKey))
				.addText((text) => {
					if (field.placeholder !== undefined) {
						text.setPlaceholder(field.placeholder)
					}
					text
						.setValue(String(this.plugin.settings.webdav[field.key] ?? ''))
						.onChange(async (value) => {
							this.plugin.settings.webdav[field.key] = field.password
								? value
								: value.trim()
							await this.plugin.settingsService.saveSettings()
						})
					if (field.password) {
						text.inputEl.type = 'password'
					}
					addClassTokens(text.inputEl, ':uno: w-full')
				})
		}

		this.displayCheckConnection()
	}

	private displayCheckConnection() {
		new Setting(this.containerEl)
			.setName(i18n.t('settings.webdav.checkConnection.name'))
			.setDesc(i18n.t('settings.webdav.checkConnection.desc'))
			.addButton((button) => {
				button
					.setButtonText(i18n.t('settings.webdav.checkConnection.button'))
					.onClick(async (event) => {
						const buttonEl = event.target as HTMLElement
						addClassTokens(
							buttonEl,
							':uno: connection-button',
							':uno: loading',
							':uno: opacity-50',
							':uno: pointer-events-none',
						)
						removeClassTokens(buttonEl, ':uno: success', ':uno: error')
						buttonEl.textContent = i18n.t(
							'settings.webdav.checkConnection.button',
						)

						const { success, error, detail } =
							await this.plugin.remoteBackendService.checkRemoteConnection()

						removeClassTokens(
							buttonEl,
							':uno: loading',
							':uno: opacity-50',
							':uno: pointer-events-none',
						)
						if (success) {
							addClassTokens(buttonEl, ':uno: success')
							buttonEl.textContent = i18n.t(
								'settings.checkConnection.successButton',
							)
							new Notice(
								detail
									? `${i18n.t('settings.checkConnection.success')} (${detail})`
									: i18n.t('settings.checkConnection.success'),
							)
						} else {
							addClassTokens(buttonEl, ':uno: error')
							buttonEl.textContent = i18n.t(
								'settings.checkConnection.failureButton',
							)
							new Notice(
								`${i18n.t('settings.checkConnection.failure')}: ${error?.message ?? ''}`,
							)
						}
					})
			})
	}
}
