import { describe, expect, it } from 'vitest'
import { compileFilterRules, isPathIncluded } from './glob-match'
import {
	buildConfigDirExtraFileRules,
	computeEffectiveFilterRulesFromParts,
} from './config-dir-rules'

const CONFIG = '.obsidian'
const ICAL = `${CONFIG}/plugins/ical/data.json`

const ruleSet = (extra: string[]) =>
	compileFilterRules(
		computeEffectiveFilterRulesFromParts(CONFIG, 'none', { rules: [] }, extra)
			.rules,
	)

describe('configDirExtraPaths', () => {
	it('syncs nothing from the config dir by default', () => {
		const rules = ruleSet([])
		expect(isPathIncluded(ICAL, rules)).toBe(false)
		expect(isPathIncluded(`${CONFIG}/appearance.json`, rules)).toBe(false)
	})

	it('syncs exactly the opted-in file and its ancestors', () => {
		const rules = ruleSet([ICAL])
		expect(isPathIncluded(ICAL, rules)).toBe(true)
		// ancestors must stay traversable, otherwise the walk prunes the subtree
		expect(isPathIncluded(`${CONFIG}/plugins/ical`, rules, true)).toBe(true)
		expect(isPathIncluded(`${CONFIG}/plugins/ical`, rules)).toBe(true)
	})

	it('still blocks config files that were not opted in', () => {
		const rules = ruleSet([ICAL])
		expect(isPathIncluded(`${CONFIG}/appearance.json`, rules)).toBe(false)
		expect(isPathIncluded(`${CONFIG}/workspace.json`, rules)).toBe(false)
		expect(isPathIncluded(`${CONFIG}/plugins/ical/other.json`, rules)).toBe(
			false,
		)
		expect(isPathIncluded(`${CONFIG}/plugins/quickadd/data.json`, rules)).toBe(
			false,
		)
	})

	it('keeps the plugin credential file blocked even when asked for it', () => {
		const rules = ruleSet([`${CONFIG}/plugins/quark-sync/data.local.json`])
		expect(
			isPathIncluded(`${CONFIG}/plugins/quark-sync/data.local.json`, rules),
		).toBe(false)
	})

	it('ignores paths outside the config dir and malformed input', () => {
		const rules = ruleSet(['notes.md', CONFIG, './', '  '])
		expect(isPathIncluded('notes.md', rules)).toBe(true)
		expect(isPathIncluded(`${CONFIG}/appearance.json`, rules)).toBe(false)
	})

	it('normalises leading slashes and backslashes', () => {
		const rules = ruleSet(['/.obsidian/plugins/ical/data.json'])
		expect(isPathIncluded(ICAL, rules)).toBe(true)
	})

	it('supports several files at once', () => {
		const rules = ruleSet([ICAL, `${CONFIG}/plugins/quickadd/data.json`])
		expect(isPathIncluded(ICAL, rules)).toBe(true)
		expect(isPathIncluded(`${CONFIG}/plugins/quickadd/data.json`, rules)).toBe(
			true,
		)
	})

	it('is a no-op in full config-dir sync mode', () => {
		const rules = compileFilterRules(
			computeEffectiveFilterRulesFromParts(CONFIG, 'all', { rules: [] }, [ICAL])
				.rules,
		)
		expect(isPathIncluded(ICAL, rules)).toBe(true)
		expect(isPathIncluded(`${CONFIG}/appearance.json`, rules)).toBe(true)
	})

	it('re-includes every ancestor before the leaf, parents first', () => {
		const exprs = buildConfigDirExtraFileRules(CONFIG, [ICAL])
			.filter((rule) => rule.type === 'include')
			.map((rule) => rule.expr)
		expect(exprs).toEqual([
			CONFIG,
			`${CONFIG}/plugins`,
			`${CONFIG}/plugins/ical`,
			ICAL,
		])
	})
})
