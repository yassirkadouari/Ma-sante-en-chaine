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
    events: Vec<ChainEvent>,
}

#[derive(Debug, Clone)]
struct AnchorMeta {
    tx_hash: String,
    block_number: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChainEvent {
    event_id: String,
    record_id: String,
    event_type: String,
    actor_wallet: String,
    tx_hash: String,
    block_number: u64,
    timestamp: String,
    status: String,
    hash: String,
    cid: String,
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
#[serde(rename_all = "camelCase")]
struct VerifyResponse {
    exists: bool,
    valid: bool,
    stored_hash: Option<String>,
    status: Option<String>,
}

#[derive(Serialize)]
struct IsAuthorizedResponse {
    authorized: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AnchorResponse {
    record_id: String,
    hash: String,
    cid: String,
    owner_wallet: String,
    doctor_wallet: String,
    pharmacy_wallet: Option<String>,
    authorized_wallets: Vec<String>,
    status: String,
    tx_hash: String,
    block_number: u64,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorePayload {
    record_id: String,
    hash: String,
    cid: Option<String>,
    owner_wallet: String,
    doctor_wallet: Option<String>,
    pharmacy_wallet: Option<String>,
    timestamp: Option<u64>,
    #[serde(default)]
    authorized_wallets: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyPayload {
    record_id: String,
    candidate_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessPayload {
    record_id: String,
    wallet: String,
    requested_by_wallet: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizedPayload {
    record_id: String,
    wallet: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliverPayload {
    record_id: String,
    pharmacy_wallet: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelPayload {
    record_id: String,
}

#[derive(Serialize)]
struct EventsResponse {
    items: Vec<ChainEvent>,
    count: usize,
}

fn now_block_number() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_unix_seconds() -> u64 {
    now_block_number()
}

fn to_rfc3339(seconds: u64) -> String {
    chrono::DateTime::<Utc>::from_timestamp(seconds as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339())
}

fn next_tx_hash(record_id: &str) -> String {
    format!("tx-{}-{}", record_id, now_block_number())
}

fn next_event_id(record_id: &str, event_type: &str) -> String {
    format!("evt-{}-{}-{}", record_id, event_type, now_unix_seconds())
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
        record_id: record_id.to_string(),
        hash: anchor.hash.clone(),
        cid: anchor.cid.clone(),
        owner_wallet: anchor.owner.clone(),
        doctor_wallet: anchor.doctor.clone(),
        pharmacy_wallet: anchor.pharmacy.clone(),
        authorized_wallets,
        status: status_to_string(&anchor.status),
        tx_hash: meta.tx_hash.clone(),
        block_number: meta.block_number,
        created_at: to_rfc3339(anchor.created_at),
        updated_at: to_rfc3339(anchor.updated_at),
    }
}

fn push_event(
    guard: &mut ServiceState,
    record_id: &str,
    event_type: &str,
    actor_wallet: &str,
    status: &str,
    hash: &str,
    cid: &str,
) {
    let tx_hash = next_tx_hash(record_id);
    let block_number = now_block_number();
    let timestamp = Utc::now().to_rfc3339();

    guard.meta.insert(
        record_id.to_string(),
        AnchorMeta {
            tx_hash: tx_hash.clone(),
            block_number,
        },
    );

    guard.events.push(ChainEvent {
        event_id: next_event_id(record_id, event_type),
        record_id: record_id.to_string(),
        event_type: event_type.to_string(),
        actor_wallet: actor_wallet.to_string(),
        tx_hash,
        block_number,
        timestamp,
        status: status.to_string(),
        hash: hash.to_string(),
        cid: cid.to_string(),
    });
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "blockchain-api-rust".to_string(),
        mode: "in-memory-rust".to_string(),
    })
}

async fn list_events(State(state): State<AppState>) -> Json<EventsResponse> {
    let guard = state.inner.lock().expect("state lock poisoned");
    let mut items = guard.events.clone();
    items.reverse();

    Json(EventsResponse {
        count: items.len(),
        items,
    })
}

async fn list_record_events(
    State(state): State<AppState>,
    Path(record_id): Path<String>,
) -> Json<EventsResponse> {
    let guard = state.inner.lock().expect("state lock poisoned");
    let mut items: Vec<ChainEvent> = guard
        .events
        .iter()
        .filter(|evt| evt.record_id == record_id)
        .cloned()
        .collect();
    items.reverse();

    Json(EventsResponse {
        count: items.len(),
        items,
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
    if payload.record_id.trim().is_empty()
        || payload.hash.trim().is_empty()
        || payload.owner_wallet.trim().is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "invalid payload".to_string(),
            }),
        ));
    }

    let mut guard = state.inner.lock().expect("state lock poisoned");

    let owner = normalize_wallet(&payload.owner_wallet);
    let doctor = payload
        .doctor_wallet
        .as_ref()
        .map(|wallet| normalize_wallet(wallet))
        .filter(|wallet| !wallet.is_empty())
        .unwrap_or_else(|| owner.clone());
    let cid = payload
        .cid
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("pending:{}", payload.record_id));
    let pharmacy = payload
        .pharmacy_wallet
        .as_ref()
        .map(|wallet| normalize_wallet(wallet))
        .filter(|wallet| !wallet.is_empty());
    let timestamp = payload.timestamp.unwrap_or_else(now_unix_seconds);
    let authorized: Vec<String> = payload
        .authorized_wallets
        .iter()
        .map(|w| normalize_wallet(w))
        .filter(|w| !w.is_empty())
        .collect();

    guard
        .contract
        .store_hash(
            payload.record_id.clone(),
            payload.hash.clone(),
            cid,
            owner,
            doctor,
            pharmacy,
            timestamp,
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

    let anchor = guard.contract.get_anchor(&payload.record_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?.clone();

    push_event(
        &mut guard,
        &payload.record_id,
        "ANCHOR_STORED",
        &normalize_wallet(&payload.owner_wallet),
        &status_to_string(&anchor.status),
        &anchor.hash,
        &anchor.cid,
    );

    let meta_ref = guard.meta.get(&payload.record_id).expect("meta must exist");

    Ok((
        StatusCode::CREATED,
        Json(AnchorWrapper {
            anchor: to_response(&payload.record_id, &anchor, meta_ref),
        }),
    ))
}

async fn verify(
    State(state): State<AppState>,
    Json(payload): Json<VerifyPayload>,
) -> Json<VerifyResponse> {
    if payload.record_id.trim().is_empty() || payload.candidate_hash.trim().is_empty() {
        return Json(VerifyResponse {
            exists: false,
            valid: false,
            stored_hash: None,
            status: None,
        });
    }

    let guard = state.inner.lock().expect("state lock poisoned");
    match guard.contract.get_anchor(&payload.record_id) {
        Ok(anchor) => Json(VerifyResponse {
            exists: true,
            valid: anchor.hash == payload.candidate_hash,
            stored_hash: Some(anchor.hash.clone()),
            status: Some(status_to_string(&anchor.status)),
        }),
        Err(_) => Json(VerifyResponse {
            exists: false,
            valid: false,
            stored_hash: None,
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
            &payload.record_id,
            &normalize_wallet(&payload.requested_by_wallet),
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

    let anchor = guard.contract.get_anchor(&payload.record_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?.clone();

    push_event(
        &mut guard,
        &payload.record_id,
        "ACCESS_GRANTED",
        &normalize_wallet(&payload.requested_by_wallet),
        &status_to_string(&anchor.status),
        &anchor.hash,
        &anchor.cid,
    );
    let meta_ref = guard.meta.get(&payload.record_id).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.record_id, &anchor, meta_ref),
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
            &payload.record_id,
            &normalize_wallet(&payload.requested_by_wallet),
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

    let anchor = guard.contract.get_anchor(&payload.record_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?.clone();

    push_event(
        &mut guard,
        &payload.record_id,
        "ACCESS_REVOKED",
        &normalize_wallet(&payload.requested_by_wallet),
        &status_to_string(&anchor.status),
        &anchor.hash,
        &anchor.cid,
    );
    let meta_ref = guard.meta.get(&payload.record_id).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.record_id, &anchor, meta_ref),
    }))
}

async fn is_authorized(
    State(state): State<AppState>,
    Json(payload): Json<AuthorizedPayload>,
) -> Json<IsAuthorizedResponse> {
    let guard = state.inner.lock().expect("state lock poisoned");

    let authorized = guard
        .contract
        .is_authorized(&payload.record_id, &normalize_wallet(&payload.wallet))
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
        .deliver_prescription(&payload.record_id, &normalize_wallet(&payload.pharmacy_wallet))
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let anchor = guard.contract.get_anchor(&payload.record_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?.clone();

    push_event(
        &mut guard,
        &payload.record_id,
        "PRESCRIPTION_DELIVERED",
        &normalize_wallet(&payload.pharmacy_wallet),
        &status_to_string(&anchor.status),
        &anchor.hash,
        &anchor.cid,
    );
    let meta_ref = guard.meta.get(&payload.record_id).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.record_id, &anchor, meta_ref),
    }))
}

async fn cancel(
    State(state): State<AppState>,
    Json(payload): Json<CancelPayload>,
) -> Result<Json<AnchorWrapper>, (StatusCode, Json<ErrorResponse>)> {
    let mut guard = state.inner.lock().expect("state lock poisoned");

    let owner = guard
        .contract
        .get_anchor(&payload.record_id)
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
        .cancel_prescription(&payload.record_id, &owner)
        .map_err(|err| {
            let (status, message) = map_error(err);
            (
                status,
                Json(ErrorResponse {
                    error: message,
                }),
            )
        })?;

    let anchor = guard.contract.get_anchor(&payload.record_id).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal server error".to_string(),
            }),
        )
    })?.clone();

    push_event(
        &mut guard,
        &payload.record_id,
        "PRESCRIPTION_CANCELLED",
        &owner,
        &status_to_string(&anchor.status),
        &anchor.hash,
        &anchor.cid,
    );
    let meta_ref = guard.meta.get(&payload.record_id).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.record_id, &anchor, meta_ref),
    }))
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "4600".to_string());

    let state = AppState {
        inner: Arc::new(Mutex::new(ServiceState {
            contract: MedicalEventContract::new(),
            meta: HashMap::new(),
            events: Vec::new(),
        })),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/events", get(list_events))
        .route("/events/:recordId", get(list_record_events))
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
