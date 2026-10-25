import i18n from '~/i18n'
import { Notice, Setting } from 'obsidian'
import type { QuarkOverwriteMode, QuarkSettings } from '~/settings'
import { addClassTokens, removeClassTokens } from '~/utils/class-tokens'
import BaseSettings from './settings.base'

interface QuarkFieldSpec {
	nameKey:
		| 'settings.quark.appId.name'
		| 'settings.quark.signKey.name'
		| 'settings.quark.accessToken.name'
		| 'settings.quark.refreshToken.name'
		| 'settings.quark.refreshEndpoint.name'
		| 'settings.quark.rootFid.name'
		| 'settings.quark.folderFileType.name'
	descKey:
		| 'settings.quark.appId.desc'
		| 'settings.quark.signKey.desc'
		| 'settings.quark.accessToken.desc'
		| 'settings.quark.refreshToken.desc'
		| 'settings.quark.refreshEndpoint.desc'
		| 'settings.quark.rootFid.desc'
		| 'settings.quark.folderFileType.desc'
	key: keyof QuarkSettings
	password?: boolean
	placeholder?: string
}

/**
 * Quark Drive credentials panel.
 *
 * Quark has no WebDAV endpoint and no public username/password login, so every
 * user registers their own app on the Quark open platform and pastes the
 * resulting `app_id` / `sign_key` plus an OAuth access token here. The secret
 * never leaves the local vault.
 */
export default class QuarkAccountSettings extends BaseSettings {
	private static readonly FIELDS: QuarkFieldSpec[] = [
		{
			nameKey: 'settings.quark.appId.name',
			descKey: 'settings.quark.appId.desc',
			key: 'appId',
			placeholder: '93b14d40cbef4e5d91945ec93d26fe8f',
		},
		{
			nameKey: 'settings.quark.signKey.name',
			descKey: 'settings.quark.signKey.desc',
			key: 'signKey',
			password: true,
		},
		{
			nameKey: 'settings.quark.accessToken.name',
			descKey: 'settings.quark.accessToken.desc',
			key: 'accessToken',
			password: true,
		},
		{
			nameKey: 'settings.quark.refreshToken.name',
			descKey: 'settings.quark.refreshToken.desc',
			key: 'refreshToken',
			password: true,
		},
		{
			nameKey: 'settings.quark.refreshEndpoint.name',
			descKey: 'settings.quark.refreshEndpoint.desc',
			key: 'refreshEndpoint',
			placeholder: 'https://api.oplist.org/quarkyun/renewapi',
		},
		{
			nameKey: 'settings.quark.rootFid.name',
			descKey: 'settings.quark.rootFid.desc',
			key: 'rootFid',
			placeholder: '0',
		},
		{
			nameKey: 'settings.quark.folderFileType.name',
			descKey: 'settings.quark.folderFileType.desc',
			key: 'folderFileType',
			placeholder: '0',
		},
	]

	async display() {
		this.containerEl.empty()

		const hint = new Setting(this.containerEl).setDesc(
			i18n.t('settings.quark.hint'),
		)
		addClassTokens(hint.settingEl, ':uno: flex-col', ':uno: items-start')
		const anchor = hint.descEl.createEl('a', {
			href: 'https://open.quark.cn/',
			cls: ':uno: settings-helper-badge no-underline',
			text: i18n.t('settings.quark.openPlatform'),
		})
		anchor.target = '_blank'

		for (const field of QuarkAccountSettings.FIELDS) {
			new Setting(this.containerEl)
				.setName(i18n.t(field.nameKey))
				.setDesc(i18n.t(field.descKey))
				.addText((text) => {
					if (field.placeholder !== undefined) {
						text.setPlaceholder(field.placeholder)
					}
					text
						.setValue(String(this.plugin.settings.quark[field.key] ?? ''))
						.onChange(async (value) => {
							this.setQuarkField(field.key, value.trim())
							await this.plugin.settingsService.saveSettings()
						})
					if (field.password) {
						text.inputEl.type = 'password'
					}
					addClassTokens(text.inputEl, ':uno: w-full')
				})
		}

		new Setting(this.containerEl)
			.setName(i18n.t('settings.quark.overwriteMode.name'))
			.setDesc(i18n.t('settings.quark.overwriteMode.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('reuse', i18n.t('settings.quark.overwriteMode.reuse'))
					.addOption(
						'delete-first',
						i18n.t('settings.quark.overwriteMode.deleteFirst'),
					)
					.setValue(this.plugin.settings.quark.overwriteMode)
					.onChange(async (value) => {
						this.plugin.settings.quark.overwriteMode =
							value as QuarkOverwriteMode
						await this.plugin.settingsService.saveSettings()
					}),
			)

		this.displayCheckConnection()
	}

	private setQuarkField(key: keyof QuarkSettings, value: string) {
		const quark = this.plugin.settings.quark as unknown as Record<
			keyof QuarkSettings,
			unknown
		>
		if (key === 'overwriteMode') {
			quark[key] = value
			return
		}
		quark[key] = value
	}

	private displayCheckConnection() {
		new Setting(this.containerEl)
			.setName(i18n.t('settings.quark.checkConnection.name'))
			.setDesc(i18n.t('settings.quark.checkConnection.desc'))
			.addButton((button) => {
				button
					.setButtonText(i18n.t('settings.quark.checkConnection.button'))
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
							'settings.quark.checkConnection.button',
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
