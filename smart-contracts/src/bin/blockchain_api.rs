use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use ma_sante_smart_contracts::medical_event::{MedicalAnchor, MedicalEventContract, PrescriptionStatus};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<ServiceState>>,
}

struct ServiceState {
    contract: MedicalEventContract,
    meta: HashMap<String, AnchorMeta>,
}

#[derive(Debug, Clone)]
struct AnchorMeta {
    tx_hash: String,
    block_number: u64,
    updated_at: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    mode: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize)]
struct AnchorsResponse {
    items: Vec<AnchorResponse>,
    count: usize,
}

#[derive(Serialize)]
struct AnchorWrapper {
    anchor: AnchorResponse,
}

#[derive(Serialize)]
struct VerifyResponse {
    exists: bool,
    valid: bool,
    storedHash: Option<String>,
    status: Option<String>,
}

#[derive(Serialize)]
struct IsAuthorizedResponse {
    authorized: bool,
}

#[derive(Serialize, Clone)]
struct AnchorResponse {
    recordId: String,
    hash: String,
    ownerWallet: String,
    authorizedWallets: Vec<String>,
    status: String,
    txHash: String,
    blockNumber: u64,
    updatedAt: String,
}

#[derive(Deserialize)]
struct StorePayload {
    recordId: String,
    hash: String,
    ownerWallet: String,
    #[serde(default)]
    authorizedWallets: Vec<String>,
}

#[derive(Deserialize)]
struct VerifyPayload {
    recordId: String,
    candidateHash: String,
}

#[derive(Deserialize)]
struct AccessPayload {
    recordId: String,
    wallet: String,
    requestedByWallet: String,
}

#[derive(Deserialize)]
struct AuthorizedPayload {
    recordId: String,
    wallet: String,
}

#[derive(Deserialize)]
struct DeliverPayload {
    recordId: String,
    pharmacyWallet: String,
}

#[derive(Deserialize)]
struct CancelPayload {
    recordId: String,
}

fn now_block_number() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn next_tx_hash(record_id: &str) -> String {
    format!("tx-{}-{}", record_id, now_block_number())
}

fn normalize_wallet(value: &str) -> String {
    value.trim().to_string()
}

fn status_to_string(status: &PrescriptionStatus) -> String {
    match status {
        PrescriptionStatus::Prescribed => "PRESCRIBED".to_string(),
        PrescriptionStatus::Delivered => "DELIVERED".to_string(),
        PrescriptionStatus::Cancelled => "CANCELLED".to_string(),
    }
}

fn map_error(err: String) -> (StatusCode, String) {
    if err.contains("anchor not found") {
        return (StatusCode::NOT_FOUND, "anchor not found".to_string());
    }
    if err.contains("already") {
        return (StatusCode::CONFLICT, err);
    }
    if err.contains("forbidden") || err.contains("only owner") || err.contains("not authorized") {
        return (StatusCode::FORBIDDEN, err);
    }
    if err.contains("cancelled") || err.contains("delivered") {
        return (StatusCode::CONFLICT, err);
    }
    (StatusCode::BAD_REQUEST, err)
}

fn to_response(record_id: &str, anchor: &MedicalAnchor, meta: &AnchorMeta) -> AnchorResponse {
    let mut authorized_wallets: Vec<String> = anchor.authorized.iter().cloned().collect();
    authorized_wallets.sort();

    AnchorResponse {
        recordId: record_id.to_string(),
        hash: anchor.hash.clone(),
        ownerWallet: anchor.owner.clone(),
        authorizedWallets: authorized_wallets,
        status: status_to_string(&anchor.status),
        txHash: meta.tx_hash.clone(),
        blockNumber: meta.block_number,
        updatedAt: meta.updated_at.clone(),
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "blockchain-api-rust".to_string(),
        mode: "in-memory-rust".to_string(),
    })
}

