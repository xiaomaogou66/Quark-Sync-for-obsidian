import { describe, expect, it } from 'vitest'
import type { StatModel } from '~/model/stat.model'
import { buildRemoteWalkResults } from './build-remote-walk-results'

function file(path: string): StatModel {
	return {
		path,
		basename: path.split('/').pop() ?? path,
		isDir: false,
		isDeleted: false,
		mtime: 1,
		size: 1,
	}
}

function dir(path: string): StatModel {
	return {
		path,
		basename: path.split('/').pop() ?? path,
		isDir: true,
		isDeleted: false,
	}
}

const noRules = { rules: [] }

describe('buildRemoteWalkResults', () => {
	it('rewrites absolute remote paths to vault-relative paths', () => {
		const results = buildRemoteWalkResults({
			traversedStats: [dir('/Vault'), file('/Vault/a.md'), dir('/Vault/sub'), file('/Vault/sub/b.md')],
			remoteBaseDir: '/Vault',
			configDir: '.obsidian',
			filterRules: noRules,
		})

		expect(results.map((result) => result.stat.path).sort()).toEqual([
			'a.md',
			'sub',
			'sub/b.md',
		])
		expect(results.every((result) => result.ignored === false)).toBe(true)
	})

	it('drops entries outside the remote base dir', () => {
		const results = buildRemoteWalkResults({
			traversedStats: [file('/Vault/a.md'), file('/Other/b.md')],
			remoteBaseDir: '/Vault',
			configDir: '.obsidian',
			filterRules: noRules,
		})

		expect(results.map((result) => result.stat.path)).toEqual(['a.md'])
	})

	it('marks filtered paths as ignored but keeps ancestors', () => {
		const results = buildRemoteWalkResults({
			traversedStats: [
				dir('/Vault'),
				dir('/Vault/.git'),
				file('/Vault/.git/config'),
				file('/Vault/a.md'),
			],
			remoteBaseDir: '/Vault',
			configDir: '.obsidian',
			filterRules: {
				rules: [
					{
						expr: '**/.git',
						type: 'exclude',
						options: { caseSensitive: false },
					},
				],
			},
		})

		const byPath = new Map(results.map((result) => [result.stat.path, result]))
		expect(byPath.get('.git')?.ignored).toBe(true)
		expect(byPath.get('.git/config')?.ignored).toBe(true)
		expect(byPath.get('a.md')?.ignored).toBe(false)
	})

	it('excludes the sync cache file', () => {
		const results = buildRemoteWalkResults({
			traversedStats: [
				file('/Vault/a.md'),
				file(
					'/Vault/.obsidian/plugins/nutstore-sync/cache/ObsidianNutstoreSync.SyncCache.v1',
				),
			],
			remoteBaseDir: '/Vault',
			configDir: '.obsidian',
			filterRules: noRules,
		})

		const cacheEntry = results.find((result) =>
			result.stat.path.includes('nutstore-sync-cache'),
		)
		if (cacheEntry) {
			expect(cacheEntry.ignored).toBe(true)
		}
	})

	it('returns an empty list for an empty traversal', () => {
		expect(
			buildRemoteWalkResults({
				traversedStats: [],
				remoteBaseDir: '/Vault',
				configDir: '.obsidian',
				filterRules: noRules,
			}),
		).toEqual([])
	})
})
