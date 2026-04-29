/**
 * Backblaze B2 helper — uses the B2 Native API (not S3-compatible)
 * Docs: https://www.backblaze.com/apidocs/
 */

const B2_API = 'https://api.backblazeb2.com';

export class B2Client {
  constructor(keyId, appKey, bucketId, bucketName) {
    this.keyId      = keyId;
    this.appKey     = appKey;
    this.bucketId   = bucketId;
    this.bucketName = bucketName;
    this._auth      = null;  // cached auth token
  }

  /** Authorize account, cache credentials */
  async authorize() {
    if (this._auth && this._auth.expiresAt > Date.now()) return this._auth;

    const creds  = btoa(`${this.keyId}:${this.appKey}`);
    const res    = await fetch(`${B2_API}/b2api/v3/b2_authorize_account`, {
      headers: { Authorization: `Basic ${creds}` },
    });
    if (!res.ok) throw new Error(`B2 auth failed: ${res.status} ${await res.text()}`);

    const data = await res.json();
    this._auth = {
      apiUrl:        data.apiInfo.storageApi.apiUrl,
      downloadUrl:   data.apiInfo.storageApi.downloadUrl,
      authToken:     data.authorizationToken,
      expiresAt:     Date.now() + 23 * 60 * 60 * 1000, // tokens last ~24h
    };
    return this._auth;
  }

  /** Get upload URL + auth token for a single upload */
  async getUploadUrl() {
    const auth = await this.authorize();
    const res  = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
      method:  'POST',
      headers: {
        Authorization:  auth.authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucketId: this.bucketId }),
    });
    if (!res.ok) throw new Error(`B2 get_upload_url failed: ${await res.text()}`);
    return res.json();
  }

  /**
   * Upload a file to B2
   * @param {string}      key       object key / path in bucket
   * @param {ArrayBuffer} buffer    file bytes
   * @param {string}      mimeType  e.g. 'image/jpeg'
   * @returns {{ fileId, fileName, contentLength, publicUrl }}
   */
  async upload(key, buffer, mimeType = 'application/octet-stream') {
    const uploadInfo = await this.getUploadUrl();
    const auth       = await this.authorize();

    // Compute SHA1 for B2 integrity check
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
    const sha1       = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const res = await fetch(uploadInfo.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization:     uploadInfo.authorizationToken,
        'X-Bz-File-Name':  encodeURIComponent(key),
        'Content-Type':    mimeType,
        'Content-Length':  buffer.byteLength,
        'X-Bz-Content-Sha1': sha1,
      },
      body: buffer,
    });
    if (!res.ok) throw new Error(`B2 upload failed: ${await res.text()}`);

    const data = await res.json();
    return {
      fileId:     data.fileId,
      fileName:   data.fileName,
      publicUrl:  `${auth.downloadUrl}/file/${this.bucketName}/${key}`,
    };
  }

  /**
   * Generate a time-limited download authorization URL (for private buckets)
   */
  async getDownloadUrl(key, validDurationSeconds = 3600) {
    const auth = await this.authorize();
    const res  = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_download_authorization`, {
      method:  'POST',
      headers: {
        Authorization:  auth.authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId:               this.bucketId,
        fileNamePrefix:         key,
        validDurationInSeconds: validDurationSeconds,
      }),
    });
    if (!res.ok) throw new Error(`B2 download_auth failed: ${await res.text()}`);
    const data = await res.json();
    return `${auth.downloadUrl}/file/${this.bucketName}/${key}?Authorization=${data.authorizationToken}`;
  }

  /** Delete a file */
  async deleteFile(fileId, fileName) {
    const auth = await this.authorize();
    const res  = await fetch(`${auth.apiUrl}/b2api/v3/b2_delete_file_version`, {
      method:  'POST',
      headers: {
        Authorization:  auth.authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileId, fileName }),
    });
    if (!res.ok) throw new Error(`B2 delete failed: ${await res.text()}`);
    return true;
  }
}

export function makeB2(env) {
  return new B2Client(
    env.B2_KEY_ID,
    env.B2_APP_KEY,
    env.B2_BUCKET_ID,
    env.B2_BUCKET_NAME,
  );
}
