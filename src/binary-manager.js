const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

class BinaryManager {
  constructor(userDataPath) {
    this.binDir = path.join(userDataPath, 'bin');
    this.ytdlpPath = null;
    this.ffmpegDir = null;

    // Ensure bin directory exists
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
  }

  getYtDlpPath() {
    return this.ytdlpPath;
  }

  getFfmpegDir() {
    return this.ffmpegDir;
  }

  /**
   * Ensure all required binaries are available
   */
  async ensureBinaries(progressCallback) {
    // Check for yt-dlp
    progressCallback('Checking for yt-dlp...');
    this.ytdlpPath = await this._findOrDownloadYtDlp(progressCallback);

    // Check for ffmpeg
    progressCallback('Checking for FFmpeg...');
    this.ffmpegDir = await this._findFfmpeg(progressCallback);

    return !!(this.ytdlpPath);
  }

  /**
   * Find yt-dlp in system PATH or download it
   */
  async _findOrDownloadYtDlp(progressCallback) {
    // Check local bin directory first
    const localPath = path.join(this.binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (fs.existsSync(localPath)) {
      progressCallback('Found local yt-dlp');
      return localPath;
    }

    // Check system PATH
    const systemPath = await this._findInPath('yt-dlp');
    if (systemPath) {
      progressCallback('Found yt-dlp in system PATH');
      return systemPath;
    }

    // Download yt-dlp
    progressCallback('Downloading yt-dlp...');
    try {
      await this._downloadYtDlp(localPath, progressCallback);
      return localPath;
    } catch (err) {
      progressCallback(`Failed to download yt-dlp: ${err.message}`);
      return null;
    }
  }

  /**
   * Find ffmpeg in system PATH or local bin
   */
  async _findFfmpeg(progressCallback) {
    // Check local bin directory
    const localFfmpeg = path.join(this.binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(localFfmpeg)) {
      progressCallback('Found local FFmpeg');
      return this.binDir;
    }

    // Check system PATH
    const systemPath = await this._findInPath('ffmpeg');
    if (systemPath) {
      progressCallback('Found FFmpeg in system PATH');
      return path.dirname(systemPath);
    }

    progressCallback('FFmpeg not found — video merging may be limited. Install FFmpeg for full functionality.');
    return null;
  }

  /**
   * Check if a binary exists in system PATH
   */
  _findInPath(binary) {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const proc = spawn(cmd, [binary], { windowsHide: true });
      let stdout = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim().split('\n')[0].trim());
        } else {
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  }

  /**
   * Download yt-dlp binary from GitHub releases
   */
  async _downloadYtDlp(destPath, progressCallback) {
    const platform = process.platform;
    let assetName;

    if (platform === 'win32') {
      assetName = 'yt-dlp.exe';
    } else if (platform === 'darwin') {
      assetName = 'yt-dlp_macos';
    } else {
      assetName = 'yt-dlp_linux';
    }

    const releaseUrl = `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`;

    // Get latest release info
    const releaseInfo = await this._httpsGet(releaseUrl);
    const release = JSON.parse(releaseInfo);
    const asset = release.assets.find(a => a.name === assetName);

    if (!asset) {
      throw new Error(`Could not find ${assetName} in latest yt-dlp release`);
    }

    progressCallback(`Downloading yt-dlp (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);

    // Download the binary
    await this._downloadFile(asset.browser_download_url, destPath, (percent) => {
      progressCallback(`Downloading yt-dlp: ${percent}%`);
    });

    // Make executable on non-Windows
    if (platform !== 'win32') {
      fs.chmodSync(destPath, '755');
    }

    progressCallback('yt-dlp downloaded successfully!');
  }

  /**
   * HTTPS GET request that follows redirects
   */
  _httpsGet(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: { 'User-Agent': 'GrabTube/1.0' }
      };

      https.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._httpsGet(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Download a file with progress tracking
   */
  _downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: { 'User-Agent': 'GrabTube/1.0' }
      };

      https.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;

        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            onProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(resolve); });
        file.on('error', (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
      }).on('error', reject);
    });
  }
}

module.exports = { BinaryManager };
