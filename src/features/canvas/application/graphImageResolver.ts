import {
  CANVAS_NODE_TYPES,
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
  type CanvasEdge,
  type CanvasWorkflowNode,
} from '../domain/canvasNodes';
import type { GraphImageResolver } from './ports';

export class DefaultGraphImageResolver implements GraphImageResolver {
  collectInputImages(
    nodeId: string,
    nodes: readonly CanvasWorkflowNode[],
    edges: readonly CanvasEdge[]
  ): string[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const targetNode = nodes.find((n) => n.id === nodeId);
    const isVideoFrame = targetNode?.type === CANVAS_NODE_TYPES.videoFrame;

    // Collect edges targeting this node with their handle IDs
    const targetEdges = edges.filter((edge) => edge.target === nodeId);

    if (isVideoFrame) {
      // 对于首尾帧节点，按 handle 分开收集图片
      // target-first 对应首帧，target-last 对应尾帧
      const firstFrameEdge = targetEdges.find((e) => e.targetHandle === 'target-first');
      const lastFrameEdge = targetEdges.find((e) => e.targetHandle === 'target-last');

      const firstImage = firstFrameEdge
        ? this.extractFirstImage(nodeById.get(firstFrameEdge.source))
        : null;
      const lastImage = lastFrameEdge
        ? this.extractFirstImage(nodeById.get(lastFrameEdge.source))
        : null;

      // 返回 [首帧, 尾帧] 的顺序
      return [firstImage, lastImage].filter((img): img is string => img !== null);
    } else {
      // 普通节点：收集所有输入图片
      const images: string[] = [];
      for (const edge of targetEdges) {
        const sourceNode = nodeById.get(edge.source);
        if (sourceNode) {
          const nodeImages = this.extractImages(sourceNode);
          images.push(...nodeImages);
        }
      }
      return [...new Set(images)];
    }
  }

  /**
   * 只提取第一张图片（用于视频节点每个 handle 只取一张图）
   */
  private extractFirstImage(node: CanvasWorkflowNode | undefined): string | null {
    if (!node) {
      return null;
    }

    if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) {
      const imgUrl = node.data.referenceImageUrl || node.data.imageUrl || null;
      return imgUrl;
    }

    return null;
  }

  private extractImages(node: CanvasWorkflowNode | undefined): string[] {
    if (!node) {
      return [];
    }

    if (isUploadNode(node) || isImageEditNode(node) || isExportImageNode(node)) {
      const imageUrl = node.data.referenceImageUrl || node.data.imageUrl;
      return imageUrl ? [imageUrl] : [];
    }

    return [];
  }
}
