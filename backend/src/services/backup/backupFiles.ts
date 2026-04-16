import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { prisma } from '../../db';
import { getInstanceSettings } from '../instanceSettingsService';
import logger from '../../utils/logger';

/**
 * Archive upload directories
 */
export async function archiveUploads(outputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const uploadsDir = path.join(__dirname, '../../../uploads');

    if (!fs.existsSync(uploadsDir)) {
      logger.warn({ operation: 'backup_files_missing', message: 'Uploads directory not found' });
      // Create empty archive
      const archive = archiver('tar', { gzip: true });
      const output = fs.createWriteStream(outputPath);

      archive.pipe(output);
      archive.finalize();

      output.on('close', () => resolve(0));
      output.on('error', reject);
      return;
    }

    const archive = archiver('tar', { gzip: true });
    const output = fs.createWriteStream(outputPath);

    archive.pipe(output);

    // Add all upload directories
    const dirs = ['receipts', 'emails', 'training'];
    dirs.forEach((dir) => {
      const dirPath = path.join(uploadsDir, dir);
      if (fs.existsSync(dirPath)) {
        archive.directory(dirPath, `uploads/${dir}`);
      }
    });

    archive.on('error', (err: Error) => {
      logger.error({
        operation: 'backup_files_error',
        message: 'File archive creation failed',
        error: err.message,
      });
      reject(err);
    });

    output.on('close', () => {
      resolve(archive.pointer());
    });

    archive.finalize();
  });
}

/**
 * Get metadata about current database state
 */
export async function getMetadata(): Promise<Record<string, string | number>> {
  const [userCount, flightCount, airportCount, achievementCount] = await Promise.all([
    prisma.user.count(),
    prisma.flight.count(),
    prisma.airport.count(),
    prisma.achievement.count(),
  ]);

  const { instanceName } = await getInstanceSettings();

  return {
    userCount,
    flightCount,
    airportCount,
    achievementCount,
    timestamp: new Date().toISOString(),
    instanceName,
  };
}
