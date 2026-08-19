pub(crate) use crate::upscale::ensure_upscale_cache_schema;
pub use crate::upscale::{
    cancel_upscale_job, get_upscale_job_status, start_upscale_job, UpscaleCommandError,
    UpscaleJobManager, UpscaleJobSnapshot,
};
