use axum::{
    extract::{Path, State},
    http::{Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use ma_sante_smart_contracts::medical_event::{MedicalAnchor, MedicalEventContract, PrescriptionStatus};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<ServiceState>>,
    state_file: PathBuf,
}

struct ServiceState {
    contract: MedicalEventContract,
    meta: HashMap<String, AnchorMeta>,
    events: Vec<ChainEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnchorMeta {
    tx_hash: String,
    block_number: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Serialize, Deserialize)]
struct PersistentState {
    anchors: HashMap<String, MedicalAnchor>,
    meta: HashMap<String, AnchorMeta>,
    events: Vec<ChainEvent>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugStateResponse {
    state_file: String,
    state_file_exists: bool,
    state_file_size_bytes: Option<u64>,
    loaded_anchors: usize,
    loaded_events: usize,
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
    requested_by_wallet: String,
}

#[derive(Serialize)]
struct EventsResponse {
    items: Vec<ChainEvent>,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolveRoleResponse {
    wallet: String,
    role: Option<String>,
    source: Option<String>,
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

fn normalize_role(value: &str) -> Option<String> {
    match value.trim().to_uppercase().as_str() {
        "DOCTOR" | "MEDECIN" | "MEDECIN_TRAITANT" => Some("MEDECIN".to_string()),
        "PATIENT" => Some("PATIENT".to_string()),
        "PHARMACY" | "PHARMACIE" | "PHARMACIEN" => Some("PHARMACIE".to_string()),
        "HOSPITAL" | "HOPITAL" | "HOSPITALIER" => Some("HOPITAL".to_string()),
        "INSURANCE" | "ASSURANCE" | "ASSUREUR" => Some("ASSURANCE".to_string()),
        "LAB" | "LABO" | "LABORATOIRE" => Some("LABO".to_string()),
        "ADMIN" | "SUPER_ADMIN" | "SUB_ADMIN" => Some("ADMIN".to_string()),
        _ => None,
    }
}

fn json_pointer_string<'a>(value: &'a serde_json::Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer)?.as_str()
}

async fn resolve_role(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<ResolveRoleResponse>, (StatusCode, Json<ErrorResponse>)> {
    let target_wallet = normalize_wallet(&wallet);
    if target_wallet.is_empty() {
        return Ok(Json(ResolveRoleResponse {
            wallet: target_wallet,
            role: None,
            source: None,
        }));
    }

    let candidates: Vec<(String, String, String)> = {
        let guard = state.inner.lock().expect("state lock poisoned");
        guard
            .contract
            .list_anchors()
            .into_iter()
            .filter(|(record_id, anchor)| {
                (record_id.starts_with("mongo:walletroles:")
                    || record_id.starts_with("mongo:walletidentities:")
                    || record_id.starts_with("mongo:users:"))
                    && anchor.owner == target_wallet
                    && !anchor.cid.trim().is_empty()
                    && !anchor.cid.starts_with("pending:")
            })
            .map(|(record_id, anchor)| (record_id, anchor.cid, anchor.owner))
            .collect()
    };

    let gateway_base = env::var("IPFS_GATEWAY_URL")
        .or_else(|_| env::var("NEXT_PUBLIC_IPFS_GATEWAY_URL"))
        .unwrap_or_else(|_| "https://gateway.pinata.cloud/ipfs".to_string())
        .trim_end_matches('/')
        .to_string();

    for (record_id, cid, owner_wallet) in candidates {
        let url = format!("{}/{}", gateway_base, cid);
        let response = match reqwest::get(url).await {
            Ok(res) => res,
            Err(_) => continue,
        };

        if !response.status().is_success() {
            continue;
        }

        let payload: serde_json::Value = match response.json().await {
            Ok(json) => json,
            Err(_) => continue,
        };

        let role_raw = [
            json_pointer_string(&payload, "/document/role"),
            json_pointer_string(&payload, "/document/identity/role"),
            json_pointer_string(&payload, "/role"),
            json_pointer_string(&payload, "/identity/role"),
        ]
        .into_iter()
        .flatten()
        .find_map(normalize_role);

        if let Some(role) = role_raw {
            return Ok(Json(ResolveRoleResponse {
                wallet: owner_wallet,
                role: Some(role),
                source: Some(record_id),
            }));
        }
    }

    let guard = state.inner.lock().expect("state lock poisoned");
    let fallback = guard.contract.list_anchors();
    let role = if fallback
        .iter()
        .any(|(_, anchor)| anchor.pharmacy.as_deref() == Some(target_wallet.as_str()))
    {
        Some("PHARMACIE".to_string())
    } else if fallback
        .iter()
        .any(|(_, anchor)| anchor.doctor == target_wallet)
    {
        Some("MEDECIN".to_string())
    } else if fallback
        .iter()
        .any(|(_, anchor)| anchor.owner == target_wallet)
    {
        Some("PATIENT".to_string())
    } else {
        None
    };

    Ok(Json(ResolveRoleResponse {
        wallet: target_wallet,
        role,
        source: Some("fallback-anchors".to_string()),
    }))
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

fn persist_locked(guard: &ServiceState, state_file: &FsPath) -> Result<(), String> {
    let snapshot = PersistentState {
        anchors: guard.contract.export_anchors(),
        meta: guard.meta.clone(),
        events: guard.events.clone(),
    };

    let serialized = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("failed to serialize state: {}", e))?;

    if let Some(parent) = state_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create state directory: {}", e))?;
    }

    fs::write(state_file, serialized).map_err(|e| format!("failed to write state file: {}", e))
}

fn empty_state() -> ServiceState {
    ServiceState {
        contract: MedicalEventContract::new(),
        meta: HashMap::new(),
        events: Vec::new(),
    }
}

fn load_state(state_file: &FsPath) -> ServiceState {
    let raw = match fs::read_to_string(state_file) {
        Ok(content) => content,
        Err(_) => return empty_state(),
    };

    match serde_json::from_str::<PersistentState>(&raw) {
        Ok(parsed) => ServiceState {
            contract: MedicalEventContract::from_anchors(parsed.anchors),
            meta: parsed.meta,
            events: parsed.events,
        },
        Err(error) => {
            eprintln!(
                "failed to parse persisted blockchain state ({}), starting empty",
                error
            );
            empty_state()
        }
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "blockchain-api-rust".to_string(),
        mode: "persistent-rust".to_string(),
    })
}

async fn debug_state(State(state): State<AppState>) -> Json<DebugStateResponse> {
    let guard = state.inner.lock().expect("state lock poisoned");
    let anchors_count = guard.contract.list_anchors().len();
    let events_count = guard.events.len();

    let path_display = state
        .state_file
        .canonicalize()
        .unwrap_or_else(|_| state.state_file.clone())
        .display()
        .to_string();

    let metadata = fs::metadata(&state.state_file).ok();

    Json(DebugStateResponse {
        state_file: path_display,
        state_file_exists: metadata.is_some(),
        state_file_size_bytes: metadata.map(|m| m.len()),
        loaded_anchors: anchors_count,
        loaded_events: events_count,
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

    persist_locked(&guard, &state.state_file).map_err(|message| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: message }),
        )
    })?;

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

    persist_locked(&guard, &state.state_file).map_err(|message| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: message }),
        )
    })?;

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

    persist_locked(&guard, &state.state_file).map_err(|message| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: message }),
        )
    })?;

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

    persist_locked(&guard, &state.state_file).map_err(|message| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: message }),
        )
    })?;

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
    let caller = normalize_wallet(&payload.requested_by_wallet);

    guard
        .contract
        .cancel_prescription(&payload.record_id, &caller)
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
        &caller,
        &status_to_string(&anchor.status),
        &anchor.hash,
        &anchor.cid,
    );

    persist_locked(&guard, &state.state_file).map_err(|message| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: message }),
        )
    })?;

    let meta_ref = guard.meta.get(&payload.record_id).expect("meta must exist");

    Ok(Json(AnchorWrapper {
        anchor: to_response(&payload.record_id, &anchor, meta_ref),
    }))
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "4600".to_string());
    let state_file = env::var("BLOCKCHAIN_STATE_FILE")
        .unwrap_or_else(|_| "data/blockchain_state.json".to_string());
    let state_path = PathBuf::from(state_file);

    let state = AppState {
        inner: Arc::new(Mutex::new(load_state(&state_path))),
        state_file: state_path,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/debug/state", get(debug_state))
        .route("/resolve-role/:wallet", get(resolve_role))
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
        .layer(cors)
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