async fn list_anchors(State(state): State<AppState>) -> Json<AnchorsResponse> {
    let guard = state.inner.lock().expect("state lock poisoned");
    let mut items = Vec::new();

    for (record_id, anchor) in guard.contract.list_anchors() {
        if let Some(meta) = guard.meta.get(&record_id) {
            items.push(to_response(&record_id, &anchor, meta));
        }
    }

    Json(AnchorsResponse {
        count: items.len(),
        items,
    })
}

async fn get_anchor(
    State(state): State<AppState>,
    Path(record_id): Path<String>,
) -> Result<Json<AnchorWrapper>, (StatusCode, Json<ErrorResponse>)> {
    let guard = state.inner.lock().expect("state lock poisoned");

    let anchor = guard.contract.get_anchor(&record_id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "anchor not found".to_string(),
            }),
        )
    })?;

    let meta = guard.meta.get(&record_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "anchor not found".to_string(),
            }),
        )
    })?;

    Ok(Json(AnchorWrapper {
        anchor: to_response(&record_id, anchor, meta),
    }))
}

async fn store(
    State(state): State<AppState>,
    Json(payload): Json<StorePayload>,
) -> Result<(StatusCode, Json<AnchorWrapper>), (StatusCode, Json<ErrorResponse>)> {
    if payload.recordId.trim().is_empty()
        || payload.hash.trim().is_empty()
        || payload.ownerWallet.trim().is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid payload".to_string(),
            }),
        ));
    }

    let mut guard = state.inner.lock().expect("state lock poisoned");

    let owner = normalize_wallet(&payload.ownerWallet);
    let authorized: Vec<String> = payload
        .authorizedWallets
        .iter()
        .map(|w| normalize_wallet(w))
        .filter(|w| !w.is_empty())
        .collect();

    guard
        .contract
        .store_hash(
            payload.recordId.clone(),
            payload.hash.clone(),
            owner,
            authorized,
        )
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let meta = AnchorMeta {
        tx_hash: next_tx_hash(&payload.recordId),
        block_number: now_block_number(),
        updated_at: Utc::now().to_rfc3339(),
    };
    guard.meta.insert(payload.recordId.clone(), meta);

    let anchor = guard.contract.get_anchor(&payload.recordId).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?;

    let meta_ref = guard.meta.get(&payload.recordId).expect("meta must exist");

    Ok((
        StatusCode::CREATED,
        Json(AnchorWrapper {
            anchor: to_response(&payload.recordId, anchor, meta_ref),
        }),
    ))
}

async fn verify(
    State(state): State<AppState>,
    Json(payload): Json<VerifyPayload>,
) -> Json<VerifyResponse> {
    if payload.recordId.trim().is_empty() || payload.candidateHash.trim().is_empty() {
        return Json(VerifyResponse {
            exists: false,
            valid: false,
            storedHash: None,
            status: None,
        });
    }

    let guard = state.inner.lock().expect("state lock poisoned");
    match guard.contract.get_anchor(&payload.recordId) {
        Ok(anchor) => Json(VerifyResponse {
            exists: true,
            valid: anchor.hash == payload.candidateHash,
            storedHash: Some(anchor.hash.clone()),
            status: Some(status_to_string(&anchor.status)),
        }),
        Err(_) => Json(VerifyResponse {
            exists: false,
            valid: false,
            storedHash: None,
            status: None,
        }),
    }
}

async fn grant(
    State(state): State<AppState>,
    Json(payload): Json<AccessPayload>,
) -> Result<Json<AnchorWrapper>, (StatusCode, Json<ErrorResponse>)> {
    let mut guard = state.inner.lock().expect("state lock poisoned");

    guard
        .contract
        .grant_access(
            &payload.recordId,
            &normalize_wallet(&payload.requestedByWallet),
            normalize_wallet(&payload.wallet),
        )
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let meta = AnchorMeta {
        tx_hash: next_tx_hash(&payload.recordId),
        block_number: now_block_number(),
        updated_at: Utc::now().to_rfc3339(),
    };
    guard.meta.insert(payload.recordId.clone(), meta);

    let anchor = guard.contract.get_anchor(&payload.recordId).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?;
    let meta_ref = guard.meta.get(&payload.recordId).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.recordId, anchor, meta_ref),
    }))
}

