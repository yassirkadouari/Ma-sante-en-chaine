// Fichier : smart-contracts/medical_event.rs
// Description : Modele metier pour les preuves d'evenements medicaux.

#[derive(Debug, PartialEq)]
pub enum EventType {
    Visite,
    Diagnostic,
    Analyse,
    Imagerie,
    Ordonnance,
    Hospitalisation,
    Intervention,
    Remboursement,
}

#[derive(Debug, PartialEq)]
pub enum ProofStatus {
    Pending,
    Anchored,
    Revoked,
}

pub struct MedicalEventProof {
    pub event_id: String,
    pub patient_id: String,
    pub actor_id: String,
    pub event_type: EventType,
    pub event_hash: String,
    pub timestamp: u64,
    pub status: ProofStatus,
}

impl MedicalEventProof {
    pub fn new(
        event_id: String,
        patient_id: String,
        actor_id: String,
        event_type: EventType,
        event_hash: String,
        timestamp: u64,
    ) -> Self {
        MedicalEventProof {
            event_id,
            patient_id,
            actor_id,
            event_type,
            event_hash,
            timestamp,
            status: ProofStatus::Pending,
        }
    }

    pub fn mark_anchored(&mut self) {
        self.status = ProofStatus::Anchored;
    }

    pub fn revoke(&mut self) {
        self.status = ProofStatus::Revoked;
    }
}
