import i18n from '~/i18n'
import { Setting } from 'obsidian'
import type { RemoteProvider } from '~/settings'
import QuarkAccountSettings from './quark'
import BaseSettings from './settings.base'
import WebDavAccountSettings from './webdav'

/**
 * Account/backend section dispatcher.
 *
 * The plugin can either talk to the Quark open platform directly or to a
 * WebDAV gateway that already owns the Quark login (Alist, OpenList,
 * quarkdrive-webdav, rclone serve, …). Each provider keeps its own panel so a
 * failed render in one never clears the other.
 */
export default class AccountSettings extends BaseSettings {
	private readonly headEl: HTMLElement
	private readonly quarkEl: HTMLElement
	private readonly webdavEl: HTMLElement
	private readonly quarkSettings: QuarkAccountSettings
	private readonly webdavSettings: WebDavAccountSettings

	constructor(
		app: ConstructorParameters<typeof BaseSettings>[0],
		plugin: ConstructorParameters<typeof BaseSettings>[1],
		settings: ConstructorParameters<typeof BaseSettings>[2],
		containerEl: HTMLElement,
	) {
		super(app, plugin, settings, containerEl)
		this.headEl = containerEl.createDiv()
		this.quarkEl = containerEl.createDiv()
		this.webdavEl = containerEl.createDiv()
		this.quarkSettings = new QuarkAccountSettings(
			app,
			plugin,
			settings,
			this.quarkEl,
		)
		this.webdavSettings = new WebDavAccountSettings(
			app,
			plugin,
			settings,
			this.webdavEl,
		)
	}

	async display() {
		this.headEl.empty()
		new Setting(this.headEl)
			.setName(i18n.t('settings.sections.account'))
			.setHeading()

		new Setting(this.headEl)
			.setName(i18n.t('settings.remoteProvider.name'))
			.setDesc(i18n.t('settings.remoteProvider.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('quark', i18n.t('settings.remoteProvider.quark'))
					.addOption('webdav', i18n.t('settings.remoteProvider.webdav'))
					.setValue(this.plugin.settings.remoteProvider)
					.onChange(async (value) => {
						this.plugin.settings.remoteProvider =
							value === 'webdav' ? 'webdav' : ('quark' satisfies RemoteProvider)
						await this.plugin.settingsService.saveSettings()
						void this.display()
					}),
			)

		if (this.plugin.settings.remoteProvider === 'webdav') {
			this.quarkEl.empty()
			await this.webdavSettings.display()
			return
		}

		this.webdavEl.empty()
		await this.quarkSettings.display()
	}
}
