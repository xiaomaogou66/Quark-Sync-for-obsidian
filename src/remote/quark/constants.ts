/** Official Quark Drive open-platform API base URL. */
export const QUARK_API_BASE = 'https://open-api-drive.quark.cn'
/** Root folder id in Quark; every path resolution starts here. */
export const QUARK_ROOT_FID = '0'

export const QUARK_ENDPOINTS = {
	userInfo: '/open/v1/user/info',
	fileList: '/open/v1/file/list',
	mkdir: '/open/v1/dir',
	uploadPre: '/open/v1/file/upload_pre',
	getUploadUrls: '/open/v1/file/get_upload_urls',
	uploadFinish: '/open/v1/file/upload_finish',
	downloadUrl: '/open/v1/file/get_download_url',
	move: '/open/v1/file/move',
	rename: '/open/v1/file/rename',
	delete: '/open/v1/file/delete',
} as const

/** `file_type` value that the open API uses for folders (see OpenList driver). */
export const QUARK_DEFAULT_FOLDER_FILE_TYPE = '0'
