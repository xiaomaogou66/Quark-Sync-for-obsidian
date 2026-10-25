import { describe, expect, it } from 'vitest'
import {
	DEFAULT_QUARK_SETTINGS,
	DEFAULT_WEBDAV_SETTINGS,
	migrateQuarkSettings,
	migrateWebDavSettings,
} from './quark-settings'

describe('migrateQuarkSettings', () => {
	it('returns defaults for missing or invalid input', () => {
		expect(migrateQuarkSettings(undefined)).toEqual(DEFAULT_QUARK_SETTINGS)
		expect(migrateQuarkSettings(null)).toEqual(DEFAULT_QUARK_SETTINGS)
		expect(migrateQuarkSettings('nope')).toEqual(DEFAULT_QUARK_SETTINGS)
	})

	it('fills fields introduced after the settings were stored', () => {
		const migrated = migrateQuarkSettings({
			appId: 'app',
			signKey: 'sign',
			accessToken: 'token',
		})

		expect(migrated.appId).toBe('app')
		expect(migrated.folderFileType).toBe(DEFAULT_QUARK_SETTINGS.folderFileType)
		expect(migrated.overwriteMode).toBe(DEFAULT_QUARK_SETTINGS.overwriteMode)
		expect(migrated.rootFid).toBe(DEFAULT_QUARK_SETTINGS.rootFid)
	})

	it('repairs non-string values so the backend never calls trim() on them', () => {
		const migrated = migrateQuarkSettings({
			appId: 42,
			rootFid: null,
			refreshEndpoint: undefined,
		})

		expect(migrated.appId).toBe('42')
		expect(typeof migrated.rootFid).toBe('string')
		expect(typeof migrated.refreshEndpoint).toBe('string')
	})

	it('falls back to the default overwrite mode when the stored value is unknown', () => {
		expect(
			migrateQuarkSettings({ overwriteMode: 'something-else' }).overwriteMode,
		).toBe(DEFAULT_QUARK_SETTINGS.overwriteMode)
		expect(
			migrateQuarkSettings({ overwriteMode: 'delete-first' }).overwriteMode,
		).toBe('delete-first')
	})
})

describe('migrateWebDavSettings', () => {
	it('returns defaults for missing or invalid input', () => {
		expect(migrateWebDavSettings(undefined)).toEqual(DEFAULT_WEBDAV_SETTINGS)
		expect(migrateWebDavSettings(42)).toEqual(DEFAULT_WEBDAV_SETTINGS)
	})

	it('keeps stored values and repairs non-strings', () => {
		const migrated = migrateWebDavSettings({
			baseUrl: 'http://127.0.0.1:5244/dav',
			username: 123,
		})
		expect(migrated.baseUrl).toBe('http://127.0.0.1:5244/dav')
		expect(migrated.username).toBe('')
		expect(migrated.password).toBe('')
	})
})
