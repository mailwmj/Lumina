import { beforeEach, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';
import { downloadImage } from './imageDownload';
const mocks = vi.hoisted(() => ({ save: vi.fn(), toPath: vi.fn(), toDirectory: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/api/path', () => ({ dirname: async () => '/chosen', downloadDir: async () => '/downloads', join: async (...parts: string[]) => parts.join('/') }));
vi.mock('@/commands/image', async (original) => ({ ...await original<typeof import('@/commands/image')>(), saveImageSourceToPath: mocks.toPath, saveImageSourceToDirectory: mocks.toDirectory }));
beforeEach(() => { vi.clearAllMocks(); useSettingsStore.setState({ lastDownloadDirectory: '' }); });
it('shares original-image save-as behavior and remembers the selected directory', async () => {
  mocks.save.mockResolvedValue('/chosen/image.png');
  expect(await downloadImage('asset://localhost/%2Fhome%2Fimage.png')).toBe('saved');
  expect(mocks.toPath).toHaveBeenCalledWith('/home/image.png', '/chosen/image.png');
  expect(useSettingsStore.getState().lastDownloadDirectory).toBe('/chosen');
});
it('shares preset directory saves and leaves cancelled dialogs alone', async () => {
  expect(await downloadImage('/home/image.png', { targetDir: '/preset' })).toBe('saved');
  expect(mocks.toDirectory).toHaveBeenCalledWith('/home/image.png', '/preset', 'image');
  mocks.save.mockResolvedValue(null);
  expect(await downloadImage('/home/image.png')).toBe('cancelled'); expect(mocks.toPath).not.toHaveBeenCalled();
});
