import { isAbsolute } from 'path-browserify'
import { remoteEntryToStatModel } from '~/remote/remote-fs.interface'
import type { RemoteFs } from '~/remote/remote-fs.interface'

export async function statRemoteItem(remote: RemoteFs, path: string) {
	if (!isAbsolute(path)) {
		throw new Error('stat remote item, path must be absolute: ' + path)
	}
	return remoteEntryToStatModel(await remote.stat(path))
}
