import { existsLocalPath, readLocalBinary } from '~/utils/local-vault-io'
import { statVaultItem } from '~/utils/stat-vault-item'
import { BaseTask, toTaskError } from './task.interface'

export default class PushTask extends BaseTask {
	async exec() {
		try {
			const exists = await existsLocalPath(this.vault, this.localPath)
			if (!exists) {
				throw new Error('cannot find file in local fs: ' + this.localPath)
			}

			const content = await readLocalBinary(this.vault, this.localPath)
			this.logger.info(
				`[PushTask] ${this.localPath} → ${this.remotePath} (${content.byteLength} bytes)`,
			)
			const stat = await statVaultItem(this.vault, this.localPath)
			await this.remote.writeFile(this.remotePath, content, {
				mtime: stat?.mtime,
			})
			return { success: true } as const
		} catch (e) {
			this.logger.error(`[PushTask] failed: ${this.localPath}`, e)
			return { success: false, error: toTaskError(e, this) }
		}
	}
}
