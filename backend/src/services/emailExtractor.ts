import MsgReader from '@kenjiuno/msgreader';
import { parse as parseHtml } from 'node-html-parser';
import logger from '../utils/logger';

/**
 * Email Extractor Service
 *
 * Extracts subject and body text from email files (.msg, .eml, .txt)
 * Uses @kenjiuno/msgreader for .msg files (binary Outlook format)
 */

export interface ExtractedEmail {
  subject: string;
  text: string;
  html?: string;
}

/**
 * Extract email content from .msg file (Microsoft Outlook binary format)
 */
function extractFromMsg(buffer: Buffer): ExtractedEmail {
  try {
    // Convert Buffer to ArrayBuffer for MsgReader
    // MsgReader accepts Buffer in runtime but TypeScript types expect ArrayBuffer
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const msgReader = new MsgReader(arrayBuffer as ArrayBuffer);
    const fileData = msgReader.getFileData();

    if (!fileData) {
      throw new Error('Failed to read .msg file structure');
    }

    const subject = fileData.subject || '';
    const body = fileData.body || '';
    const bodyHtml = fileData.bodyHtml || undefined;

    logger.debug({
      subject,
      bodyLength: body.length,
      hasHtml: !!bodyHtml,
    }, '[Email Extractor] Extracted .msg file');

    return {
      subject,
      text: body,
      html: bodyHtml,
    };
  } catch (error) {
    logger.error({ error }, '[Email Extractor] Failed to extract .msg file');
    throw new Error(`Failed to parse .msg file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract email content from .eml file (RFC 822 format)
 */
function extractFromEml(content: string): ExtractedEmail {
  try {
    // Simple EML parser - extract subject and body
    const lines = content.split('\n');
    let subject = '';
    let bodyStartIndex = 0;
    let inHeaders = true;

    // Parse headers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (inHeaders) {
        if (line.trim() === '') {
          // End of headers
          inHeaders = false;
          bodyStartIndex = i + 1;
          break;
        }

        if (line.toLowerCase().startsWith('subject:')) {
          subject = line.substring(8).trim();
        }
      }
    }

    // Extract body (everything after headers)
    const body = lines.slice(bodyStartIndex).join('\n').trim();

    // Try to extract HTML if present (simple approach)
    const htmlMatch = body.match(/<html[\s\S]*?<\/html>/i);
    const html = htmlMatch ? htmlMatch[0] : undefined;

    // If HTML found, try to extract plain text from it
    let text = body;
    if (html) {
      try {
        const root = parseHtml(html);
        text = root.textContent || body;
      } catch (htmlError) {
        // If HTML parsing fails, use raw body
        text = body;
      }
    }

    logger.debug({
      subject,
      bodyLength: text.length,
      hasHtml: !!html,
    }, '[Email Extractor] Extracted .eml file');

    return {
      subject,
      text,
      html,
    };
  } catch (error) {
    logger.error({ error }, '[Email Extractor] Failed to extract .eml file');
    throw new Error(`Failed to parse .eml file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract email content from plain text file
 */
function extractFromText(content: string): ExtractedEmail {
  logger.debug({
    bodyLength: content.length,
  }, '[Email Extractor] Extracted .txt file');

  return {
    subject: '',
    text: content.trim(),
  };
}

/**
 * Extract email content from file
 *
 * @param file - File buffer or string content
 * @param filename - Original filename (used to determine file type)
 * @returns Extracted email content (subject, text, html)
 */
export function extractEmailFromFile(file: Buffer | string, filename: string): ExtractedEmail {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf('.'));

  logger.info({
    filename,
    extension,
    isBuffer: Buffer.isBuffer(file),
    size: Buffer.isBuffer(file) ? file.length : file.length,
  }, '[Email Extractor] Extracting email from file');

  switch (extension) {
    case '.msg':
      if (!Buffer.isBuffer(file)) {
        throw new Error('.msg files must be provided as Buffer (binary)');
      }
      return extractFromMsg(file);

    case '.eml':
      const emlContent = Buffer.isBuffer(file) ? file.toString('utf-8') : file;
      return extractFromEml(emlContent);

    case '.txt':
      const txtContent = Buffer.isBuffer(file) ? file.toString('utf-8') : file;
      return extractFromText(txtContent);

    default:
      throw new Error(`Unsupported email file type: ${extension}. Supported: .msg, .eml, .txt`);
  }
}
