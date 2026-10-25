import { sha256Hex } from '~/utils/sha256'
import {
	QUARK_API_BASE,
	QUARK_DEFAULT_FOLDER_FILE_TYPE,
	QUARK_ENDPOINTS,
} from './constants'
import type { QuarkHttpFn } from './http'
import { md5HexOfText } from './md5'
import type {
	QuarkDownloadInfo,
	QuarkEnvelope,
	QuarkFile,
	QuarkListPage,
	QuarkUploadFinish,
	QuarkUploadPre,
	QuarkUploadProof,
	QuarkUploadUrl,
	QuarkUploadUrls,
	QuarkUserInfo,
} from './types'

export interface QuarkCredentials {
	appId: string
	signKey: string
	accessToken: string
	refreshToken?: string
	userId?: string
}

export interface QuarkClientOptions {
	credentials: QuarkCredentials
	http: QuarkHttpFn
	apiBase?: string
	/** `file_type` value that marks a folder; OpenList uses `'0'`. */
	folderFileType?: string
	now?: () => number
	newRequestId?: () => string
	/**
	 * Called once when the API reports an expired `access_token`.
	 * Resolve with fresh credentials; reject to surface a re-auth prompt.
	 */
	refreshCredentials?: () => Promise<QuarkCredentials>
	/** Safety valve for paginated listings. */
	maxListPages?: number
}

export class QuarkApiError extends Error {
	constructor(
		readonly endpoint: string,
		readonly errno: number | undefined,
		message: string,
	) {
		super(`[quark] ${endpoint} failed: ${message}`)
		this.name = 'QuarkApiError'
	}
}

export class QuarkCredentialError extends Error {
	constructor(
		readonly field: keyof QuarkCredentials,
		message: string,
	) {
		super(`[quark] ${field}: ${message}`)
		this.name = 'QuarkCredentialError'
	}
}

/**
 * Guards the credential fields that end up in HTTP headers.
 *
 * HTTP header values must be ByteStrings, so a stray non-ASCII character (a
 * `…` from the docs, a full-width colon, a line break from copy-paste) would
 * otherwise fail deep inside the transport with an unreadable TypeError.
 */
export function assertQuarkCredentials(credentials: QuarkCredentials) {
	for (const field of [
		'appId',
		'signKey',
		'accessToken',
	] as const) {
		const value = credentials[field]
		if (!value.trim()) {
			throw new QuarkCredentialError(field, 'is empty')
		}
		for (let index = 0; index < value.length; index++) {
			const code = value.charCodeAt(index)
			if (code >= 0x21 && code <= 0x7e) {
				continue
			}
			const char = value[index]
			const hints: string[] = []
			if (char === '…' || char === '…') {
				hints.push('looks like the “…” placeholder from the docs')
			}
			if (code > 0x7e) {
				hints.push('is not ASCII, check for full-width characters')
			}
			if (code <= 0x20) {
				hints.push('is whitespace or a line break from copy-paste')
			}
			throw new QuarkCredentialError(
				field,
				`contains ${JSON.stringify(char)} (U+${code
					.toString(16)
					.toUpperCase()
					.padStart(4, '0')}) at index ${index}, which ${hints.join(' and ') || 'is not allowed in a header'}`,
			)
		}
	}
}

export class QuarkAuthError extends Error {
	constructor(message = 'Quark access token expired, please re-authorize') {
		super(message)
		this.name = 'QuarkAuthError'
	}
}

const isTokenExpired = (envelope: QuarkEnvelope<unknown>) => {
	const errno = envelope.errno ?? 0
	if (errno === 11001) {
		return true
	}
	return errno === 14001 && /access_token/i.test(envelope.error_info ?? '')
}

