import { describe, expect, it } from 'vitest'
import { md5Hex, md5HexOfText } from './md5'

describe('md5', () => {
	it('matches RFC 1321 test vectors', () => {
		expect(md5HexOfText('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
		expect(md5HexOfText('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
		expect(md5HexOfText('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
		expect(md5HexOfText('message digest')).toBe(
			'f96b697d7cb7938d525a2f31aaf161d0',
		)
		expect(md5HexOfText('abcdefghijklmnopqrstuvwxyz')).toBe(
			'c3fcd3d76192e4007dfb496cca67e13b',
		)
		expect(
			md5HexOfText(
				'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
			),
		).toBe('d174ab98d277d9f5a5611c2c9f419d9f')
	})

	it('handles long inputs at block boundaries', () => {
		expect(md5HexOfText('1234567890'.repeat(8))).toBe(
			'57edf4a22be3c955ac49da2e2107b67a',
		)
	})

	it('handles binary input', () => {
		expect(md5Hex(new Uint8Array([0, 1, 2, 3, 255]))).toBe(
			'b59121341ab26766729b7f1d7f7e0c2f',
		)
	})
})
