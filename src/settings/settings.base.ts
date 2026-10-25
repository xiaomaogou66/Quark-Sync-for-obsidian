import { App } from 'obsidian'
import { QuarkSyncSettingTab } from '.'
import QuarkSyncPlugin from '..'

export default abstract class BaseSettings {
	constructor(
		protected app: App,
		protected plugin: QuarkSyncPlugin,
		protected settings: QuarkSyncSettingTab,
		protected containerEl: HTMLElement,
	) {}

	abstract display(): Promise<void>
}
