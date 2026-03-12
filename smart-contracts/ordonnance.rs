// Fichier : smart-contracts/ordonnance.rs
// Rédigé par l'équipe : Yassir, Marouane, Ahmed et Matine
// Description : Smart Contract principal pour la gestion du cycle de vie des ordonnances.

#[derive(Debug, PartialEq)]
pub enum StatutOrdonnance {
    Active,
    Utilisee,
    Annulee,
}

// Structure de base d'une ordonnance sur la Blockchain
pub struct Ordonnance {
    pub hash_id: String,
    pub date_emission: u64, // Timestamp Unix
    pub statut: StatutOrdonnance,
    pub hash_patient: String,
    pub hash_medecin: String,
}

impl Ordonnance {
    /// Action Médecin : Le médecin crée (émet) une nouvelle ordonnance sur la blockchain.
    /// Par défaut, son statut est défini sur "Active".
    pub fn emettre_ordonnance(
        hash_id: String,
        hash_patient: String,
        hash_medecin: String,
        date_emission: u64,
    ) -> Self {
        Ordonnance {
            hash_id,
            date_emission,
            statut: StatutOrdonnance::Active, // Toujours Active à la création
            hash_patient,
            hash_medecin,
        }
    }

    /// Action Pharmacie : Le pharmacien scanne l'ordonnance et valide la transaction.
    /// Cette fonction vérifie si l'ordonnance n'a pas déjà été utilisée.
    pub fn marquer_comme_utilisee(&mut self) -> Result<&str, &str> {
        // [Garde-fou] On vérifie que le patient n'est pas en train d'essayer 
        // de réutiliser une ordonnance déjà présentée à une autre pharmacie.
        if self.statut == StatutOrdonnance::Utilisee {
            return Err("FRAUDE DÉTECTÉE : L'ordonnance a déjà été utilisée.");
        }
        
        if self.statut == StatutOrdonnance::Annulee {
            return Err("ERREUR : L'ordonnance a été annulée par le médecin.");
        }

        // Si tout est bon, on change le statut pour bloquer les futures utilisations.
        self.statut = StatutOrdonnance::Utilisee;
        Ok("SUCCÈS : Ordonnance marquée comme délivrée. Prête pour remboursement.")
    }
}
