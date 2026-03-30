#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatutOrdonnance {
    Prescribed,
    Delivered,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct OrdonnanceVersion {
    pub id: String,
    pub previous_id: Option<String>,
    pub hash_data: String,
    pub patient_wallet: String,
    pub medecin_wallet: String,
    pub pharmacie_wallet: Option<String>,
    pub statut: StatutOrdonnance,
    pub date_emission: u64,
    pub version: u32,
}

impl OrdonnanceVersion {
    pub fn emettre_ordonnance(
        id: String,
        hash_data: String,
        patient_wallet: String,
        medecin_wallet: String,
        pharmacie_wallet: Option<String>,
        date_emission: u64,
    ) -> Self {
        Self {
            id,
            previous_id: None,
            hash_data,
            patient_wallet,
            medecin_wallet,
            pharmacie_wallet,
            statut: StatutOrdonnance::Prescribed,
            date_emission,
            version: 1,
        }
    }

    pub fn reviser(
        &self,
        new_id: String,
        new_hash_data: String,
        date_emission: u64,
    ) -> Result<Self, String> {
        if self.statut == StatutOrdonnance::Delivered {
            return Err("delivered prescription cannot be revised".into());
        }

        Ok(Self {
            id: new_id,
            previous_id: Some(self.id.clone()),
            hash_data: new_hash_data,
            patient_wallet: self.patient_wallet.clone(),
            medecin_wallet: self.medecin_wallet.clone(),
            pharmacie_wallet: self.pharmacie_wallet.clone(),
            statut: StatutOrdonnance::Prescribed,
            date_emission,
            version: self.version + 1,
        })
    }

    pub fn annuler(&mut self, caller_wallet: &str) -> Result<(), String> {
        if self.medecin_wallet != caller_wallet {
            return Err("only issuing doctor can cancel".into());
        }

        if self.statut == StatutOrdonnance::Delivered {
            return Err("delivered prescription cannot be cancelled".into());
        }

        self.statut = StatutOrdonnance::Cancelled;
        Ok(())
    }

    pub fn livrer(&mut self, caller_wallet: &str) -> Result<(), String> {
        if self.statut == StatutOrdonnance::Cancelled {
            return Err("cancelled prescription cannot be delivered".into());
        }

        if self.statut == StatutOrdonnance::Delivered {
            return Err("prescription already delivered".into());
        }

        if let Some(pharmacie) = &self.pharmacie_wallet {
            if pharmacie != caller_wallet {
                return Err("pharmacy wallet is not authorized".into());
            }
        }

        self.statut = StatutOrdonnance::Delivered;
        Ok(())
    }
}
