import { createChaomoGptImage25HightModel } from './chaomoGptImage25Hight';
import { CHAOMO_GPT_IMAGE25_SUNBURST_1K_HIGHT_MODEL_ID } from '../../providers/openai';

export const imageModel = createChaomoGptImage25HightModel(
  CHAOMO_GPT_IMAGE25_SUNBURST_1K_HIGHT_MODEL_ID,
  '1K',
  'gpt-image-2.5-sunburst-1K-Hight'
);
