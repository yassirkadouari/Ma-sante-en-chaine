#[path = "../medical_event.rs"]
pub mod medical_event;

#[path = "../ordonnance.rs"]
pub mod ordonnance;

#[cfg(test)]
mod tests {
    use super::medical_event::{MedicalEventContract, PrescriptionStatus};
    use super::ordonnance::{OrdonnanceVersion, StatutOrdonnance};

    #[test]
    fn medical_event_contract_full_lifecycle() {
        let mut contract = MedicalEventContract::new();

        contract
            .store_hash(
                "rec-1".to_string(),
                "hash-abc".to_string(),
                "patient-1".to_string(),
                vec!["doctor-1".to_string(), "pharmacy-1".to_string()],
            )
            .expect("store_hash should succeed");

        assert!(contract
            .verify_hash("rec-1", "hash-abc")
            .expect("verify_hash should succeed"));

        contract
            .grant_access("rec-1", "patient-1", "insurance-1".to_string())
            .expect("owner should grant access");

        assert!(contract
            .is_authorized("rec-1", "insurance-1")
            .expect("is_authorized should succeed"));

        contract
            .deliver_prescription("rec-1", "pharmacy-1")
            .expect("authorized pharmacy should deliver");

        let status = contract
            .get_anchor_status("rec-1")
            .expect("anchor should exist");
        assert_eq!(*status, PrescriptionStatus::Delivered);
    }

    #[test]
    fn ordonnance_versioning_and_delivery() {
        let original = OrdonnanceVersion::emettre_ordonnance(
            "or-1".to_string(),
            "hash-v1".to_string(),
            "patient-1".to_string(),
            "doctor-1".to_string(),
            Some("pharmacy-1".to_string()),
            1,
        );

        let revised = original
            .reviser("or-2".to_string(), "hash-v2".to_string(), 2)
            .expect("reviser should succeed before delivery");

        assert_eq!(revised.previous_id.as_deref(), Some("or-1"));
        assert_eq!(revised.version, 2);

        let mut deliverable = revised.clone();
        deliverable
            .livrer("pharmacy-1")
            .expect("authorized pharmacy should deliver");

        assert_eq!(deliverable.statut, StatutOrdonnance::Delivered);
    }
}