export function isQuarkFolder(
	file: QuarkFile,
	folderFileType = QUARK_DEFAULT_FOLDER_FILE_TYPE,
): boolean {
	if (typeof file.file === 'boolean') {
		return file.file === false
	}
	if (typeof file.dir === 'boolean') {
		return file.dir
	}
	if (file.type === 'folder' || file.type === 'dir') {
		return true
	}
	if (file.file_type !== undefined) {
		return String(file.file_type) === folderFileType
	}
	// Unknown shape: assume file, so a bad assumption never hides local content
	// behind a bogus "folder" that cannot be listed.
	return false
}

export class QuarkClient {
	private credentials: QuarkCredentials
	private readonly http: QuarkHttpFn
	private readonly apiBase: string
	private readonly folderFileType: string
	private readonly now: () => number
	private readonly newRequestId: () => string
	private readonly refreshCredentials?: () => Promise<QuarkCredentials>
	private readonly maxListPages: number

	constructor(options: QuarkClientOptions) {
		this.credentials = { ...options.credentials }
		this.http = options.http
		this.apiBase = options.apiBase ?? QUARK_API_BASE
		this.folderFileType = options.folderFileType ?? QUARK_DEFAULT_FOLDER_FILE_TYPE
		this.now = options.now ?? (() => Date.now())
		this.newRequestId =
			options.newRequestId ??
			(() =>
				typeof crypto !== 'undefined' && 'randomUUID' in crypto
					? crypto.randomUUID()
					: `${this.now()}-${Math.random().toString(36).slice(2, 10)}`)
		this.refreshCredentials = options.refreshCredentials
		this.maxListPages = options.maxListPages ?? 1000
	}

	get appId() {
		return this.credentials.appId
	}

	get accessToken() {
		return this.credentials.accessToken
	}

	get userId() {
		return this.credentials.userId
	}

	updateCredentials(credentials: QuarkCredentials) {
		this.credentials = { ...this.credentials, ...credentials }
	}

	async sign(method: string, endpoint: string, timestamp: string) {
		const payload = `${method}&${endpoint}&${timestamp}&${this.credentials.signKey}`
		return await sha256Hex(new TextEncoder().encode(payload))
	}

	private buildUrl(endpoint: string, requestId: string) {
		const params = new URLSearchParams({
			req_id: requestId,
			access_token: this.credentials.accessToken,
		})
		return `${this.apiBase}${endpoint}?${params.toString()}`
	}

