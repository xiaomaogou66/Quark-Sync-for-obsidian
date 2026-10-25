/** Raw payloads returned by the Quark Drive open-platform API. */

export interface QuarkEnvelope<T> {
	status: number
	errno?: number
	error_info?: string
	data: T
	metadata?: unknown
}

export interface QuarkUserInfo {
	user_id: string
	nickname?: string
	avatar_url?: string
}

export interface QuarkFile {
	fid: string
	parent_fid?: string
	filename: string
	/** Folder marker. Value semantics are asserted by `isQuarkFolder`. */
	file_type?: string | number
	/** Some responses expose a boolean instead of `file_type`. */
	file?: boolean
	dir?: boolean
	type?: string
	size?: number
	content_hash?: string
	created_at?: number
	updated_at?: number
	category?: number
}

export interface QuarkListPage {
	file_list: QuarkFile[]
	last_page?: boolean
	next_query_cursor?: {
		version?: string
		token?: string
	}
}

export interface QuarkUploadPre {
	finish?: boolean
	task_id: string
	fid?: string
	part_size: number
	common_headers?: Record<string, string>
	upload_urls?: QuarkUploadUrl[]
}

export interface QuarkUploadUrl {
	part_number: number
	part_size?: number
	upload_url: string
	expired?: number
	signature_info?: {
		auth_type?: string
		signature: string
	}
}

export interface QuarkUploadUrls {
	common_headers?: Record<string, string>
	upload_urls: QuarkUploadUrl[]
}

export interface QuarkUploadFinish {
	finish?: boolean
	task_id?: string
	fid?: string
}

export interface QuarkDownloadInfo {
	fid?: string
	size?: number
	file_name?: string
	download_url: string
}

export interface QuarkUploadProof {
	proof_version: string
	proof_seed1: string
	proof_seed2: string
	proof_code1: string
	proof_code2: string
}
