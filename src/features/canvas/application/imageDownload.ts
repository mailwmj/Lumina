import { save } from '@tauri-apps/plugin-dialog';
import { dirname, downloadDir, join } from '@tauri-apps/api/path';
import { saveImageSourceToDirectory, saveImageSourceToPath } from '@/commands/image';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger } from '@/lib/logger';
import { resolveImageFileExtension, resolveImageFileName, resolveImageFileStem } from './imageMetadata';
import { resolveImageCommandSource } from './imageCommandSource';

export async function downloadImage(source: string, options: { nodeId?: string; targetDir?: string } = {}): Promise<'saved' | 'cancelled' | 'failed'> {
  const resolved = resolveImageCommandSource(source);
  if (!resolved) return 'failed';
  const settings = useSettingsStore.getState();
  const fileName = resolveImageFileName(resolved, options.nodeId ? `node-${options.nodeId}` : 'image.png');
  try {
    if (options.targetDir) {
      await saveImageSourceToDirectory(resolved, options.targetDir, resolveImageFileStem(fileName));
      settings.setLastDownloadDirectory(options.targetDir);
    } else {
      const extension = resolveImageFileExtension(fileName);
      const selectedPath = await save({
        defaultPath: await join(settings.lastDownloadDirectory || await downloadDir(), fileName),
        filters: [{ name: 'Image', extensions: extension ? [extension] : ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (!selectedPath || Array.isArray(selectedPath)) return 'cancelled';
      await saveImageSourceToPath(resolved, selectedPath);
      settings.setLastDownloadDirectory(await dirname(selectedPath));
    }
    return 'saved';
  } catch (error) { logger.error('Failed to download image', error); return 'failed'; }
}
