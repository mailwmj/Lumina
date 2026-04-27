import { invoke, isTauri } from '@tauri-apps/api/core';

function ensureTauriRuntime() {
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 环境，请使用 `npm run tauri dev` 启动');
  }
}

export async function convertVideoToMp4(sourcePath: string, projectId: string): Promise<string> {
  ensureTauriRuntime();
  return await invoke('convert_video_to_mp4', { sourcePath, projectId });
}

export async function convertAudioToMp3(sourcePath: string, projectId: string): Promise<string> {
  ensureTauriRuntime();
  return await invoke('convert_audio_to_mp3', { sourcePath, projectId });
}
