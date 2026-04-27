use std::sync::Arc;

use super::AIProvider;

pub mod bltcy;
pub mod codingplan;
pub mod fal;
pub mod grsai;
pub mod kie;
pub mod ppio;
pub mod runninghub;
pub mod volcvideo;

pub use bltcy::BltcyProvider;
pub use codingplan::CodingPlanProvider;
pub use fal::FalProvider;
pub use grsai::GrsaiProvider;
pub use kie::KieProvider;
pub use ppio::PPIOProvider;
pub use runninghub::RunningHubProvider;
pub use volcvideo::VolcVideoProvider;

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        Arc::new(PPIOProvider::new()),
        Arc::new(GrsaiProvider::new()),
        Arc::new(KieProvider::new()),
        Arc::new(FalProvider::new()),
        Arc::new(BltcyProvider::new()),
        Arc::new(CodingPlanProvider::new()),
        Arc::new(VolcVideoProvider::new()),
        Arc::new(RunningHubProvider::new()),
    ]
}
