import { cloneDeep } from 'lodash-es'
import { Modal, Notice, Setting, setIcon } from 'obsidian'
import {
	createModelConfig,
	createProviderConfig,
	createProviderFromPreset,
	listMissingPresetModelsForProvider,
	listPresetProviders,
	listProviders,
} from '~/ai/catalog/config'
import { AIProviderConfig } from '~/ai/core/types'
import { getProviderDefaultBaseURL } from '~/ai/providers/defaults'
import i18n from '~/i18n'
import {
	addClassTokens,
	removeClassTokens,
	toggleClassTokens,
} from '~/utils/class-tokens'
import logger from '~/utils/logger'
import type QuarkSyncPlugin from '..'
import ProviderEditorModal from './ProviderEditorModal'
import ProviderModelsUpdateConfirmModal from './ProviderModelsUpdateConfirmModal'

const CUSTOM_OPTION = '__custom__'
type PresetModelsRefreshState = 'idle' | 'loading' | 'success' | 'error'
interface PresetModelsRefreshSummary {
	providersDelta: number
	modelsDelta: number
}

export default class ProvidersManagerModal extends Modal {
	private selectedPresetId = CUSTOM_OPTION
	private presetModelsRefreshState: PresetModelsRefreshState = 'idle'
	private presetModelsRefreshSummary: PresetModelsRefreshSummary = {
		providersDelta: 0,
		modelsDelta: 0,
	}

	constructor(
		private plugin: QuarkSyncPlugin,
		private onChanged: () => Promise<void> | void,
	) {
		super(plugin.app)
	}

	onOpen() {
		this.render()
	}

	private render() {
		const { contentEl } = this
		contentEl.empty()
		contentEl.createEl('h2', {
			text: i18n.t('settings.ai.modals.providers.title'),
		})

		const presets = listPresetProviders()

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.providers.refreshPresetName'))
			.setDesc(i18n.t('settings.ai.providers.refreshPresetDesc'))
			.addButton((button) => {
				button
					.setButtonText(this.getPresetRefreshButtonText())
					.setDisabled(this.presetModelsRefreshState === 'loading')

				const buttonEl = button.buttonEl
				toggleClassTokens(
					buttonEl,
					':uno: connection-button',
					this.presetModelsRefreshState !== 'idle',
				)
				toggleClassTokens(
					buttonEl,
					':uno: loading',
					this.presetModelsRefreshState === 'loading',
				)
				toggleClassTokens(
					buttonEl,
					':uno: opacity-50',
					this.presetModelsRefreshState === 'loading',
				)
				toggleClassTokens(
					buttonEl,
					':uno: pointer-events-none',
					this.presetModelsRefreshState === 'loading',
				)
				toggleClassTokens(
					buttonEl,
					':uno: success',
					this.presetModelsRefreshState === 'success',
				)
				toggleClassTokens(
					buttonEl,
					':uno: mod-warning',
					this.presetModelsRefreshState === 'error',
				)

				button.onClick(async () => {
					if (this.presetModelsRefreshState === 'loading') {
						return
					}
					this.presetModelsRefreshState = 'loading'
					this.presetModelsRefreshSummary = {
						providersDelta: 0,
						modelsDelta: 0,
					}
					this.render()
					try {
						const result =
							await this.plugin.modelsPresetService.refreshFromRemote()
						this.presetModelsRefreshState = result.success ? 'success' : 'error'
						this.presetModelsRefreshSummary = {
							providersDelta: result.providersDelta,
							modelsDelta: result.modelsDelta,
						}
						if (!result.success) {
							new Notice(
								result.errorMessage
									? i18n.t(
											'settings.ai.providers.presetModelsRefreshFailedWithReason',
											{ reason: result.errorMessage },
										)
									: i18n.t('settings.ai.providers.presetModelsRefreshFailed'),
								10000,
							)
						}
					} catch (error) {
						logger.error(error)
						this.presetModelsRefreshState = 'error'
						new Notice(
							error instanceof Error
								? i18n.t(
										'settings.ai.providers.presetModelsRefreshFailedWithReason',
										{ reason: error.message },
									)
								: i18n.t('settings.ai.providers.presetModelsRefreshFailed'),
							10000,
						)
					} finally {
						this.render()
					}
				})
			})

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.providers.name'))
			.setDesc(i18n.t('settings.ai.providers.desc'))
			.addDropdown((dropdown) => {
				addClassTokens(dropdown.selectEl, ':uno: max-w-32!')
				dropdown.addOption(
					CUSTOM_OPTION,
					i18n.t('settings.ai.providers.presetCustom'),
				)
				for (const preset of presets) {
					dropdown.addOption(preset.id, preset.name)
				}
				dropdown.setValue(this.selectedPresetId)
				dropdown.onChange((value) => {
					this.selectedPresetId = value
				})
			})
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.ai.providers.add'))
					.setCta()
					.onClick(() => {
						const preset =
							this.selectedPresetId !== CUSTOM_OPTION
								? presets.find((p) => p.id === this.selectedPresetId)
								: undefined
						const draft = preset
							? createProviderFromPreset(preset, '')
							: createProviderConfig()
						new ProviderEditorModal(
							this.plugin,
							draft,
							async (provider) => {
								if (!this.validateProviderKey(provider)) {
									return false
								}
								this.plugin.settings.ai.providers = {
									...this.plugin.settings.ai.providers,
									[provider.id]: provider,
								}
								await this.onChanged()
								this.render()
								return true
							},
							true,
						).open()
					}),
			)


