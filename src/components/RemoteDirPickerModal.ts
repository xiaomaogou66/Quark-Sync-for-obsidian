import { App, Modal, Notice, Setting, setIcon } from 'obsidian'
import i18n from '~/i18n'
import type QuarkSyncPlugin from '~/index'
import type { RemoteEntry, RemoteFs } from '~/remote/remote-fs.interface'
import {
	breadcrumbs,
	joinDirPath,
	normalizeDirPath,
	parentDirPath,
	sortDirEntries,
	suggestTargetDir,
} from '~/utils/remote-dir-picker'

/**
 * Visual picker for the remote sync directory.
 *
 * Works for both backends (`RemoteFs.list` is backend neutral): browse folders,
 * create one when missing, and pick the current folder as the sync root. The
 * picker starts at the configured directory, falls back to `/` when that no
 * longer exists, and auto-enters a single-child root so an Alist gateway with a
 * single Quark mount takes zero clicks.
 */
export default class RemoteDirPickerModal extends Modal {
	private path = '/'
	private entries: RemoteEntry[] = []
	private loading = false
	private error: string | null = null
	private listEl!: HTMLElement
	private crumbsEl!: HTMLElement
	private pathEl!: HTMLElement
	private newFolderName = ''

	constructor(
		app: App,
		private plugin: QuarkSyncPlugin,
		private onChoose: (path: string) => void | Promise<void>,
	) {
		super(app)
	}

	async onOpen() {
		this.modalEl.addClass('quark-sync-dir-picker')
		this.contentEl.createEl('h3', {
			text: i18n.t('settings.remoteDirPicker.title'),
		})
		this.contentEl.createEl('p', {
			text: i18n.t('settings.remoteDirPicker.desc'),
			cls: 'setting-item-description',
		})

		this.crumbsEl = this.contentEl.createDiv({
			cls: 'quark-sync-dir-picker__crumbs',
		})
		this.pathEl = this.contentEl.createDiv({
			cls: 'setting-item-description quark-sync-dir-picker__path',
		})
		this.listEl = this.contentEl.createDiv({
			cls: 'quark-sync-dir-picker__list',
		})

		this.renderActions()

		const start = normalizeDirPath(this.plugin.remoteBaseDir || '/')
		await this.load(start)
	}

	private renderActions() {
		new Setting(this.contentEl)
			.setName(i18n.t('settings.remoteDirPicker.newFolder.name'))
			.addText((text) =>
				text
					.setPlaceholder(i18n.t('settings.remoteDirPicker.newFolder.placeholder'))
					.onChange((value) => {
						this.newFolderName = value
					}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.remoteDirPicker.newFolder.create'))
					.onClick(async () => {
						const name = this.newFolderName.trim()
						if (!name) {
							new Notice(
								i18n.t('settings.remoteDirPicker.newFolder.emptyName'),
							)
							return
						}
						try {
							const remote = await this.createRemote()
							await remote.mkdir(joinDirPath(this.path, name))
							this.newFolderName = ''
							await this.load(this.path)
						} catch (error) {
							new Notice(this.describeError(error), 8000)
						}
					}),
			)

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.remoteDirPicker.cancel'))
					.onClick(() => this.close()),
			)
			.addButton((button) => {
				button.buttonEl.addClass('mod-cta')
				button
					.setButtonText(i18n.t('settings.remoteDirPicker.choose'))
					.onClick(async () => {
						await this.onChoose(this.path)
						this.close()
					})
			})
	}

	private async createRemote(): Promise<RemoteFs> {
		return await this.plugin.remoteBackendService.createRemoteFs()
	}

	private describeError(error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		return `${i18n.t('settings.remoteDirPicker.failed')}: ${message}`
	}

