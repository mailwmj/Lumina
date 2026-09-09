import { createChaomoGptImage25HightModel } from './chaomoGptImage25Hight';
import { CHAOMO_GPT_IMAGE25_FLARE_2K_HIGHT_MODEL_ID } from '../../providers/openai';

export const imageModel = createChaomoGptImage25HightModel(
  CHAOMO_GPT_IMAGE25_FLARE_2K_HIGHT_MODEL_ID,
  '2K',
  'gpt-image-2.5-flare-2K-Hight'
);