		const providers = listProviders(this.plugin.settings.ai.providers)
		if (providers.length === 0) {
			contentEl.createDiv({
				cls: ':uno: setting-item-description',
				text: i18n.t('settings.ai.providers.empty'),
			})
			return
		}

		for (const provider of providers) {
			const missingPresetModels = listMissingPresetModelsForProvider(provider)
			new Setting(contentEl)
				.setName(provider.name || i18n.t('settings.ai.unnamedProvider'))
				.setDesc(
					provider.api ||
						getProviderDefaultBaseURL(provider.npm) ||
						i18n.t('settings.ai.providers.defaultEndpoint'),
				)
				.then((setting) => {
					if (missingPresetModels.length > 0) {
						setting.descEl.createDiv({
							cls: ':uno: setting-item-description',
							text: i18n.t('settings.ai.providers.updateModelsHint', {
								count: missingPresetModels.length,
							}),
						})
					}
				})
				.addButton((button) => {
					if (missingPresetModels.length === 0) {
						button.buttonEl.hide()
						return
					}
					button
						.setButtonText(i18n.t('settings.ai.providers.updateModels'))
						.setCta()
						.onClick(async () => {
							const confirmed = await new ProviderModelsUpdateConfirmModal(
								this.plugin.app,
								provider,
								missingPresetModels,
							).openAndWait()
							if (!confirmed) return
							await this.addMissingPresetModels(provider, missingPresetModels)
						})
				})
				.addButton((button) =>
					button
						.setButtonText(i18n.t('settings.ai.modals.provider.edit'))
						.onClick(() => {
							new ProviderEditorModal(
								this.plugin,
								provider,
								async (savedProvider) => {
									if (!this.validateProviderKey(savedProvider, provider.id)) {
										return false
									}
									const { [provider.id]: _old, ...rest } =
										this.plugin.settings.ai.providers
									this.plugin.settings.ai.providers = {
										...rest,
										[savedProvider.id]: savedProvider,
									}
									await this.onChanged()
									this.render()
									return true
								},
								false,
							).open()
						}),
				)
				.addButton((button) => {
					let confirmDelete = false

					const resetButton = () => {
						confirmDelete = false
						button.buttonEl.empty()
						setIcon(button.buttonEl, 'trash')
						removeClassTokens(button.buttonEl, ':uno: mod-warning')
					}

					button.setIcon('trash').onClick(async () => {
						if (!confirmDelete) {
							confirmDelete = true
							button.buttonEl.empty()
							button.buttonEl.createSpan({
								text: i18n.t('settings.ai.modals.confirmDeleteLabel'),
							})
							addClassTokens(button.buttonEl, ':uno: mod-warning')
							return
						}
						await this.deleteProvider(provider)
					})
					button.buttonEl.addEventListener('blur', resetButton)
				})
		}
	}

	private getPresetRefreshButtonText() {
		switch (this.presetModelsRefreshState) {
			case 'loading':
				return i18n.t('settings.ai.providers.refreshPresetModelsLoading')
			case 'success':
				return i18n.t('settings.ai.providers.refreshPresetModelsSuccess', {
					providers: this.formatSignedDelta(
						this.presetModelsRefreshSummary.providersDelta,
					),
					models: this.formatSignedDelta(
						this.presetModelsRefreshSummary.modelsDelta,
					),
				})
			case 'error':
				return i18n.t('settings.ai.providers.refreshPresetModelsFailure')
			default:
				return i18n.t('settings.ai.providers.refreshPresetModels')
		}
	}

	private formatSignedDelta(value: number) {
		if (value >= 0) {
			return `+${value}`
		}
		return `${value}`
	}

	private validateProviderKey(provider: AIProviderConfig, currentId?: string) {
		if (!provider.id) {
			new Notice(i18n.t('settings.ai.errors.emptyProviderId'))
			return false
		}
		const existing = this.plugin.settings.ai.providers[provider.id]
		if (existing && existing.id !== currentId) {
			new Notice(i18n.t('settings.ai.errors.duplicateProviderId'))
			return false
		}
		return true
	}

	private async deleteProvider(provider: AIProviderConfig) {
		try {
			const { [provider.id]: _deleted, ...providers } =
				this.plugin.settings.ai.providers
			this.plugin.settings.ai.providers = providers
			await this.onChanged()
			new Notice(i18n.t('settings.ai.modals.provider.deleted'))
			this.render()
		} catch (error) {
			logger.error(error)
			new Notice(
				error instanceof Error
					? error.message
					: i18n.t('settings.ai.errors.saveFailed'),
			)
		}
	}

	private async addMissingPresetModels(
		provider: AIProviderConfig,
		models: AIProviderConfig['models'][string][],
	) {
		try {
			const existing = this.plugin.settings.ai.providers[provider.id]
			if (!existing) return
			const mergedModels = { ...existing.models }
			for (const model of models) {
				mergedModels[model.id] = createModelConfig(cloneDeep(model), model.id)
			}
			this.plugin.settings.ai.providers = {
				...this.plugin.settings.ai.providers,
				[provider.id]: {
					...existing,
					models: mergedModels,
				},
			}
			await this.onChanged()
			new Notice(
				i18n.t('settings.ai.providers.updateModelsSuccess', {
					count: models.length,
				}),
			)
			this.render()
		} catch (error) {
			logger.error(error)
			new Notice(
				error instanceof Error
					? error.message
					: i18n.t('settings.ai.errors.saveFailed'),
			)
		}
	}

	onClose() {
		this.contentEl.empty()
	}
}
