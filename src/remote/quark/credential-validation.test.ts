import { describe, expect, it } from 'vitest'
import { assertQuarkCredentials, QuarkCredentialError } from './quark-client'

describe('assertQuarkCredentials', () => {
	const valid = { appId: 'abc123', signKey: 'def456', accessToken: 'ghi789' }

	it('accepts plain ASCII credentials', () => {
		expect(() => assertQuarkCredentials(valid)).not.toThrow()
	})

	it('rejects the documentation placeholder', () => {
		expect(() =>
			assertQuarkCredentials({ ...valid, appId: '…' }),
		).toThrow(/U\+2026.*placeholder/)
	})

	it('rejects empty fields', () => {
		expect(() => assertQuarkCredentials({ ...valid, signKey: '  ' })).toThrow(
			/is empty/,
		)
	})

	it('rejects line breaks from copy-paste', () => {
		expect(() =>
			assertQuarkCredentials({ ...valid, accessToken: 'abc\ndef' }),
		).toThrow(/whitespace or a line break/)
	})

	it('rejects full-width characters', () => {
		expect(() =>
			assertQuarkCredentials({ ...valid, appId: 'ａｂｃ' }),
		).toThrow(QuarkCredentialError)
	})
})
