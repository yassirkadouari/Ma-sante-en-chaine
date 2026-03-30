use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrescriptionStatus {
    Prescribed,
    Delivered,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct MedicalAnchor {
    pub hash: String,
    pub owner: String,
    pub authorized: HashSet<String>,
    pub status: PrescriptionStatus,
}

pub struct MedicalEventContract {
    anchors: HashMap<String, MedicalAnchor>,
}

impl MedicalEventContract {
    pub fn new() -> Self {
        Self {
            anchors: HashMap::new(),
        }
    }

    pub fn store_hash(
        &mut self,
        id: String,
        hash: String,
        owner: String,
        initial_authorized: Vec<String>,
    ) -> Result<(), String> {
        if self.anchors.contains_key(&id) {
            return Err("record already anchored".into());
        }

        let mut authorized = HashSet::new();
        for wallet in initial_authorized {
            authorized.insert(wallet);
        }

        self.anchors.insert(
            id,
            MedicalAnchor {
                hash,
                owner,
                authorized,
                status: PrescriptionStatus::Prescribed,
            },
        );

        Ok(())
    }

    pub fn verify_hash(&self, id: &str, expected_hash: &str) -> Result<bool, String> {
        let anchor = self
            .anchors
            .get(id)
            .ok_or_else(|| "anchor not found".to_string())?;
        Ok(anchor.hash == expected_hash)
    }

    pub fn grant_access(
        &mut self,
        id: &str,
        caller: &str,
        wallet: String,
    ) -> Result<(), String> {
        let anchor = self
            .anchors
            .get_mut(id)
            .ok_or_else(|| "anchor not found".to_string())?;

        if anchor.owner != caller {
            return Err("only owner can grant access".into());
        }

        anchor.authorized.insert(wallet);
        Ok(())
    }

    pub fn revoke_access(
        &mut self,
        id: &str,
        caller: &str,
        wallet: &str,
    ) -> Result<(), String> {
        let anchor = self
            .anchors
            .get_mut(id)
            .ok_or_else(|| "anchor not found".to_string())?;

        if anchor.owner != caller {
            return Err("only owner can revoke access".into());
        }

        anchor.authorized.remove(wallet);
        Ok(())
    }

    pub fn is_authorized(&self, id: &str, wallet: &str) -> Result<bool, String> {
        let anchor = self
            .anchors
            .get(id)
            .ok_or_else(|| "anchor not found".to_string())?;

        Ok(anchor.owner == wallet || anchor.authorized.contains(wallet))
    }

    pub fn deliver_prescription(&mut self, id: &str, caller: &str) -> Result<(), String> {
        let anchor = self
            .anchors
            .get_mut(id)
            .ok_or_else(|| "anchor not found".to_string())?;

        if !anchor.authorized.contains(caller) && anchor.owner != caller {
            return Err("caller not authorized".into());
        }

        match anchor.status {
            PrescriptionStatus::Prescribed => {
                anchor.status = PrescriptionStatus::Delivered;
                Ok(())
            }
            PrescriptionStatus::Delivered => Err("prescription already delivered".into()),
            PrescriptionStatus::Cancelled => Err("prescription is cancelled".into()),
        }
    }

    pub fn cancel_prescription(&mut self, id: &str, caller: &str) -> Result<(), String> {
        let anchor = self
            .anchors
            .get_mut(id)
            .ok_or_else(|| "anchor not found".to_string())?;

        if anchor.owner != caller {
            return Err("only owner can cancel prescription".into());
        }

        if anchor.status == PrescriptionStatus::Delivered {
            return Err("cannot cancel delivered prescription".into());
        }

        anchor.status = PrescriptionStatus::Cancelled;
        Ok(())
    }
}
