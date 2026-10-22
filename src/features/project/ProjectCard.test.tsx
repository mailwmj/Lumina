// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProjectCard } from './ProjectCard';
import i18n from '@/i18n';

it('renders a lazy project thumbnail and retains its fixed frame after a load failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await i18n.changeLanguage('en');
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const project = { id: 'project', name: 'A project', createdAt: 1, updatedAt: 2, nodeCount: 1, thumbnailUrl: 'https://example.test/preview.jpg' };
  const render = async (thumbnailUrl: string | null) => act(async () => root.render(<ProjectCard project={{ ...project, thumbnailUrl }} disabled={false} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />));
  try {
    await render(project.thumbnailUrl);
    const image = container.querySelector('img')!;
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.alt).toBe(project.name);
    expect(image.classList.contains('object-cover')).toBe(true);
    const frame = image.parentElement!;
    expect(frame.classList.contains('aspect-video')).toBe(true);
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.contains(frame)).toBe(true);
    expect(frame.querySelector('svg')).not.toBeNull();
    await render('https://example.test/replacement.jpg');
    expect(container.querySelector('img')?.src).toContain('replacement.jpg');
    await render(null);
    expect(container.querySelector('img')).toBeNull();
    expect(frame.classList.contains('aspect-video')).toBe(true);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