async fn revoke(
    State(state): State<AppState>,
    Json(payload): Json<AccessPayload>,
) -> Result<Json<AnchorWrapper>, (StatusCode, Json<ErrorResponse>)> {
    let mut guard = state.inner.lock().expect("state lock poisoned");

    guard
        .contract
        .revoke_access(
            &payload.recordId,
            &normalize_wallet(&payload.requestedByWallet),
            &normalize_wallet(&payload.wallet),
        )
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let meta = AnchorMeta {
        tx_hash: next_tx_hash(&payload.recordId),
        block_number: now_block_number(),
        updated_at: Utc::now().to_rfc3339(),
    };
    guard.meta.insert(payload.recordId.clone(), meta);

    let anchor = guard.contract.get_anchor(&payload.recordId).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?;
    let meta_ref = guard.meta.get(&payload.recordId).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.recordId, anchor, meta_ref),
    }))
}

async fn is_authorized(
    State(state): State<AppState>,
    Json(payload): Json<AuthorizedPayload>,
) -> Json<IsAuthorizedResponse> {
    let guard = state.inner.lock().expect("state lock poisoned");

    let authorized = guard
        .contract
        .is_authorized(&payload.recordId, &normalize_wallet(&payload.wallet))
        .unwrap_or(false);

    Json(IsAuthorizedResponse { authorized })
}

async fn deliver(
    State(state): State<AppState>,
    Json(payload): Json<DeliverPayload>,
) -> Result<Json<AnchorWrapper>, (StatusCode, Json<ErrorResponse>)> {
    let mut guard = state.inner.lock().expect("state lock poisoned");

    guard
        .contract
        .deliver_prescription(&payload.recordId, &normalize_wallet(&payload.pharmacyWallet))
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let meta = AnchorMeta {
        tx_hash: next_tx_hash(&payload.recordId),
        block_number: now_block_number(),
        updated_at: Utc::now().to_rfc3339(),
    };
    guard.meta.insert(payload.recordId.clone(), meta);

    let anchor = guard.contract.get_anchor(&payload.recordId).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?;
    let meta_ref = guard.meta.get(&payload.recordId).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.recordId, anchor, meta_ref),
    }))
}

async fn cancel(
    State(state): State<AppState>,
    Json(payload): Json<CancelPayload>,
) -> Result<Json<AnchorWrapper>, (StatusCode, Json<ErrorResponse>)> {
    let mut guard = state.inner.lock().expect("state lock poisoned");

    let owner = guard
        .contract
        .get_anchor(&payload.recordId)
        .map(|a| a.owner.clone())
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "anchor not found".to_string(),
                }),
            )
        })?;

    guard
        .contract
        .cancel_prescription(&payload.recordId, &owner)
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let meta = AnchorMeta {
        tx_hash: next_tx_hash(&payload.recordId),
        block_number: now_block_number(),
        updated_at: Utc::now().to_rfc3339(),
    };
    guard.meta.insert(payload.recordId.clone(), meta);

    let anchor = guard.contract.get_anchor(&payload.recordId).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?;
    let meta_ref = guard.meta.get(&payload.recordId).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.recordId, anchor, meta_ref),
    }))
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "4600".to_string());

    let state = AppState {
        inner: Arc::new(Mutex::new(ServiceState {
            contract: MedicalEventContract::new(),
            meta: HashMap::new(),
        })),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/anchors", get(list_anchors))
        .route("/anchors/:recordId", get(get_anchor))
        .route("/anchors/store", post(store))
        .route("/anchors/verify", post(verify))
        .route("/anchors/grant", post(grant))
        .route("/anchors/revoke", post(revoke))
        .route("/anchors/is-authorized", post(is_authorized))
        .route("/anchors/deliver", post(deliver))
        .route("/anchors/cancel", post(cancel))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind rust blockchain api listener");

    println!("Rust blockchain API running on http://{}", addr);
    axum::serve(listener, app)
        .await
        .expect("rust blockchain api server failed");
}
