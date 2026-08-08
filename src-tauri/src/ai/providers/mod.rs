use std::sync::Arc;

use super::AIProvider;

pub mod bltcy;
pub mod codingplan;
pub mod fal;
pub mod grsai;
pub mod kie;
pub mod openai;
pub mod ppio;
pub mod runninghub;
pub mod volcvideo;

pub use bltcy::BltcyProvider;
pub use codingplan::CodingPlanProvider;
pub use fal::FalProvider;
pub use grsai::GrsaiProvider;
pub use kie::KieProvider;
pub use openai::OpenAiProvider;
pub use ppio::PPIOProvider;
pub use runninghub::RunningHubProvider;
pub use volcvideo::VolcVideoProvider;

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        Arc::new(OpenAiProvider::legacy()),
        Arc::new(OpenAiProvider::ai_media()),
        Arc::new(OpenAiProvider::chaomo()),
        Arc::new(CodingPlanProvider::new()),
        Arc::new(VolcVideoProvider::new()),
    ]
}
