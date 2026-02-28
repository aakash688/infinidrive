/**
 * Streaming Telegram File Download Service
 * Downloads files in chunks using HTTP Range requests
 * No intermediate storage needed - perfect for large files
 */

/**
 * Download a specific byte range from Telegram file
 * Falls back to full download if Range not supported
 */
export async function downloadFileRange(
  botToken: string,
  filePath: string,
  start: number,
  end: number,
  fullFileSize: number
): Promise<ArrayBuffer> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  
  try {
    // Try Range request first
    const response = await fetch(url, {
      headers: {
        'Range': `bytes=${start}-${end}`,
      },
    });

    // If Range is supported (206 Partial Content)
    if (response.status === 206) {
      return await response.arrayBuffer();
    }

    // If Range not supported, we'll need to download full file and extract chunk
    // This is a fallback - not ideal but works
    if (response.status === 200 || response.status === 416) {
      console.warn(`[downloadFileRange] Range not supported, downloading full file for chunk ${start}-${end}`);
      // We'll handle this in the caller
      throw new Error('RANGE_NOT_SUPPORTED');
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to download range: ${response.status} ${response.statusText} - ${errorText}`);
  } catch (error) {
    if (error instanceof Error && error.message === 'RANGE_NOT_SUPPORTED') {
      throw error; // Re-throw to handle in caller
    }
    throw error;
  }
}

/**
 * Stream download file in chunks and process each chunk
 * This avoids loading entire file into memory
 * Falls back to sequential download if Range requests not supported
 */
export async function streamDownloadFile(
  botToken: string,
  fileId: string,
  fileSize: number,
  chunkSize: number,
  onChunk: (chunkIndex: number, chunkData: ArrayBuffer, start: number, end: number) => Promise<void>
): Promise<void> {
  // First, get file path with retry
  let getFileData: any = null;
  let filePath: string | null = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const getFileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
      getFileData = await getFileResponse.json();
      
      if (getFileData.ok && getFileData.result?.file_path) {
        filePath = getFileData.result.file_path;
        break;
      }
      
      // If we get an error response, log it
      if (!getFileData.ok) {
        console.warn(`[streamDownload] getFile attempt ${attempt} failed:`, getFileData);
        if (attempt < 3) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    } catch (error) {
      console.error(`[streamDownload] getFile attempt ${attempt} error:`, error);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  if (!filePath) {
    // Provide detailed error message
    const errorDetails = getFileData 
      ? `Telegram API error: ${JSON.stringify(getFileData)}`
      : 'Failed to get file path from Telegram (network error or file not accessible)';
    throw new Error(errorDetails);
  }
  const totalChunks = Math.ceil(fileSize / chunkSize);
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  // Test if Range requests are supported
  let rangeSupported = false;
  try {
    const testResponse = await fetch(url, {
      headers: { 'Range': 'bytes=0-1023' }, // Test with first 1KB
    });
    rangeSupported = testResponse.status === 206;
    console.log(`[streamDownload] Range requests ${rangeSupported ? 'supported' : 'NOT supported'}`);
  } catch (e) {
    console.warn('[streamDownload] Could not test Range support:', e);
  }

  if (rangeSupported) {
    // Use Range requests - download chunks in parallel
    const CONCURRENCY_LIMIT = 3; // Download 3 chunks at a time
    const downloadPromises: Promise<void>[] = [];

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize - 1, fileSize - 1);

      const downloadChunk = async () => {
        try {
          const chunkData = await downloadFileRange(botToken, filePath, start, end, fileSize);
          await onChunk(chunkIndex, chunkData, start, end);
        } catch (error) {
          console.error(`[streamDownload] Failed to download/process chunk ${chunkIndex}:`, error);
          throw error;
        }
      };

      downloadPromises.push(downloadChunk());

      if (downloadPromises.length >= CONCURRENCY_LIMIT) {
        await Promise.all(downloadPromises);
        downloadPromises.length = 0;
      }
    }

    if (downloadPromises.length > 0) {
      await Promise.all(downloadPromises);
    }
  } else {
    // Fallback: Download full file and process in chunks
    // This uses more memory but works when Range is not supported
    console.log(`[streamDownload] Range not supported, downloading full file (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const fullFileData = await response.arrayBuffer();
    const fileArray = new Uint8Array(fullFileData);

    // Process chunks sequentially to avoid memory issues
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, fileArray.length);
      const chunkData = fileArray.slice(start, end);

      await onChunk(chunkIndex, chunkData.buffer, start, end - 1);
    }
  }
}
