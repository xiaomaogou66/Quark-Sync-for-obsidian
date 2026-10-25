import { describe, expect, it } from 'vitest'
import { buildDirPruningPredicate } from './dir-pruning'

const exclude = (expr: string) => ({
	expr,
	options: { caseSensitive: false },
	type: 'exclude' as const,
})

describe('buildDirPruningPredicate', () => {
	it('always walks when there are no rules', () => {
		const visit = buildDirPruningPredicate('/Vault', [])
		expect(visit('/Vault/.venv')).toBe(true)
	})

	it('prunes an excluded directory and keeps its siblings', () => {
		const visit = buildDirPruningPredicate('/Vault', [
			exclude('**/.venv'),
			exclude('**/node_modules'),
		])
		expect(visit('/Vault')).toBe(true)
		expect(visit('/Vault/notes')).toBe(true)
		expect(visit('/Vault/_工具/.venv')).toBe(false)
		expect(visit('/Vault/_工具/.venv/lib/python3.14/site-packages')).toBe(false)
		expect(visit('/Vault/a/node_modules')).toBe(false)
	})

	it('rebases paths that are already vault-relative', () => {
		const visit = buildDirPruningPredicate('/Vault/', [exclude('**/.venv')])
		expect(visit('.venv')).toBe(false)
		expect(visit('notes')).toBe(true)
	})

	it('does not prune paths outside the remote base dir', () => {
		const visit = buildDirPruningPredicate('/Vault', [exclude('**/.venv')])
		expect(visit('/Other/.venv')).toBe(true)
	})
})
