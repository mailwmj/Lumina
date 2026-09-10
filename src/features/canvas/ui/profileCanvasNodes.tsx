import { Profiler, type ProfilerOnRenderCallback } from 'react';
import type { NodeTypes } from '@xyflow/react';
import { recordCanvasNodeRender } from '../application/canvasPerformance';

/** Stable wrappers created once at registration; records React render work, not wall time between commits. */
export function profileCanvasNodes(types: NodeTypes): NodeTypes {
  if (!import.meta.env.DEV) return types;
  return Object.fromEntries(Object.entries(types).map(([type, Component]) => {
    const onRender: ProfilerOnRenderCallback = (id, _phase, duration) => {
      recordCanvasNodeRender(type, duration, id);
    };
    const ProfiledNode: typeof Component = (props) => (
      <Profiler id={props.id} onRender={onRender}><Component {...props} /></Profiler>
    );
    ProfiledNode.displayName = `Profiled(${type})`;
    return [type, ProfiledNode];
  }));
}