	/**
	 * Signed request against the open platform.
	 *
	 * `signTimestamp` must be passed through for `upload_pre`: the proof codes
	 * are derived from the same `x-pan-token` that signs the request.
	 */
	private async request<T>(
		endpoint: string,
		method: 'GET' | 'POST',
		body?: unknown,
		options: { signTimestamp?: string; allowRefresh?: boolean } = {},
	): Promise<T> {
		assertQuarkCredentials(this.credentials)

		const timestamp = options.signTimestamp ?? this.now().toString()
		const token = await this.sign(method, endpoint, timestamp)
		const requestId = this.newRequestId()

		const response = await this.http({
			url: this.buildUrl(endpoint, requestId),
			method,
			headers: {
				'Content-Type': 'application/json',
				'x-pan-client-id': this.credentials.appId,
				'x-pan-tm': timestamp,
				'x-pan-token': token,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		})

		let envelope: QuarkEnvelope<T>
		try {
			envelope = JSON.parse(response.text) as QuarkEnvelope<T>
		} catch {
			throw new QuarkApiError(
				endpoint,
				undefined,
				`unparsable response (HTTP ${response.status}): ${response.text.slice(0, 200)}`,
			)
		}

		if (isTokenExpired(envelope)) {
			if (options.allowRefresh !== false && this.refreshCredentials) {
				this.credentials = await this.refreshCredentials()
				return this.request<T>(endpoint, method, body, {
					...options,
					allowRefresh: false,
				})
			}
			throw new QuarkAuthError()
		}

		const errno = envelope.errno ?? 0
		if (envelope.status >= 400 || errno !== 0) {
			throw new QuarkApiError(
				endpoint,
				envelope.errno,
				envelope.error_info ?? `HTTP ${envelope.status}`,
			)
		}

		return envelope.data
	}

	async userInfo() {
		const data = await this.request<QuarkUserInfo>(
			QUARK_ENDPOINTS.userInfo,
			'GET',
		)
		if (data?.user_id) {
			this.credentials.userId = data.user_id
		}
		return data
	}

	async list(parentFid: string): Promise<QuarkFile[]> {
		const files: QuarkFile[] = []
		let cursor: QuarkListPage['next_query_cursor']

		for (let page = 0; page < this.maxListPages; page++) {
			const data = await this.request<QuarkListPage>(
				QUARK_ENDPOINTS.fileList,
				'POST',
				{
					parent_fid: parentFid,
					size: 100,
					sort: 'file_name:asc',
					...(cursor ? { query_cursor: cursor } : {}),
				},
			)

			files.push(...(data?.file_list ?? []))

			const next = data?.next_query_cursor
			if (data?.last_page !== false || !next?.token) {
				break
			}
			cursor = next
		}

		return files
	}

	isFolder(file: QuarkFile) {
		return isQuarkFolder(file, this.folderFileType)
	}

	async mkdir(parentFid: string, name: string) {
		await this.request(QUARK_ENDPOINTS.mkdir, 'POST', {
			dir_path: name,
			pdir_fid: parentFid,
		})
	}

	async remove(fid: string) {
		await this.request(QUARK_ENDPOINTS.delete, 'POST', {
			action_type: 1,
			fid_list: [fid],
		})
	}

	async move(fid: string, toParentFid: string) {
		await this.request(QUARK_ENDPOINTS.move, 'POST', {
			action_type: 1,
			fid_list: [fid],
			to_pdir_fid: toParentFid,
		})
	}

	async rename(fid: string, name: string) {
		await this.request(QUARK_ENDPOINTS.rename, 'POST', {
			fid,
			file_name: name,
			conflict_mode: 'REUSE',
		})
	}

	async downloadUrl(fid: string) {
		const data = await this.request<QuarkDownloadInfo>(
			QUARK_ENDPOINTS.downloadUrl,
			'POST',
			{ fid },
		)
		if (!data?.download_url) {
			throw new QuarkApiError(
				QUARK_ENDPOINTS.downloadUrl,
				undefined,
				'missing download_url',
			)
		}
		return data
	}

	/** Cookies required when fetching a Quark download URL. */
	downloadHeaders(): Record<string, string> {
		return {
			Cookie: `x_pan_client_id=${this.credentials.appId}; x_pan_access_token=${this.credentials.accessToken}`,
		}
	}

	/**
	 * Rapid-upload proof (anti-abuse handshake).
	 *
	 * `proof_seed1 = md5(userId + x_pan_token)`, `proof_seed2 = md5(size)`,
	 * `proof_codeN = base64(content[idx .. idx+8])` where
	 * `idx = uint64(md5_hex(seedN)[0..16]) % size`.
	 */
	buildProof(
		data: ArrayBuffer,
		userFacingToken: string,
	): QuarkUploadProof {
		const size = data.byteLength
		const seed1 = md5HexOfText(`${this.credentials.userId ?? ''}${userFacingToken}`)
		const seed2 = md5HexOfText(String(size))

		const codeOf = (seed: string) => {
			if (size === 0) {
				return ''
			}
			const prefix = md5HexOfText(seed).slice(0, 16)
			const index = Number(BigInt(`0x${prefix}`) % BigInt(size))
			const end = Math.min(index + 8, size)
			const slice = new Uint8Array(data, index, end - index)
			let binary = ''
			for (const byte of slice) {
				binary += String.fromCharCode(byte)
			}
			return btoa(binary)
		}

		return {
			proof_version: 'v1',
			proof_seed1: seed1,
			proof_seed2: seed2,
			proof_code1: codeOf(seed1),
			proof_code2: codeOf(seed2),
		}
	}

	async upload(options: {
		parentFid: string
		name: string
		data: ArrayBuffer
		mime?: string
		mtime?: number
		md5: string
		sha1: string
		onProgress?: (uploadedBytes: number, totalBytes: number) => void
	}): Promise<{ fid?: string; rapidUpload: boolean }> {
		const timestamp = this.now().toString()
		const signedToken = await this.sign(
			'POST',
			QUARK_ENDPOINTS.uploadPre,
			timestamp,
		)

		const mtime = options.mtime ?? this.now()
		const proof = this.buildProof(options.data, signedToken)

		const pre = await this.request<QuarkUploadPre>(
			QUARK_ENDPOINTS.uploadPre,
			'POST',
			{
				file_name: options.name,
				size: options.data.byteLength,
				format_type: options.mime ?? 'application/octet-stream',
				md5: options.md5,
				sha1: options.sha1,
				l_created_at: mtime,
				l_updated_at: mtime,
				pdir_fid: options.parentFid,
				same_path_reuse: true,
				...proof,
			},
			{ signTimestamp: timestamp },
		)

		if (pre?.finish) {
			options.onProgress?.(options.data.byteLength, options.data.byteLength)
			return { fid: pre.fid, rapidUpload: true }
		}

		const partSize = pre.part_size > 0 ? pre.part_size : 4 * 1024 * 1024
		const total = options.data.byteLength
		const parts = [] as Array<{ part_number: number; part_size: number }>
		for (let offset = 0, partNumber = 1; offset < total; partNumber++) {
			const size = Math.min(partSize, total - offset)
			parts.push({ part_number: partNumber, part_size: size })
			offset += size
		}

		let uploadUrls: QuarkUploadUrl[] = pre.upload_urls ?? []
		let commonHeaders = pre.common_headers ?? {}
		if (uploadUrls.length === 0) {
			const data = await this.request<QuarkUploadUrls>(
				QUARK_ENDPOINTS.getUploadUrls,
				'POST',
				{ task_id: pre.task_id, part_info_list: parts },
			)
			uploadUrls = data?.upload_urls ?? []
			commonHeaders = data?.common_headers ?? commonHeaders
		}

		if (uploadUrls.length === 0) {
			throw new QuarkApiError(
				QUARK_ENDPOINTS.getUploadUrls,
				undefined,
				'no upload urls returned',
			)
		}

		const etags: string[] = []
		let uploaded = 0
		for (let index = 0; index < uploadUrls.length; index++) {
			const url = uploadUrls[index]
			const part = parts[index]
			const offset =
				part !== undefined
					? parts.slice(0, index).reduce((acc, p) => acc + p.part_size, 0)
					: 0
			const size = part?.part_size ?? partSize
			const chunk = options.data.slice(offset, offset + size)

			const response = await this.http({
				url: url.upload_url,
				method: 'PUT',
				headers: {
					Authorization: url.signature_info?.signature ?? '',
					'X-Oss-Date': commonHeaders['X-Oss-Date'] ?? '',
					'X-Oss-Content-Sha256': commonHeaders['X-Oss-Content-Sha256'] ?? '',
				},
				body: chunk,
			})

			if (response.status !== 200) {
				throw new QuarkApiError(
					QUARK_ENDPOINTS.getUploadUrls,
					undefined,
					`part ${index + 1}/${uploadUrls.length} upload failed (HTTP ${response.status})`,
				)
			}

			etags.push(response.headers['etag'] ?? '')
			uploaded += size
			options.onProgress?.(uploaded, total)
		}

		const finish = await this.request<QuarkUploadFinish>(
			QUARK_ENDPOINTS.uploadFinish,
			'POST',
			{
				task_id: pre.task_id,
				part_info_list: parts.map((part, index) => ({
					part_number: part.part_number,
					part_size: part.part_size,
					etag: etags[index],
				})),
			},
		)

		if (finish && finish.finish === false) {
			throw new QuarkApiError(
				QUARK_ENDPOINTS.uploadFinish,
				undefined,
				'upload_finish reported finish=false',
			)
		}

		return { fid: finish?.fid ?? pre.fid, rapidUpload: false }
	}
}
