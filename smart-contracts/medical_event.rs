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
    pub cid: String,
    pub owner: String,
    pub doctor: String,
    pub pharmacy: Option<String>,
    pub authorized: HashSet<String>,
    pub status: PrescriptionStatus,
    pub created_at: u64,
    pub updated_at: u64,
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
        cid: String,
        owner: String,
        doctor: String,
        pharmacy: Option<String>,
        timestamp: u64,
        initial_authorized: Vec<String>,
    ) -> Result<(), String> {
        if self.anchors.contains_key(&id) {
            return Err("record already anchored".into());
        }

        if cid.trim().is_empty() {
            return Err("cid is required".into());
        }

        let mut authorized = HashSet::new();
        for wallet in initial_authorized {
            authorized.insert(wallet);
        }

        self.anchors.insert(
            id,
            MedicalAnchor {
                hash,
                cid,
                owner,
                doctor,
                pharmacy,
                authorized,
                status: PrescriptionStatus::Prescribed,
                created_at: timestamp,
                updated_at: timestamp,
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

    pub fn get_anchor_status(&self, id: &str) -> Result<&PrescriptionStatus, String> {
        let anchor = self
            .anchors
            .get(id)
            .ok_or_else(|| "anchor not found".to_string())?;
        Ok(&anchor.status)
    }

    pub fn get_anchor(&self, id: &str) -> Result<&MedicalAnchor, String> {
        self.anchors
            .get(id)
            .ok_or_else(|| "anchor not found".to_string())
    }

    pub fn list_anchors(&self) -> Vec<(String, MedicalAnchor)> {
        self.anchors
            .iter()
            .map(|(id, anchor)| (id.clone(), anchor.clone()))
            .collect()
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
        anchor.updated_at = now_timestamp();
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
        anchor.updated_at = now_timestamp();
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
                anchor.updated_at = now_timestamp();
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
        anchor.updated_at = now_timestamp();
        Ok(())
    }
}

fn now_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
