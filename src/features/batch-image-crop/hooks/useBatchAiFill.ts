import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { persistImageSource } from '@/commands/image';
import { canvasAiGateway } from '@/features/canvas/application/canvasServices';
import { resolveImageProviderRuntime } from '@/features/canvas/application/imageProviderRuntime';
import {
  listConfiguredImageModels,
  resolveConfiguredImageModel,
} from '@/features/canvas/models/availableModels';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  resolveFixedCanvasStatus,
  type BatchCropImageItem,
  type BatchCropTarget,
  type FixedCanvasDraft,
} from '../domain';
import { renderBatchFixedCanvas } from '../infrastructure/tauriBatchImageCropGateway';

export interface BatchAiFillSubmission {
  modelId: string;
  resolution: string;
  prompt: string;
}

interface UseBatchAiFillOptions {
  batchId: string;
  items: BatchCropImageItem[];
  selectedItem: BatchCropImageItem | null;
  target: BatchCropTarget | null;
  setItems: Dispatch<SetStateAction<BatchCropImageItem[]>>;
  onDialogClose: () => void;
  onToast: (message: string) => void;
}

type ImageJobStatus = Awaited<ReturnType<typeof canvasAiGateway.getGenerateImageJob>>;

function parseAspectRatio(value: string): number | null {
  const [width, height] = value.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return null;
  return width / height;
}

