#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(clippy::too_many_arguments)]

#[ink::contract]
mod medical_anchors_contract {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    pub type RecordId = [u8; 32];
    pub type ClaimId = [u8; 32];
    pub type Hash32 = [u8; 32];
    pub type EncryptionPublicKey = [u8; 32];

    #[derive(scale::Decode, scale::Encode, Clone, Copy, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub enum RecordKind {
        Prescription,
        Visit,
        LabResult,
        Operation,
        Other,
    }

    #[derive(scale::Decode, scale::Encode, Clone, Copy, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub enum RecordStatus {
        Prescribed,
        Delivered,
        Cancelled,
    }

    #[derive(scale::Decode, scale::Encode, Clone, Copy, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub enum ClaimStatus {
        Pending,
        Approved,
        Rejected,
        Reimbursed,
    }

    #[derive(scale::Decode, scale::Encode, Clone, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct Anchor {
        pub kind: RecordKind,
        pub cid: Vec<u8>,
        pub data_hash: Hash32,
        pub owner: AccountId,
        pub doctor: AccountId,
        pub pharmacy: Option<AccountId>,
        pub insurer: Option<AccountId>,
        pub status: RecordStatus,
        pub created_at: u64,
        pub updated_at: u64,
    }

    #[derive(scale::Decode, scale::Encode, Clone, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout))]
    pub struct Claim {
        pub source_record_id: RecordId,
        pub claimant: AccountId,
        pub insurer: AccountId,
        pub amount_requested: Balance,
        pub amount_approved: Option<Balance>,
        pub status: ClaimStatus,
        pub reason_hash: Option<Hash32>,
        pub payment_ref_hash: Option<Hash32>,
        pub created_at: u64,
        pub updated_at: u64,
    }

    #[derive(scale::Decode, scale::Encode, Clone, Copy, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum Error {
        RecordAlreadyExists,
        RecordNotFound,
        ClaimAlreadyExists,
        ClaimNotFound,
        Unauthorized,
        InvalidRecordId,
        InvalidCid,
        InvalidHash,
        InvalidTransition,
        InvalidAmount,
        InvalidEncryptionKey,
    }

    #[ink(storage)]
    pub struct MedicalAnchorsContract {
        records: Mapping<RecordId, Anchor>,
        record_index: Vec<RecordId>,
        claims: Mapping<ClaimId, Claim>,
        claim_index: Vec<ClaimId>,
        access: Mapping<(RecordId, AccountId), bool>,
        encryption_keys: Mapping<AccountId, EncryptionPublicKey>,
    }

    #[ink(event)]
    pub struct AnchorStored {
        #[ink(topic)]
        record_id: RecordId,
        #[ink(topic)]
        owner: AccountId,
        #[ink(topic)]
        doctor: AccountId,
        kind: RecordKind,
        insurer: Option<AccountId>,
    }

    #[ink(event)]
    pub struct AccessGranted {
        #[ink(topic)]
        record_id: RecordId,
        #[ink(topic)]
        wallet: AccountId,
        #[ink(topic)]
        by: AccountId,
    }

    #[ink(event)]
    pub struct AccessRevoked {
        #[ink(topic)]
        record_id: RecordId,
        #[ink(topic)]
        wallet: AccountId,
        #[ink(topic)]
        by: AccountId,
    }

    #[ink(event)]
    pub struct RecordStatusChanged {
        #[ink(topic)]
        record_id: RecordId,
        status: RecordStatus,
        #[ink(topic)]
        by: AccountId,
    }

    #[ink(event)]
    pub struct ClaimSubmitted {
        #[ink(topic)]
        claim_id: ClaimId,
        #[ink(topic)]
        record_id: RecordId,
        #[ink(topic)]
        claimant: AccountId,
        insurer: AccountId,
        amount_requested: Balance,
    }

    #[ink(event)]
    pub struct ClaimReviewed {
        #[ink(topic)]
        claim_id: ClaimId,
        status: ClaimStatus,
        amount_approved: Option<Balance>,
        #[ink(topic)]
        by: AccountId,
    }

    #[ink(event)]
    pub struct ClaimReimbursed {
        #[ink(topic)]
        claim_id: ClaimId,
        #[ink(topic)]
        by: AccountId,
        payment_ref_hash: Hash32,
    }

    #[ink(event)]
    pub struct EncryptionKeyRegistered {
        #[ink(topic)]
        wallet: AccountId,
        key: EncryptionPublicKey,
    }

    impl MedicalAnchorsContract {
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {
                records: Mapping::default(),
                record_index: Vec::new(),
                claims: Mapping::default(),
                claim_index: Vec::new(),
                access: Mapping::default(),
                encryption_keys: Mapping::default(),
            }
        }

        fn now(&self) -> u64 {
            self.env().block_timestamp()
        }

        fn assert_record_id(record_id: &RecordId) -> Result<(), Error> {
            if *record_id == [0; 32] {
                return Err(Error::InvalidRecordId);
            }
            Ok(())
        }

        fn assert_hash(hash: &Hash32) -> Result<(), Error> {
            if *hash == [0; 32] {
                return Err(Error::InvalidHash);
            }
            Ok(())
        }

        fn set_access(&mut self, record_id: &RecordId, wallet: &AccountId, enabled: bool) {
            self.access.insert((*record_id, *wallet), &enabled);
        }

        fn can_read_internal(&self, record_id: &RecordId, wallet: &AccountId) -> Result<bool, Error> {
            let anchor = self.records.get(record_id).ok_or(Error::RecordNotFound)?;

            if anchor.owner == *wallet
                || anchor.doctor == *wallet
                || anchor.pharmacy == Some(*wallet)
                || anchor.insurer == Some(*wallet)
            {
                return Ok(true);
            }

            Ok(self.access.get((*record_id, *wallet)).unwrap_or(false))
        }

        #[ink(message)]
        pub fn register_encryption_key(&mut self, key: EncryptionPublicKey) -> Result<(), Error> {
            if key == [0; 32] {
                return Err(Error::InvalidEncryptionKey);
            }

            let caller = self.env().caller();
            self.encryption_keys.insert(caller, &key);

            self.env().emit_event(EncryptionKeyRegistered {
                wallet: caller,
                key,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn encryption_key_of(&self, wallet: AccountId) -> Option<EncryptionPublicKey> {
            self.encryption_keys.get(wallet)
        }

        #[ink(message)]
        pub fn store_anchor(
            &mut self,
            record_id: RecordId,
            kind: RecordKind,
            cid: Vec<u8>,
            data_hash: Hash32,
            owner: AccountId,
            doctor: AccountId,
            pharmacy: Option<AccountId>,
            insurer: Option<AccountId>,
        ) -> Result<(), Error> {
            Self::assert_record_id(&record_id)?;
            Self::assert_hash(&data_hash)?;

            if cid.is_empty() {
                return Err(Error::InvalidCid);
            }

            if self.records.contains(record_id) {
                return Err(Error::RecordAlreadyExists);
            }

            let caller = self.env().caller();
            let pharmacy_receipt_actor = kind == RecordKind::Other && pharmacy == Some(caller);
            if caller != owner && caller != doctor && !pharmacy_receipt_actor {
                return Err(Error::Unauthorized);
            }

            let ts = self.now();
            self.records.insert(
                record_id,
                &Anchor {
                    kind,
                    cid,
                    data_hash,
                    owner,
                    doctor,
                    pharmacy,
                    insurer,
                    status: RecordStatus::Prescribed,
                    created_at: ts,
                    updated_at: ts,
                },
            );
            self.record_index.push(record_id);

            self.set_access(&record_id, &owner, true);
            self.set_access(&record_id, &doctor, true);
            if let Some(pharmacy_wallet) = pharmacy {
                self.set_access(&record_id, &pharmacy_wallet, true);
            }
            if let Some(insurer_wallet) = insurer {
                self.set_access(&record_id, &insurer_wallet, true);
            }

            self.env().emit_event(AnchorStored {
                record_id,
                owner,
                doctor,
                kind,
                insurer,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn grant_access(&mut self, record_id: RecordId, wallet: AccountId) -> Result<(), Error> {
            let mut anchor = self.records.get(record_id).ok_or(Error::RecordNotFound)?;
            let caller = self.env().caller();

            if caller != anchor.owner && caller != anchor.doctor {
                return Err(Error::Unauthorized);
            }

            self.set_access(&record_id, &wallet, true);
            anchor.updated_at = self.now();
            self.records.insert(record_id, &anchor);

            self.env().emit_event(AccessGranted {
                record_id,
                wallet,
                by: caller,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn revoke_access(&mut self, record_id: RecordId, wallet: AccountId) -> Result<(), Error> {
            let mut anchor = self.records.get(record_id).ok_or(Error::RecordNotFound)?;
            let caller = self.env().caller();

            if caller != anchor.owner && caller != anchor.doctor {
                return Err(Error::Unauthorized);
            }

            if wallet == anchor.owner || wallet == anchor.doctor {
                return Err(Error::Unauthorized);
            }

            self.set_access(&record_id, &wallet, false);
            anchor.updated_at = self.now();
            self.records.insert(record_id, &anchor);

            self.env().emit_event(AccessRevoked {
                record_id,
                wallet,
                by: caller,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn can_read(&self, record_id: RecordId, wallet: AccountId) -> bool {
            self.can_read_internal(&record_id, &wallet).unwrap_or(false)
        }

        #[ink(message)]
        pub fn verify_hash(&self, record_id: RecordId, candidate_hash: Hash32) -> bool {
            if let Some(anchor) = self.records.get(record_id) {
                anchor.data_hash == candidate_hash
            } else {
                false
            }
        }

        #[ink(message)]
        pub fn mark_delivered(&mut self, record_id: RecordId) -> Result<(), Error> {
            let mut anchor = self.records.get(record_id).ok_or(Error::RecordNotFound)?;

            if anchor.kind != RecordKind::Prescription {
                return Err(Error::InvalidTransition);
            }

            let caller = self.env().caller();

            if anchor.status != RecordStatus::Prescribed {
                return Err(Error::InvalidTransition);
            }

            anchor.status = RecordStatus::Delivered;
            anchor.updated_at = self.now();
            self.records.insert(record_id, &anchor);

            self.env().emit_event(RecordStatusChanged {
                record_id,
                status: RecordStatus::Delivered,
                by: caller,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn cancel_record(&mut self, record_id: RecordId) -> Result<(), Error> {
            let mut anchor = self.records.get(record_id).ok_or(Error::RecordNotFound)?;
            let caller = self.env().caller();

            if caller != anchor.owner && caller != anchor.doctor {
                return Err(Error::Unauthorized);
            }

            if anchor.status == RecordStatus::Delivered || anchor.status == RecordStatus::Cancelled {
                return Err(Error::InvalidTransition);
            }

            anchor.status = RecordStatus::Cancelled;
            anchor.updated_at = self.now();
            self.records.insert(record_id, &anchor);

            self.env().emit_event(RecordStatusChanged {
                record_id,
                status: RecordStatus::Cancelled,
                by: caller,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn submit_claim(
            &mut self,
            claim_id: ClaimId,
            source_record_id: RecordId,
            insurer: AccountId,
            amount_requested: Balance,
        ) -> Result<(), Error> {
            Self::assert_record_id(&claim_id)?;
            Self::assert_record_id(&source_record_id)?;

            if amount_requested == 0 {
                return Err(Error::InvalidAmount);
            }

            if self.claims.contains(claim_id) {
                return Err(Error::ClaimAlreadyExists);
            }

            let anchor = self
                .records
                .get(source_record_id)
                .ok_or(Error::RecordNotFound)?;

            let caller = self.env().caller();
            if caller != anchor.owner {
                return Err(Error::Unauthorized);
            }

            if anchor.kind == RecordKind::Prescription && anchor.status != RecordStatus::Delivered {
                return Err(Error::InvalidTransition);
            }

            let ts = self.now();
            let claim = Claim {
                source_record_id,
                claimant: caller,
                insurer,
                amount_requested,
                amount_approved: None,
                status: ClaimStatus::Pending,
                reason_hash: None,
                payment_ref_hash: None,
                created_at: ts,
                updated_at: ts,
            };

            self.claims.insert(claim_id, &claim);
            self.claim_index.push(claim_id);

            self.env().emit_event(ClaimSubmitted {
                claim_id,
                record_id: source_record_id,
                claimant: caller,
                insurer,
                amount_requested,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn review_claim(
            &mut self,
            claim_id: ClaimId,
            approve: bool,
            amount_approved: Option<Balance>,
            reason_hash: Option<Hash32>,
        ) -> Result<(), Error> {
            let mut claim = self.claims.get(claim_id).ok_or(Error::ClaimNotFound)?;
            let caller = self.env().caller();

            if caller != claim.insurer {
                return Err(Error::Unauthorized);
            }

            if claim.status != ClaimStatus::Pending {
                return Err(Error::InvalidTransition);
            }

            if approve {
                let approved = amount_approved.ok_or(Error::InvalidAmount)?;
                if approved == 0 {
                    return Err(Error::InvalidAmount);
                }
                claim.status = ClaimStatus::Approved;
                claim.amount_approved = Some(approved);
            } else {
                claim.status = ClaimStatus::Rejected;
                claim.amount_approved = None;
            }

            claim.reason_hash = reason_hash;
            claim.updated_at = self.now();
            self.claims.insert(claim_id, &claim);

            self.env().emit_event(ClaimReviewed {
                claim_id,
                status: claim.status,
                amount_approved: claim.amount_approved,
                by: caller,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn mark_claim_reimbursed(
            &mut self,
            claim_id: ClaimId,
            payment_ref_hash: Hash32,
        ) -> Result<(), Error> {
            let mut claim = self.claims.get(claim_id).ok_or(Error::ClaimNotFound)?;
            let caller = self.env().caller();

            if caller != claim.insurer {
                return Err(Error::Unauthorized);
            }

            if claim.status != ClaimStatus::Approved {
                return Err(Error::InvalidTransition);
            }

            Self::assert_hash(&payment_ref_hash)?;

            claim.status = ClaimStatus::Reimbursed;
            claim.payment_ref_hash = Some(payment_ref_hash);
            claim.updated_at = self.now();
            self.claims.insert(claim_id, &claim);

            self.env().emit_event(ClaimReimbursed {
                claim_id,
                by: caller,
                payment_ref_hash,
            });

            Ok(())
        }

        #[ink(message)]
        pub fn get_anchor(&self, record_id: RecordId) -> Option<Anchor> {
            self.records.get(record_id)
        }

        #[ink(message)]
        pub fn get_claim(&self, claim_id: ClaimId) -> Option<Claim> {
            self.claims.get(claim_id)
        }

        #[ink(message)]
        pub fn list_record_ids(&self, start: u32, limit: u32) -> Vec<RecordId> {
            let from = start as usize;
            let to = core::cmp::min(self.record_index.len(), from.saturating_add(limit as usize));
            if from >= to {
                return Vec::new();
            }
            self.record_index[from..to].to_vec()
        }

        #[ink(message)]
        pub fn list_claim_ids(&self, start: u32, limit: u32) -> Vec<ClaimId> {
            let from = start as usize;
            let to = core::cmp::min(self.claim_index.len(), from.saturating_add(limit as usize));
            if from >= to {
                return Vec::new();
            }
            self.claim_index[from..to].to_vec()
        }
    }
}
