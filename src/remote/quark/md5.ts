/**
 * Minimal MD5 (RFC 1321) implementation.
 *
 * Needed because the Quark upload handshake requires an MD5 of the whole file
 * and WebCrypto has no MD5. Kept dependency-free and synchronous: the caller
 * already holds the full content in memory.
 */

const S = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
	9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
	16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
	15, 21,
]

const K = new Uint32Array(64)
for (let i = 0; i < 64; i++) {
	K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
}

function rotl(value: number, shift: number) {
	return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

export function md5(bytes: Uint8Array): Uint8Array {
	const bitLength = bytes.length * 8
	const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6
	const buffer = new Uint8Array(paddedLength)
	buffer.set(bytes)
	buffer[bytes.length] = 0x80
	const view = new DataView(buffer.buffer)
	// Length in bits, little endian, 64 bit.
	view.setUint32(paddedLength - 8, bitLength >>> 0, true)
	view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true)

	let a0 = 0x67452301
	let b0 = 0xefcdab89
	let c0 = 0x98badcfe
	let d0 = 0x10325476

	const m = new Uint32Array(16)

	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let i = 0; i < 16; i++) {
			m[i] = view.getUint32(offset + i * 4, true)
		}

		let A = a0
		let B = b0
		let C = c0
		let D = d0

		for (let i = 0; i < 64; i++) {
			let F: number
			let g: number
			if (i < 16) {
				F = (B & C) | (~B & D)
				g = i
			} else if (i < 32) {
				F = (D & B) | (~D & C)
				g = (5 * i + 1) % 16
			} else if (i < 48) {
				F = B ^ C ^ D
				g = (3 * i + 5) % 16
			} else {
				F = C ^ (B | ~D)
				g = (7 * i) % 16
			}
			const tmp = D
			D = C
			C = B
			const sum = (A + F + K[i] + m[g]) >>> 0
			B = (B + rotl(sum, S[i])) >>> 0
			A = tmp
		}

		a0 = (a0 + A) >>> 0
		b0 = (b0 + B) >>> 0
		c0 = (c0 + C) >>> 0
		d0 = (d0 + D) >>> 0
	}

	const out = new Uint8Array(16)
	const outView = new DataView(out.buffer)
	outView.setUint32(0, a0, true)
	outView.setUint32(4, b0, true)
	outView.setUint32(8, c0, true)
	outView.setUint32(12, d0, true)
	return out
}

export function md5Hex(bytes: Uint8Array): string {
	return [...md5(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function md5HexOfText(text: string): string {
	return md5Hex(new TextEncoder().encode(text))
}