function resolveTargetAspectRatio(
  target: Pick<BatchCropTarget, 'width' | 'height'>,
  modelRatios: readonly { value: string }[]
): string {
  const targetRatio = target.width / target.height;
  const resolved = modelRatios
    .map((option) => ({ value: option.value, ratio: parseAspectRatio(option.value) }))
    .filter((option): option is { value: string; ratio: number } => option.ratio !== null)
    .sort((left, right) => Math.abs(left.ratio - targetRatio) - Math.abs(right.ratio - targetRatio))[0];
  return resolved?.value ?? (Math.abs(targetRatio - 1) < 0.01 ? '1:1' : '2:3');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBatchAiFill({
  batchId,
  items,
  selectedItem,
  target,
  setItems,
  onDialogClose,
  onToast,
}: UseBatchAiFillOptions) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const openAiImageApi = useSettingsStore((state) => state.openAiImageApi);
  const chaomoImageApi = useSettingsStore((state) => state.chaomoImageApi);
  const customImageApis = useSettingsStore((state) => state.customImageApis);
  const lastImageModelSelection = useSettingsStore((state) => state.lastImageModelSelection);

  const imageModelSettings = useMemo(() => ({
    openAiImageApi,
    chaomoImageApi,
    customImageApis,
    lastImageModelSelection,
  }), [chaomoImageApi, customImageApis, lastImageModelSelection, openAiImageApi]);
  const models = useMemo(
    () => listConfiguredImageModels(imageModelSettings),
    [imageModelSettings]
  );
  const defaultModel = useMemo(
    () => resolveConfiguredImageModel(imageModelSettings, selectedItem?.fixedCanvas.ai.modelId),
    [imageModelSettings, selectedItem?.fixedCanvas.ai.modelId]
  );

  const applyJobStatus = useCallback(async (
    itemId: string,
    jobId: string,
    job: ImageJobStatus
  ) => {
    if (job.status === 'queued' || job.status === 'running') {
      if (!job.recovery?.requires_manual_requery) return;
      setItems((current) => current.map((item) => {
        if (item.id !== itemId || item.fixedCanvas.ai.jobId !== jobId) return item;
        const fixedCanvas: FixedCanvasDraft = {
          ...item.fixedCanvas,
          ai: {
            ...item.fixedCanvas.ai,
            status: 'failed',
            errorMessage: job.recovery?.last_error || t('batchCrop.fixed.ai.queryInterrupted'),
            requiresManualRequery: true,
          },
        };
        return { ...item, fixedCanvas, status: resolveFixedCanvasStatus(fixedCanvas) };
      }));
      return;
    }

    if (job.status === 'succeeded' && job.result) {
      try {
        const resultPath = await persistImageSource(job.result);
        setItems((current) => current.map((item) => {
          if (item.id !== itemId || item.fixedCanvas.ai.jobId !== jobId) return item;
          const fixedCanvas: FixedCanvasDraft = {
            ...item.fixedCanvas,
            ready: false,
            ai: {
              ...item.fixedCanvas.ai,
              status: 'review',
              resultPath,
              errorMessage: undefined,
              requiresManualRequery: false,
            },
          };
          return {
            ...item,
            fixedCanvas,
            status: resolveFixedCanvasStatus(fixedCanvas),
            errorMessage: undefined,
          };
        }));
      } catch (error) {
        setItems((current) => current.map((item) => {
          if (item.id !== itemId || item.fixedCanvas.ai.jobId !== jobId) return item;
          const fixedCanvas: FixedCanvasDraft = {
            ...item.fixedCanvas,
            ai: {
              ...item.fixedCanvas.ai,
              status: 'failed',
              errorMessage: errorMessage(error),
            },
          };
          return { ...item, fixedCanvas, status: resolveFixedCanvasStatus(fixedCanvas) };
        }));
      }
      return;
    }

    const failure = job.error || (job.status === 'succeeded'
      ? t('batchCrop.fixed.ai.emptyResult')
      : t('batchCrop.fixed.ai.failed'));
    setItems((current) => current.map((item) => {
      if (item.id !== itemId || item.fixedCanvas.ai.jobId !== jobId) return item;
      const fixedCanvas: FixedCanvasDraft = {
        ...item.fixedCanvas,
        ai: {
          ...item.fixedCanvas.ai,
          status: 'failed',
          errorMessage: failure,
          requiresManualRequery: false,
        },
      };
      return { ...item, fixedCanvas, status: resolveFixedCanvasStatus(fixedCanvas) };
    }));
  }, [setItems, t]);

  useEffect(() => {
    const jobs = items.flatMap((item) => item.fixedCanvas.ai.status === 'processing' && item.fixedCanvas.ai.jobId
      ? [{ itemId: item.id, jobId: item.fixedCanvas.ai.jobId }]
      : []);
    if (jobs.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(jobs.map(async ({ itemId, jobId }) => {
        try {
          const job = await canvasAiGateway.getGenerateImageJob(jobId);
          if (!cancelled) await applyJobStatus(itemId, jobId, job);
        } catch (error) {
          if (cancelled) return;
          setItems((current) => current.map((item) => {
            if (item.id !== itemId || item.fixedCanvas.ai.jobId !== jobId) return item;
            const fixedCanvas: FixedCanvasDraft = {
              ...item.fixedCanvas,
              ai: {
                ...item.fixedCanvas.ai,
                status: 'failed',
                errorMessage: errorMessage(error),
                requiresManualRequery: true,
              },
            };
            return { ...item, fixedCanvas, status: resolveFixedCanvasStatus(fixedCanvas) };
          }));
        }
      })).finally(() => {
        if (!cancelled) setPollTick((current) => current + 1);
      });
    }, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyJobStatus, items, pollTick, setItems]);

  const submit = useCallback(async (submission: BatchAiFillSubmission) => {
    if (!selectedItem || !target || submitting) return;
    const model = models.find((candidate) => candidate.id === submission.modelId);
    if (!model) {
      onToast(t('batchCrop.fixed.ai.noModel'));
      return;
    }
    const providerRuntime = resolveImageProviderRuntime(model.providerId, imageModelSettings);
    if (!providerRuntime.apiKey.trim()) {
      onToast(t('batchCrop.fixed.ai.noModel'));
      return;
    }

    const itemId = selectedItem.id;
    setSubmitting(true);
    try {
      const rendered = await renderBatchFixedCanvas(batchId, {
        sourcePath: selectedItem.sourcePath,
        fileName: selectedItem.fileName,
        targetWidth: target.width,
        targetHeight: target.height,
        rotationDegrees: selectedItem.rotationDegrees,
        transform: selectedItem.fixedCanvas.transform,
        stretches: selectedItem.fixedCanvas.stretches,
      });
      await canvasAiGateway.setApiKey(providerRuntime.backendProviderId, providerRuntime.apiKey);
      const request = model.resolveRequest({ referenceImageCount: 1 });
      const jobId = await canvasAiGateway.submitGenerateImageJob({
        prompt: submission.prompt,
        model: request.requestModel,
        size: submission.resolution,
        aspectRatio: resolveTargetAspectRatio(target, model.aspectRatios),
        referenceImages: [rendered.renderedPath],
        extraParams: model.defaultExtraParams,
        providerConfig: providerRuntime.providerConfig,
      });
      setItems((current) => current.map((item) => {
        if (item.id !== itemId) return item;
        const fixedCanvas: FixedCanvasDraft = {
          ...item.fixedCanvas,
          ready: false,
          tool: null,
          selection: null,
          ai: {
            status: 'processing',
            prompt: submission.prompt,
            modelId: submission.modelId,
            resolution: submission.resolution,
            jobId,
          },
        };
        return {
          ...item,
          fixedCanvas,
          status: resolveFixedCanvasStatus(fixedCanvas),
          outputPath: undefined,
          errorMessage: undefined,
        };
      }));
      onDialogClose();
      setPollTick((current) => current + 1);
    } catch (error) {
      const message = errorMessage(error);
      setItems((current) => current.map((item) => {
        if (item.id !== itemId) return item;
        const fixedCanvas: FixedCanvasDraft = {
          ...item.fixedCanvas,
          ai: {
            ...item.fixedCanvas.ai,
            status: 'failed',
            prompt: submission.prompt,
            modelId: submission.modelId,
            resolution: submission.resolution,
            errorMessage: message,
          },
        };
        return { ...item, fixedCanvas, status: resolveFixedCanvasStatus(fixedCanvas) };
      }));
      onDialogClose();
      onToast(t('batchCrop.fixed.ai.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [batchId, imageModelSettings, models, onDialogClose, onToast, selectedItem, setItems, submitting, t, target]);

  const requerySelected = useCallback(async () => {
    const item = selectedItem;
    const jobId = item?.fixedCanvas.ai.jobId;
    if (!item || !jobId) return;
    const processingDraft: FixedCanvasDraft = {
      ...item.fixedCanvas,
      ai: {
        ...item.fixedCanvas.ai,
        status: 'processing',
        errorMessage: undefined,
        requiresManualRequery: false,
      },
    };
    setItems((current) => current.map((candidate) => candidate.id === item.id
      ? { ...candidate, fixedCanvas: processingDraft, status: resolveFixedCanvasStatus(processingDraft) }
      : candidate));
    try {
      const job = await canvasAiGateway.retryGenerateImageJob(jobId);
      await applyJobStatus(item.id, jobId, job);
      setPollTick((current) => current + 1);
    } catch (error) {
      const failedDraft: FixedCanvasDraft = {
        ...processingDraft,
        ai: {
          ...processingDraft.ai,
          status: 'failed',
          errorMessage: errorMessage(error),
          requiresManualRequery: true,
        },
      };
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, fixedCanvas: failedDraft, status: resolveFixedCanvasStatus(failedDraft) }
        : candidate));
    }
  }, [applyJobStatus, selectedItem, setItems]);

  return {
    models,
    defaultModelId: defaultModel?.id ?? '',
    submitting,
    submit,
    requerySelected,
  };
}
