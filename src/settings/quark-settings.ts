/**
 * Quark Drive settings: types, defaults and migration.
 *
 * Kept in a module that does not import `obsidian` so it can be unit tested in
 * a plain Node environment.
 */

export type RemoteProvider = 'nutstore' | 'quark'

/**
 * How `QuarkRemoteFs` handles "write a file whose name already exists".
 * `reuse` leans on the API's `same_path_reuse` flag; `delete-first` deletes the
 * old fid before uploading, which is safer against duplicate entries but puts
 * the old version in Quark's recycle bin.
 */
export type QuarkOverwriteMode = 'reuse' | 'delete-first'

export interface QuarkSettings {
	appId: string
	signKey: string
	accessToken: string
	refreshToken: string
	/** Filled automatically from `/open/v1/user/info`. */
	userId: string
	/** Quark fid used as `/` for the sync engine. */
	rootFid: string
	/** `file_type` value that marks a folder. */
	folderFileType: string
	overwriteMode: QuarkOverwriteMode
	/** Optional OpenList-compatible token refresh relay, e.g. `https://api.oplist.org/quarkyun/renewapi`. */
	refreshEndpoint: string
}

export const DEFAULT_QUARK_SETTINGS: QuarkSettings = {
	appId: '',
	signKey: '',
	accessToken: '',
	refreshToken: '',
	userId: '',
	rootFid: '0',
	folderFileType: '0',
	overwriteMode: 'reuse',
	refreshEndpoint: '',
}

/**
 * Merges stored Quark settings over the defaults.
 *
 * `loadSettings` only shallow-merges top-level keys, so a `quark` object written
 * by an older build would otherwise leave newer fields `undefined` and make the
 * backend crash on `trim()`.
 */
export function migrateQuarkSettings(input: unknown): QuarkSettings {
	const stored =
		input && typeof input === 'object'
			? (input as Partial<QuarkSettings>)
			: {}
	const merged: QuarkSettings = { ...DEFAULT_QUARK_SETTINGS, ...stored }
	for (const key of Object.keys(DEFAULT_QUARK_SETTINGS) as Array<
		keyof QuarkSettings
	>) {
		if (typeof merged[key] === 'string') {
			continue
		}
		const stored = merged[key] as unknown
		const target = merged as unknown as Record<keyof QuarkSettings, string>
		// Keep recoverable scalars (e.g. a numeric id), fall back to the default
		// for missing or unusable ones so the backend can always call `trim()`.
		target[key] =
			typeof stored === 'number' || typeof stored === 'boolean'
				? String(stored)
				: DEFAULT_QUARK_SETTINGS[key]
	}
	if (!['reuse', 'delete-first'].includes(merged.overwriteMode)) {
		merged.overwriteMode = DEFAULT_QUARK_SETTINGS.overwriteMode
	}
	return merged
}
