import { describe, expect, it } from 'vitest'
import type { RemoteEntry } from '~/remote/remote-fs.interface'
import {
	breadcrumbs,
	joinDirPath,
	normalizeDirPath,
	parentDirPath,
	sortDirEntries,
	suggestTargetDir,
} from './remote-dir-picker'

const entry = (basename: string, isDir: boolean): RemoteEntry => ({
	path: `/${basename}`,
	basename,
	isDir,
	size: isDir ? 0 : 1,
})

describe('normalizeDirPath', () => {
	it('keeps root as a single slash', () => {
		expect(normalizeDirPath('/')).toBe('/')
		expect(normalizeDirPath('')).toBe('/')
		expect(normalizeDirPath('///')).toBe('/')
	})

	it('adds a leading slash and collapses duplicates', () => {
		expect(normalizeDirPath('quark/vault')).toBe('/quark/vault')
		expect(normalizeDirPath('/quark//vault/')).toBe('/quark/vault')
		expect(normalizeDirPath('//quark///vault')).toBe('/quark/vault')
	})
})

describe('joinDirPath / parentDirPath', () => {
	it('joins below the root', () => {
		expect(joinDirPath('/', 'quark')).toBe('/quark')
		expect(joinDirPath('/quark', 'vault')).toBe('/quark/vault')
		expect(joinDirPath('/quark/', 'vault')).toBe('/quark/vault')
	})

	it('walks back up to the root', () => {
		expect(parentDirPath('/quark/vault')).toBe('/quark')
		expect(parentDirPath('/quark')).toBe('/')
		expect(parentDirPath('/')).toBe('/')
	})
})

describe('breadcrumbs', () => {
	it('renders the root only for /', () => {
		expect(breadcrumbs('/', 'root')).toEqual([{ label: 'root', path: '/' }])
	})

	it('builds clickable cumulative paths', () => {
		expect(breadcrumbs('/quark/文档/', 'root')).toEqual([
			{ label: 'root', path: '/' },
			{ label: 'quark', path: '/quark' },
			{ label: '文档', path: '/quark/文档' },
		])
	})
})

describe('sortDirEntries', () => {
	it('keeps only directories and sorts naturally', () => {
		const sorted = sortDirEntries([
			entry('file.md', false),
			entry('Folder10', true),
			entry('Folder2', true),
			entry('apple', true),
		])
		expect(sorted.map((item) => item.basename)).toEqual([
			'apple',
			'Folder2',
			'Folder10',
		])
	})
})

describe('suggestTargetDir', () => {
	it('appends the vault name to the current path', () => {
		expect(suggestTargetDir('/quark', 'AI学习工作流')).toBe(
			'/quark/AI学习工作流',
		)
		expect(suggestTargetDir('/', 'vault')).toBe('/vault')
	})

	it('falls back when the vault name is blank', () => {
		expect(suggestTargetDir('/quark', '   ')).toBe('/quark/vault')
	})
})
