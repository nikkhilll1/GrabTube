const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class Downloader {
  constructor(binaryManager) {
    this.binaryManager = binaryManager;
    this.activeDownloads = new Map(); // id -> { process, options }
  }

  /**
   * Fetch video metadata using yt-dlp --dump-json
   */
  async getVideoInfo(url) {
    const ytdlpPath = this.binaryManager.getYtDlpPath();
    if (!ytdlpPath) throw new Error('yt-dlp is not ready. Please wait for setup to complete.');

    return new Promise((resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        url
      ];

      const ffmpegPath = this.binaryManager.getFfmpegDir();
      if (ffmpegPath) {
        args.unshift('--ffmpeg-location', ffmpegPath);
      }

      let stdout = '';
      let stderr = '';

      const proc = spawn(ytdlpPath, args, { windowsHide: true });

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(this._parseError(stderr) || `yt-dlp exited with code ${code}`));
        }

        try {
          const info = JSON.parse(stdout);
          resolve(this._formatVideoInfo(info));
        } catch (e) {
          reject(new Error('Failed to parse video information'));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
    });
  }

  /**
   * Format raw yt-dlp JSON into a clean object for the UI
   */
  _formatVideoInfo(raw) {
    // Build format list
    const formats = [];
    const seen = new Set();

    if (raw.formats) {
      // Sort by quality (highest first)
      const sorted = [...raw.formats].sort((a, b) => (b.height || 0) - (a.height || 0));

      for (const f of sorted) {
        if (f.height && f.vcodec !== 'none') {
          const label = `${f.height}p${f.fps > 30 ? f.fps : ''}`;
          const key = `${f.height}-${f.ext}`;
          if (!seen.has(key)) {
            seen.add(key);
            formats.push({
              id: f.format_id,
              label: `${label} (${f.ext.toUpperCase()})`,
              height: f.height,
              ext: f.ext,
              filesize: f.filesize || f.filesize_approx || 0,
              hasAudio: f.acodec !== 'none',
              vcodec: f.vcodec,
              acodec: f.acodec
            });
          }
        }
      }
    }

    // Add audio-only option
    formats.push({
      id: 'audio-only',
      label: 'Audio Only (MP3)',
      height: 0,
      ext: 'mp3',
      filesize: 0,
      hasAudio: true,
      audioOnly: true
    });

    return {
      title: raw.title || 'Unknown Title',
      channel: raw.channel || raw.uploader || 'Unknown Channel',
      duration: raw.duration || 0,
      durationFormatted: this._formatDuration(raw.duration),
      thumbnail: raw.thumbnail || '',
      description: (raw.description || '').substring(0, 300),
      viewCount: raw.view_count || 0,
      uploadDate: raw.upload_date || '',
      url: raw.webpage_url || raw.original_url || '',
      formats: formats
    };
  }

  /**
   * Start a download
   */
  download(options) {
    const { id, url, format, outputFolder, audioOnly, subtitles, embedMetadata, onProgress, onComplete, onError } = options;

    const ytdlpPath = this.binaryManager.getYtDlpPath();
    if (!ytdlpPath) {
      onError(new Error('yt-dlp is not ready'));
      return;
    }

    // Ensure output folder exists
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    }

    const args = [];

    // FFmpeg location
    const ffmpegDir = this.binaryManager.getFfmpegDir();
    if (ffmpegDir) {
      args.push('--ffmpeg-location', ffmpegDir);
    }

    // Format selection
    if (audioOnly) {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else if (format && format !== 'best-mp4') {
      // Specific format: try to get video+best audio, merge to mp4
      args.push('-f', `${format}+bestaudio/best`, '--merge-output-format', 'mp4');
    } else {
      // Best MP4: prefer h264 mp4 with audio
      args.push(
        '-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best',
        '--merge-output-format', 'mp4'
      );
    }

    // Subtitles
    if (subtitles) {
      args.push('--write-subs', '--sub-langs', 'all', '--embed-subs');
    }

    // Metadata
    if (embedMetadata !== false) {
      args.push('--embed-metadata', '--embed-thumbnail');
    }

    // Output template
    args.push('-o', path.join(outputFolder, '%(title)s.%(ext)s'));

    // Progress tracking
    args.push('--newline', '--progress-template', '%(progress)j');

    // No playlist (single video)
    args.push('--no-playlist');

    // The URL must be last
    args.push(url);

    const proc = spawn(ytdlpPath, args, { windowsHide: true });

    this.activeDownloads.set(id, { process: proc, options });

    let stderrBuffer = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const progress = JSON.parse(line);
          if (progress) {
            onProgress({
              percent: progress.downloaded_bytes && progress.total_bytes
                ? (progress.downloaded_bytes / progress.total_bytes) * 100
                : parseFloat(progress._percent_str) || 0,
              downloaded: progress.downloaded_bytes || 0,
              total: progress.total_bytes || progress.total_bytes_estimate || 0,
              speed: progress._speed_str || '0 B/s',
              eta: progress._eta_str || '--:--',
              status: progress.status || 'downloading'
            });
          }
        } catch (e) {
          // Not JSON — could be merge/postprocessing info
          if (line.includes('Merging') || line.includes('Deleting')) {
            onProgress({ percent: 99, status: 'merging', speed: '', eta: '' });
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      // yt-dlp also outputs progress to stderr sometimes
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const progress = JSON.parse(line);
          if (progress) {
            onProgress({
              percent: progress.downloaded_bytes && progress.total_bytes
                ? (progress.downloaded_bytes / progress.total_bytes) * 100
                : parseFloat(progress._percent_str) || 0,
              downloaded: progress.downloaded_bytes || 0,
              total: progress.total_bytes || progress.total_bytes_estimate || 0,
              speed: progress._speed_str || '0 B/s',
              eta: progress._eta_str || '--:--',
              status: progress.status || 'downloading'
            });
          }
        } catch (e) {
          // ignore non-JSON stderr
        }
      }
    });

    proc.on('close', (code) => {
      this.activeDownloads.delete(id);
      if (code === 0) {
        onComplete({ outputFolder });
      } else {
        onError(new Error(this._parseError(stderrBuffer) || `Download failed (exit code: ${code})`));
      }
    });

    proc.on('error', (err) => {
      this.activeDownloads.delete(id);
      onError(new Error(`Failed to start download: ${err.message}`));
    });
  }

  /**
   * Cancel an active download
   */
  cancel(downloadId) {
    const active = this.activeDownloads.get(downloadId);
    if (active && active.process) {
      active.process.kill('SIGTERM');
      this.activeDownloads.delete(downloadId);
    }
  }

  /**
   * Parse yt-dlp stderr for user-friendly error messages
   */
  _parseError(stderr) {
    if (!stderr) return null;
    if (stderr.includes('is not a valid URL')) return 'Invalid URL. Please enter a valid YouTube link.';
    if (stderr.includes('Video unavailable')) return 'This video is unavailable or private.';
    if (stderr.includes('geo restriction') || stderr.includes('geoblocked')) return 'This video is geo-restricted in your region.';
    if (stderr.includes('age-restricted')) return 'This video is age-restricted. Cookie authentication may be required.';
    if (stderr.includes('Private video')) return 'This video is private.';
    if (stderr.includes('HTTP Error 429')) return 'Too many requests. Please wait a moment and try again.';
    if (stderr.includes('Unable to extract')) return 'Failed to extract video data. The URL may not be supported.';
    if (stderr.includes('urlopen error') || stderr.includes('getaddrinfo failed')) return 'Network error. Please check your internet connection.';

    // Extract the last ERROR line
    const errorLines = stderr.split('\n').filter(l => l.includes('ERROR'));
    if (errorLines.length > 0) {
      return errorLines[errorLines.length - 1].replace(/^.*ERROR:\s*/, '').trim();
    }

    return null;
  }

  /**
   * Format seconds to HH:MM:SS or MM:SS
   */
  _formatDuration(seconds) {
    if (!seconds) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

module.exports = { Downloader };