	private async load(path: string) {
		this.path = normalizeDirPath(path)
		this.loading = true
		this.error = null
		this.render()

		try {
			const remote = await this.createRemote()
			const entries = await remote.list(this.path)
			this.entries = sortDirEntries(entries)
			this.loading = false
			this.render()
			await this.guessDeeper()
		} catch (error) {
			// A stale configured path must not trap the user: bounce to the root.
			if (this.path !== '/') {
				await this.load('/')
				return
			}
			this.loading = false
			this.error = this.describeError(error)
			this.render()
		}
	}

	/** On the very first visit, auto-enter a lone gateway mount. */
	private async guessDeeper() {
		if (this.path !== '/' || this.entries.length !== 1) {
			return
		}
		const only = this.entries[0]
		if (!only?.isDir) {
			return
		}
		const target = normalizeDirPath(joinDirPath('/', only.basename))
		const preferred = normalizeDirPath(this.plugin.remoteBaseDir || '/')
		if (preferred !== '/' && !preferred.startsWith(`${target}/`)) {
			return
		}
		await this.load(target)
	}

	private render() {
		this.crumbsEl.empty()
		for (const [index, crumb] of breadcrumbs(
			this.path,
			i18n.t('settings.remoteDirPicker.root'),
		).entries()) {
			if (index > 0) {
				this.crumbsEl.createSpan({ text: ' / ', cls: 'quark-sync-dir-picker__sep' })
			}
			const link = this.crumbsEl.createEl('a', { text: crumb.label })
			link.addEventListener('click', (event) => {
				event.preventDefault()
				void this.load(crumb.path)
			})
		}

		this.pathEl.setText(
			`${i18n.t('settings.remoteDirPicker.current')}: ${this.path}`,
		)

		this.listEl.empty()

		if (this.loading) {
			this.listEl.createDiv({
				text: i18n.t('settings.remoteDirPicker.loading'),
				cls: 'setting-item-description',
			})
			return
		}

		if (this.error) {
			this.listEl.createDiv({
				text: this.error,
				cls: 'mod-warning quark-sync-dir-picker__error',
			})
			new Setting(this.listEl).addButton((button) =>
				button
					.setButtonText(i18n.t('settings.remoteDirPicker.retry'))
					.onClick(() => void this.load(this.path)),
			)
			return
		}

		if (this.path !== '/') {
			this.renderRow('..', i18n.t('settings.remoteDirPicker.up'), () =>
				this.load(parentDirPath(this.path)),
			)
		}

		for (const entry of this.entries) {
			this.renderRow('folder', entry.basename, () =>
				this.load(joinDirPath(this.path, entry.basename)),
			)
		}

		if (this.entries.length === 0) {
			this.listEl.createDiv({
				text: i18n.t('settings.remoteDirPicker.empty'),
				cls: 'setting-item-description',
			})
		}

		const suggestion = suggestTargetDir(this.path, this.app.vault.getName())
		const exists = this.entries.some(
			(entry) => entry.isDir && entry.basename === this.app.vault.getName(),
		)
		if (!exists) {
			new Setting(this.listEl)
				.setDesc(
					i18n.t('settings.remoteDirPicker.suggest', { path: suggestion }),
				)
				.addButton((button) =>
					button
						.setButtonText(
							i18n.t('settings.remoteDirPicker.useSuggestion'),
						)
						.onClick(async () => {
							try {
								const remote = await this.createRemote()
								await remote.mkdir(suggestion)
								await this.onChoose(suggestion)
								this.close()
							} catch (error) {
								new Notice(this.describeError(error), 8000)
							}
						}),
				)
		}
	}

	private renderRow(icon: string, label: string, onClick: () => Promise<void>) {
		const row = this.listEl.createDiv({ cls: 'quark-sync-dir-picker__row' })
		const iconEl = row.createSpan({ cls: 'quark-sync-dir-picker__icon' })
		if (icon === '..') {
			iconEl.setText('↩')
		} else {
			setIcon(iconEl, icon)
		}
		const link = row.createEl('a', { text: label })
		link.addEventListener('click', (event) => {
			event.preventDefault()
			void onClick()
		})
	}

	onClose() {
		this.contentEl.empty()
	}
}
