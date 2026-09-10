import {
  clamp, sanitizePathSegment, sanitizeExportLabel, toCssAspectRatio, resolveExportOptions,
  applyStoryboardTextOverlay, type IncomingImageItem, type PanelAnchor,
} from '../application/storyboardPresentation';
import { CanvasHandle as Handle } from '../ui/CanvasHandle';
import { VirtualStoryboardGrid } from '../ui/VirtualStoryboardGrid';
import { StoryboardFrameCard } from '../ui/StoryboardFrameCard';
import {
  memo,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { Download, FolderOpen, SlidersHorizontal } from '@/components/ui/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { join } from '@tauri-apps/api/path';

import {
  embedStoryboardImageMetadata,
  mergeStoryboardImages,
  saveImageSourceToDirectory,
} from '@/commands/image';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { resolveNodeSurfaceStateClass } from '@/features/canvas/ui/nodeSurfaceStyles';
import { measureCanvasPhase } from '@/features/canvas/application/canvasPerformance';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import type {
  StoryboardExportOptions,
  StoryboardFrameItem,
  StoryboardSplitNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
} from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import {
  loadImageElement,
  prepareNodeImage,
  persistImageLocally,
  reduceAspectRatio,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import { UiButton, UiCheckbox, UiChipButton, UiInput, UiPanel, UiSelect } from '@/components/ui';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger } from '@/lib/logger';
import { createNodeInputGraphSelector } from '@/features/canvas/application/canvasNodeSelectors';

type StoryboardNodeProps = NodeProps & {
  id: string;
  data: StoryboardSplitNodeData;
  selected?: boolean;
};

const STORYBOARD_NODE_WIDTH_PX = 318;
const STORYBOARD_NODE_MIN_HEIGHT_PX = 320;
const STORYBOARD_GRID_GAP_PX = 1;
const EXPORT_MAX_DIMENSION = 4096;
const EXPORT_TRACE_PREFIX = '[StoryboardExport]';

export const StoryboardNode = memo(({ id, data, selected, width, height }: StoryboardNodeProps) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerMenuRef = useRef<HTMLDivElement>(null);
  const exportSettingsTriggerRef = useRef<HTMLDivElement>(null);
  const exportSettingsPanelRef = useRef<HTMLDivElement>(null);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const inputGraphSelector = useMemo(() => createNodeInputGraphSelector(id), [id]);
  const inputGraph = useCanvasStore(inputGraphSelector);
  const workflowNodes = inputGraph.workflowNodes;
  const edges = inputGraph.edges;
  const reorderStoryboardFrame = useCanvasStore((state) => state.reorderStoryboardFrame);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const updateStoryboardFrame = useCanvasStore((state) => state.updateStoryboardFrame);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const currentProjectName = useProjectStore((state) => state.currentProject?.name);
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);

  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null);
  const [dropTargetFrameId, setDropTargetFrameId] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<{ frameId: string; x: number; y: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isPackingSingleImages, setIsPackingSingleImages] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [isExportPanelVisible, setIsExportPanelVisible] = useState(false);
  const [exportPanelAnchor, setExportPanelAnchor] = useState<PanelAnchor | null>(null);
  const [isPackDoneDialogOpen, setIsPackDoneDialogOpen] = useState(false);
  const [packOutputDir, setPackOutputDir] = useState<string>('');
  const [packRevealFilePath, setPackRevealFilePath] = useState<string>('');

  const orderedFrames = useMemo(
    () => measureCanvasPhase('storyboard-frame-sort', () =>
      [...data.frames].sort((a, b) => a.order - b.order)
    ),
    [data.frames]
  );

  const frameAspectRatio = useMemo(() => {
    return (
      data.frameAspectRatio ??
      orderedFrames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio ??
      '1:1'
    );
  }, [data.frameAspectRatio, orderedFrames]);

  const frameAspectRatioCss = useMemo(
    () => toCssAspectRatio(frameAspectRatio),
    [frameAspectRatio]
  );

  const gridCols = Math.max(1, data.gridCols);
  const gridRows = Math.max(1, data.gridRows);
  const totalFrames = orderedFrames.length;
  const resolvedNodeWidth = Math.max(STORYBOARD_NODE_WIDTH_PX, Math.round(width ?? STORYBOARD_NODE_WIDTH_PX));
  const resolvedNodeHeight = Math.max(
    STORYBOARD_NODE_MIN_HEIGHT_PX,
    Math.round(height ?? STORYBOARD_NODE_MIN_HEIGHT_PX)
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedNodeHeight, resolvedNodeWidth, updateNodeInternals]);

  const exportOptions = useMemo(
    () => resolveExportOptions(data.exportOptions),
    [data.exportOptions]
  );

  const incomingImageRefs = useMemo(() => {
    const nodeById = new Map(workflowNodes.map((node) => [node.id, node] as const));
    const sourceNodeIds = edges
      .filter((edge) => edge.target === id)
      .map((edge) => edge.source);

    const dedupedByImageUrl = new Map<string, {
      imageUrl: string;
      previewImageUrl: string | null;
      referenceImageUrl: string | null;
    }>();
    for (const sourceNodeId of sourceNodeIds) {
      const sourceNode = nodeById.get(sourceNodeId);
      if (!sourceNode) {
        continue;
      }
      if (!isUploadNode(sourceNode) && !isImageEditNode(sourceNode) && !isExportImageNode(sourceNode)) {
        continue;
      }
      const imageUrl = sourceNode.data.imageUrl;
      if (!imageUrl) {
        continue;
      }
      if (!dedupedByImageUrl.has(imageUrl)) {
        dedupedByImageUrl.set(imageUrl, {
          imageUrl,
          previewImageUrl: sourceNode.data.previewImageUrl ?? null,
          referenceImageUrl: sourceNode.data.referenceImageUrl ?? null,
        });
      }
    }

    return Array.from(dedupedByImageUrl.values());
  }, [edges, id, workflowNodes]);

  const incomingImageItems = useMemo<IncomingImageItem[]>(
    () =>
      incomingImageRefs.map((item, index) => ({
        imageUrl: item.imageUrl,
        previewImageUrl: item.previewImageUrl,
        referenceImageUrl: item.referenceImageUrl,
        displayUrl: resolveImageDisplayUrl(item.previewImageUrl || item.imageUrl),
        label: `图${index + 1}`,
      })),
    [incomingImageRefs]
  );
  const frameViewerImageList = useMemo(
    () =>
      orderedFrames
        .map((frame) => {
          const source = frame.imageUrl || frame.previewImageUrl;
          return source ? resolveImageDisplayUrl(source) : null;
        })
        .filter((item): item is string => Boolean(item)),
    [orderedFrames]
  );
  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current) {
        return;
      }

      const target = event.target as Node;
      const insideRoot = rootRef.current.contains(target);
      const insidePickerMenu = pickerMenuRef.current?.contains(target) ?? false;
      const insideExportPanel = exportSettingsPanelRef.current?.contains(target) ?? false;
      const insideExportTrigger = exportSettingsTriggerRef.current?.contains(target) ?? false;

      if (!insideRoot && !insidePickerMenu) {
        setPickerState(null);
      }

      if (!insideExportPanel && !insideExportTrigger) {
        setIsExportPanelOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, []);

  useEffect(() => {
    if (!isExportPanelOpen) {
      setIsExportPanelVisible(false);
      return;
    }

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setIsExportPanelVisible(true);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) {
        cancelAnimationFrame(raf2);
      }
    };
  }, [isExportPanelOpen]);

  const getPanelAnchor = useCallback((triggerElement: HTMLDivElement | null): PanelAnchor | null => {
    if (!triggerElement) {
      return null;
    }
    const rect = triggerElement.getBoundingClientRect();
    return {
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    };
  }, []);

  const patchExportOptions = useCallback(
    (patch: Partial<StoryboardExportOptions>) => {
      updateNodeData(id, {
        exportOptions: {
          ...exportOptions,
          ...patch,
        },
      });
    },
    [exportOptions, id, updateNodeData]
  );

  const handleSortStart = useCallback((frameId: string) => {
    setDraggedFrameId(frameId);
    setDropTargetFrameId(frameId);
    setPickerState(null);
  }, []);

  const handleSortHover = useCallback(
    (frameId: string) => {
      if (!draggedFrameId) {
        return;
      }
      setDropTargetFrameId(frameId);
    },
    [draggedFrameId]
  );

  const finalizeSort = useCallback(() => {
    if (!draggedFrameId) {
      return;
    }

    if (dropTargetFrameId && dropTargetFrameId !== draggedFrameId) {
      reorderStoryboardFrame(id, draggedFrameId, dropTargetFrameId);
    }

    setDraggedFrameId(null);
    setDropTargetFrameId(null);
  }, [draggedFrameId, dropTargetFrameId, id, reorderStoryboardFrame]);

  useEffect(() => {
    if (!draggedFrameId) {
      return;
    }

    const handlePointerUp = () => {
      finalizeSort();
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    window.addEventListener('pointerup', handlePointerUp);
    const cancelSort = () => { setDraggedFrameId(null); setDropTargetFrameId(null); };
    window.addEventListener('pointercancel', cancelSort);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', cancelSort);
    };
  }, [draggedFrameId, finalizeSort]);

  const handleEditFrame = useCallback(
    async (frame: StoryboardFrameItem) => {
      try {
        const sourceImage = frame.imageUrl ?? frame.previewImageUrl;
        if (!sourceImage) {
          setExportError('该分镜没有可编辑图片');
          return;
        }
        const frameIndex = orderedFrames.findIndex((item) => item.id === frame.id);
        const frameTitle = frameIndex >= 0
          ? `分镜 ${frameIndex + 1}`
          : EXPORT_RESULT_DISPLAY_NAME.storyboardFrameEdit;

        const prepared = await prepareNodeImage(sourceImage);
        const createdNodeId = addDerivedExportNode(
          id,
          prepared.imageUrl,
          prepared.aspectRatio,
          prepared.previewImageUrl,
          {
            referenceImageUrl: prepared.referenceImageUrl,
            defaultTitle: frameTitle,
            resultKind: 'storyboardFrameEdit',
          }
        );

        if (createdNodeId) {
          addEdge(id, createdNodeId);
        }
      } catch (error) {
        setExportError(error instanceof Error ? error.message : '创建编辑节点失败');
      }
    },
    [addDerivedExportNode, addEdge, id, orderedFrames]
  );

  const handleExport = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const traceId = `${id}-${Date.now()}`;
    const traceStart = performance.now();
    logger.info(`${EXPORT_TRACE_PREFIX} start`, {
      traceId,
      nodeId: id,
      rows: gridRows,
      cols: gridCols,
      frameCount: orderedFrames.length,
    });

    setIsExporting(true);
    setExportError(null);

    try {
      const stageFrameStart = performance.now();
      const frameSources = orderedFrames.map(
        (frame) => frame.imageUrl ?? frame.previewImageUrl ?? ''
      );
      if (frameSources.every((source) => !source)) {
        throw new Error('没有可导出的图片');
      }
      logger.info(`${EXPORT_TRACE_PREFIX} frame-sources-ready`, {
        traceId,
        elapsedMs: Math.round(performance.now() - stageFrameStart),
        nonEmptyFrames: frameSources.filter((source) => source.length > 0).length,
      });

      const options = exportOptions;
      const rawGap = clamp(Math.round(options.cellGap), 0, 120);
      const rawPadding = 0;
      const fontPercent = clamp(Number.isFinite(options.fontSize) ? options.fontSize : 4, 1, 20);
      const firstFrameSource = frameSources.find((source) => source.length > 0) ?? null;
      let referenceFrameHeight = 1024;
      if (firstFrameSource) {
        const fontProbeStart = performance.now();
        try {
          const referenceImage = await loadImageElement(firstFrameSource);
          referenceFrameHeight = Math.max(
            64,
            referenceImage.naturalHeight || referenceImage.height || referenceFrameHeight
          );
        } catch {
          // Keep fallback size when reference frame cannot be read.
        }
        logger.info(`${EXPORT_TRACE_PREFIX} font-reference-resolved`, {
          traceId,
          elapsedMs: Math.round(performance.now() - fontProbeStart),
          referenceFrameHeight,
        });
      }
      const rawFontSize = clamp(
        Math.round(referenceFrameHeight * (fontPercent / 100)),
        10,
        240
      );
      const rawNoteHeight =
        options.showFrameNote && options.notePlacement === 'bottom'
          ? Math.max(Math.round(rawFontSize * 1.7), 24)
          : 0;

      const mergeStart = performance.now();
      const projectId = useProjectStore.getState().getCurrentProject()?.id;
      const mergeResult = await mergeStoryboardImages({
        frameSources,
        rows: gridRows,
        cols: gridCols,
        cellGap: rawGap,
        outerPadding: rawPadding,
        noteHeight: rawNoteHeight,
        fontSize: rawFontSize,
        backgroundColor: options.backgroundColor,
        maxDimension: EXPORT_MAX_DIMENSION,
        showFrameIndex: options.showFrameIndex,
        showFrameNote: options.showFrameNote,
        notePlacement: options.notePlacement,
        imageFit: options.imageFit,
        frameIndexPrefix: options.frameIndexPrefix,
        textColor: options.textColor,
        frameNotes: orderedFrames.map((frame) => frame.note ?? ''),
        projectId,
      });
      logger.info(`${EXPORT_TRACE_PREFIX} merge-done`, {
        traceId,
        elapsedMs: Math.round(performance.now() - mergeStart),
        canvasWidth: mergeResult.canvasWidth,
        canvasHeight: mergeResult.canvasHeight,
        textOverlayApplied: mergeResult.textOverlayApplied,
      });

      const aspectRatio = reduceAspectRatio(mergeResult.canvasWidth, mergeResult.canvasHeight);
      const needsOverlay = (options.showFrameIndex || options.showFrameNote) && !mergeResult.textOverlayApplied;
      let finalImagePath = mergeResult.imagePath;
      let finalPreviewPath = mergeResult.imagePath;

      if (needsOverlay) {
        const overlayStart = performance.now();
        const mergedBlob = await applyStoryboardTextOverlay(
          mergeResult.imagePath,
          orderedFrames,
          options,
          gridRows,
          gridCols,
          mergeResult
        );
        logger.info(`${EXPORT_TRACE_PREFIX} overlay-done`, {
          traceId,
          elapsedMs: Math.round(performance.now() - overlayStart),
          dataUrlLength: mergedBlob.length,
        });
        const persistStart = performance.now();
        finalImagePath = await persistImageLocally(mergedBlob);
        finalPreviewPath = finalImagePath;
        logger.info(`${EXPORT_TRACE_PREFIX} overlay-persisted`, {
          traceId,
          elapsedMs: Math.round(performance.now() - persistStart),
          persistedPath: finalImagePath,
        });
      }

      const metadataStart = performance.now();
      const metadataFrameNotes = orderedFrames.map((frame) => frame.note ?? '');
      const imagePathWithMetadata = await embedStoryboardImageMetadata(finalImagePath, {
        gridRows,
        gridCols,
        frameNotes: metadataFrameNotes,
      }).catch((error) => {
        logger.warn('[StoryboardMetadata] embed failed on storyboard export', error);
        return finalImagePath;
      });
      finalImagePath = imagePathWithMetadata;
      finalPreviewPath = imagePathWithMetadata;
      logger.info(`${EXPORT_TRACE_PREFIX} metadata-embedded`, {
        traceId,
        elapsedMs: Math.round(performance.now() - metadataStart),
        imagePath: finalImagePath,
      });

      const createNodeStart = performance.now();
      const createdNodeId = addDerivedExportNode(
        id,
        finalImagePath,
        aspectRatio,
        finalPreviewPath,
        {
          defaultTitle: EXPORT_RESULT_DISPLAY_NAME.storyboardSplitExport,
          resultKind: 'storyboardSplitExport',
        }
      );
      logger.info(`${EXPORT_TRACE_PREFIX} derived-node-created`, {
        traceId,
        elapsedMs: Math.round(performance.now() - createNodeStart),
        createdNodeId,
      });

      if (createdNodeId) {
        addEdge(id, createdNodeId);
      }
      logger.info(`${EXPORT_TRACE_PREFIX} done`, {
        traceId,
        totalElapsedMs: Math.round(performance.now() - traceStart),
      });
    } catch (error) {
      logger.error(`${EXPORT_TRACE_PREFIX} failed`, {
        traceId,
        elapsedMs: Math.round(performance.now() - traceStart),
        error,
      });
      setExportError(error instanceof Error ? error.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  }, [
    addDerivedExportNode,
    addEdge,
    exportOptions,
    gridCols,
    gridRows,
    id,
    isExporting,
    orderedFrames,
  ]);

  const resolvePackRootDir = useCallback(async (): Promise<string | null> => {
    const presetPath = downloadPresetPaths.find((path) => path.trim().length > 0)?.trim() ?? '';
    if (presetPath) {
      return presetPath;
    }

    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择分镜导出文件夹',
    });
    if (!selected || Array.isArray(selected)) {
      return null;
    }

    return selected;
  }, [downloadPresetPaths]);

  const handlePackSingleImages = useCallback(async () => {
    if (isExporting || isPackingSingleImages) {
      return;
    }

    setExportError(null);
    setIsPackingSingleImages(true);

    try {
      const frameEntries = orderedFrames
        .map((frame, index) => ({
          source: frame.imageUrl ?? frame.previewImageUrl ?? '',
          index,
          note: frame.note ?? '',
        }))
        .filter((item) => item.source.length > 0);

      if (frameEntries.length === 0) {
        throw new Error('该分镜没有可导出的图片');
      }

      const rootDir = await resolvePackRootDir();
      if (!rootDir) {
        return;
      }

      const normalizedProjectName = sanitizePathSegment(currentProjectName ?? '', '未命名项目');
      const outputDir = await join(rootDir, normalizedProjectName);
      const fileProjectName = sanitizeExportLabel(normalizedProjectName, 40) || '项目';
      let firstSavedFilePath = '';

      for (const item of frameEntries) {
        const frameNo = String(item.index + 1).padStart(2, '0');
        const noteLabel = sanitizeExportLabel(item.note, 60);
        const fileStem = noteLabel
          ? `${fileProjectName}_${frameNo}_${noteLabel}`
          : `${fileProjectName}_${frameNo}`;
        const savedPath = await saveImageSourceToDirectory(item.source, outputDir, fileStem);
        if (!firstSavedFilePath) {
          firstSavedFilePath = savedPath;
        }
      }

      setPackOutputDir(outputDir);
      setPackRevealFilePath(firstSavedFilePath);
      setIsPackDoneDialogOpen(true);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '打包下载失败');
    } finally {
      setIsPackingSingleImages(false);
    }
  }, [
    currentProjectName,
    isExporting,
    isPackingSingleImages,
    orderedFrames,
    resolvePackRootDir,
  ]);

  const handleOpenPackFolder = useCallback(async () => {
    if (!packRevealFilePath && !packOutputDir) {
      return;
    }
    try {
      if (packRevealFilePath) {
        await revealItemInDir(packRevealFilePath);
        return;
      }
      if (packOutputDir) {
        await openPath(packOutputDir);
      }
    } catch {
      try {
        if (packOutputDir) {
          await openPath(packOutputDir);
          return;
        }
      } catch (error) {
        setExportError(error instanceof Error ? error.message : '打开文件夹失败');
      }
    }
  }, [packOutputDir, packRevealFilePath]);

  const isAnyExporting = isExporting || isPackingSingleImages;

  const handleTogglePicker = useCallback((frameId: string, x: number, y: number) => {
    setPickerState((previous) => {
      if (previous?.frameId === frameId) {
        return null;
      }
      return { frameId, x, y };
    });
  }, []);

  const handleReplaceFromInput = useCallback(
    (frameId: string, imageUrl: string) => {
      setExportError(null);
      const matched = incomingImageItems.find((item) => item.imageUrl === imageUrl);
      updateStoryboardFrame(id, frameId, {
        imageUrl: matched?.imageUrl ?? imageUrl,
        previewImageUrl: matched?.previewImageUrl ?? matched?.imageUrl ?? imageUrl,
        referenceImageUrl: matched?.referenceImageUrl ?? matched?.imageUrl ?? imageUrl,
      });
      setPickerState(null);
    },
    [id, incomingImageItems, updateStoryboardFrame]
  );

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${resolveNodeSurfaceStateClass(selected)}
      `}
      style={{ width: `${resolvedNodeWidth}px`, height: `${resolvedNodeHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <VirtualStoryboardGrid
        count={orderedFrames.length} columns={gridCols} aspectRatio={frameAspectRatio}
        gap={STORYBOARD_GRID_GAP_PX}
        draggedIndex={orderedFrames.findIndex(frame => frame.id === draggedFrameId)}
        renderFrame={index => {
          const frame = orderedFrames[index];
          return <StoryboardFrameCard key={frame.id} nodeId={id} frame={frame} index={index}
            frameAspectRatioCss={frameAspectRatioCss} imageFit={exportOptions.imageFit}
            viewerImageList={frameViewerImageList}
            dragging={draggedFrameId === frame.id}
            asDropTarget={dropTargetFrameId === frame.id && draggedFrameId !== frame.id}
            onSortStart={handleSortStart} onSortHover={handleSortHover}
            onTogglePicker={handleTogglePicker} onEditFrame={handleEditFrame} />;
        }}
      />

      {pickerState && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={pickerMenuRef}
            className="nowheel fixed z-[140] w-[120px] overflow-hidden rounded-[10px] border border-[var(--ui-border-soft)] bg-[var(--ui-surface-elevated)] shadow-[var(--ui-shadow-panel)]"
            style={{ left: `${pickerState.x}px`, top: `${pickerState.y}px` }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            {incomingImageItems.length > 0 ? (
              <div
                className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
                onWheelCapture={(event) => event.stopPropagation()}
              >
                {incomingImageItems.map((item) => (
                  <button
                    key={`${pickerState.frameId}-${item.imageUrl}`}
                    type="button"
                    className="flex w-full items-center gap-2 border border-transparent bg-transparent px-2 py-2 text-left text-sm text-text-dark transition-colors hover:bg-[var(--ui-hover)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleReplaceFromInput(pickerState.frameId, item.imageUrl);
                    }}
                    title={item.label}
                  >
                    <CanvasNodeImage
                      src={item.displayUrl}
                      alt={item.label}
                      viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                      viewerImageList={incomingImageViewerList}
                      className="h-8 w-8 rounded object-cover"
                      draggable={false}
                      showResolutionPreview={false}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-2 py-2 text-sm text-text-muted">
                暂无输入图片
              </div>
            )}
          </div>,
          document.body
        )
        : null}

      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div ref={exportSettingsTriggerRef} className="nodrag relative flex">
            <UiChipButton
              active={isExportPanelOpen}
              className={NODE_CONTROL_CHIP_CLASS}
              onClick={(event) => {
                event.stopPropagation();
                if (isExportPanelOpen) {
                  setIsExportPanelOpen(false);
                  return;
                }
                setExportPanelAnchor(getPanelAnchor(exportSettingsTriggerRef.current));
                setIsExportPanelOpen(true);
              }}
            >
              <SlidersHorizontal className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
              <span>导出设置</span>
            </UiChipButton>
          </div>

          <div className="truncate text-[11px] text-text-muted/80">
            {gridRows} x {gridCols} | {totalFrames} 格
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <UiButton
            size="sm"
            variant="muted"
            className={`nodrag ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              void handlePackSingleImages();
            }}
            disabled={isAnyExporting}
          >
            <FolderOpen className={NODE_CONTROL_ICON_CLASS} />
            {isPackingSingleImages ? '打包中...' : '打包下载'}
          </UiButton>
          <UiButton
            size="sm"
            variant="primary"
            className={`nodrag ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              void handleExport();
            }}
            disabled={isAnyExporting}
          >
            <Download className={NODE_CONTROL_ICON_CLASS} />
            {isExporting ? '导出中...' : '合并分镜'}
          </UiButton>
        </div>
      </div>

      {typeof document !== 'undefined' && isExportPanelOpen && createPortal(
        <div
          ref={exportSettingsPanelRef}
          className={`fixed z-[120] w-[340px] transition-opacity duration-200 ease-out ${isExportPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={exportPanelAnchor
            ? {
              left: exportPanelAnchor.left,
              top: exportPanelAnchor.top,
              transform: 'translateX(-50%) translateY(-100%)',
            }
            : undefined}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <UiPanel className="p-2.5">
            <div className="space-y-2 text-xs text-text-muted">
              <label className="flex items-center gap-2">
                <UiCheckbox
                  aria-label="显示分镜序号"
                  checked={exportOptions.showFrameIndex}
                  onCheckedChange={(checked) => patchExportOptions({ showFrameIndex: checked })}
                />
                显示分镜序号
              </label>

              <label className="flex items-center gap-2">
                <UiCheckbox
                  aria-label="显示分镜描述"
                  checked={exportOptions.showFrameNote}
                  onCheckedChange={(checked) => patchExportOptions({ showFrameNote: checked })}
                />
                显示分镜描述
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1">图片填充</div>
                  <UiSelect
                    value={exportOptions.imageFit}
                    onChange={(event) =>
                      patchExportOptions({
                        imageFit: event.target.value === 'contain' ? 'contain' : 'cover',
                      })
                    }
                  >
                    <option value="cover">填充满格子</option>
                    <option value="contain">完整显示</option>
                  </UiSelect>
                </div>
                <div>
                  <div className="mb-1">序号前缀</div>
                  <UiInput
                    value={exportOptions.frameIndexPrefix}
                    maxLength={4}
                    className="h-8"
                    onChange={(event) => patchExportOptions({ frameIndexPrefix: event.target.value })}
                  />
                </div>
                <div>
                  <div className="mb-1">描述位置</div>
                  <UiSelect
                    value={exportOptions.notePlacement}
                    onChange={(event) =>
                      patchExportOptions({
                        notePlacement: event.target.value === 'bottom' ? 'bottom' : 'overlay',
                      })
                    }
                  >
                    <option value="overlay">图上遮罩</option>
                    <option value="bottom">图下文字</option>
                  </UiSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1">间距</div>
                  <UiInput
                    type="number"
                    min={0}
                    max={120}
                    value={exportOptions.cellGap}
                    className="h-8"
                    onChange={(event) =>
                      patchExportOptions({ cellGap: Number(event.target.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1">字号(%)</div>
                  <UiInput
                    type="number"
                    min={1}
                    max={20}
                    value={exportOptions.fontSize}
                    className="h-8"
                    onChange={(event) =>
                      patchExportOptions({ fontSize: Number(event.target.value) || 4 })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2">
                  <span>背景</span>
                  <input
                    type="color"
                    value={exportOptions.backgroundColor}
                    onChange={(event) => patchExportOptions({ backgroundColor: event.target.value })}
                    className="h-7 w-full rounded border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>文字</span>
                  <input
                    type="color"
                    value={exportOptions.textColor}
                    onChange={(event) => patchExportOptions({ textColor: event.target.value })}
                    className="h-7 w-full rounded border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)]"
                  />
                </label>
              </div>
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {exportError && <div className="mt-2 shrink-0 text-xs text-red-400">{exportError}</div>}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
      />
      <NodeResizeHandle
        minWidth={STORYBOARD_NODE_WIDTH_PX}
        minHeight={STORYBOARD_NODE_MIN_HEIGHT_PX}
        maxWidth={1800}
        maxHeight={1600}
      />

      {typeof document !== 'undefined' && isPackDoneDialogOpen
        ? createPortal(
          <div className="fixed inset-0 z-[220] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/55" />
            <UiPanel className="relative w-[440px] p-4">
              <div className="text-sm font-medium text-text-dark">导出完成</div>
              <div className="mt-2 text-xs text-text-muted">图片已导出到以下路径：</div>
              <div className="mt-1 break-all rounded border border-[var(--ui-border-soft)] bg-[var(--ui-surface-field)] px-2 py-1.5 font-mono text-xs text-text-dark">
                {packOutputDir}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <UiButton
                  size="sm"
                  variant="muted"
                  onClick={() => {
                    void handleOpenPackFolder();
                  }}
                >
                  打开文件夹
                </UiButton>
                <UiButton
                  size="sm"
                  variant="primary"
                  onClick={() => setIsPackDoneDialogOpen(false)}
                >
                  确定
                </UiButton>
              </div>
            </UiPanel>
          </div>,
          document.body
        )
        : null}
    </div>
  );
});

StoryboardNode.displayName = 'StoryboardNode';
