use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::Duration,
};

use futures_util::StreamExt;
use ort::{
    environment::Environment,
    session::{Session, builder::GraphOptimizationLevel},
    value::Tensor,
};
use rodio::{OutputStream, Sink, buffer::SamplesBuffer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const MODEL_URL: &str = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx";
const TOKENIZER_URL: &str =
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/tokenizer.json";
const CMUDICT_URL: &str = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";
const VOICE_BASE_URL: &str =
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices";

const SAMPLE_RATE: u32 = 24_000;
const STYLE_DIM: usize = 256;
const MAX_PHONEME_TOKENS: usize = 380;

static PLAYBACK_GEN: AtomicU64 = AtomicU64::new(0);
static ORT_ENV: OnceLock<Result<Environment, String>> = OnceLock::new();
static ENGINE_CACHE: OnceLock<Mutex<Option<KokoroEngine>>> = OnceLock::new();
static CMUDICT_CACHE: OnceLock<Mutex<Option<Arc<HashMap<String, String>>>>> = OnceLock::new();
static VOICE_CACHE: OnceLock<Mutex<HashMap<String, Arc<Vec<f32>>>>> = OnceLock::new();

struct KokoroEngine {
    session: Session,
    vocab: HashMap<String, i64>,
    input_ids_name: String,
    uses_int32_speed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroStatus {
    pub model_ready: bool,
    pub downloaded_voices: Vec<String>,
    pub model_size_bytes: u64,
    pub data_dir: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    stage: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: u8,
    voice: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WordProgressPayload {
    char_index: usize,
    char_length: usize,
    word: String,
    total_chars: usize,
}

struct WordTiming {
    start_ms: u64,
    char_index: usize,
    char_length: usize,
    word: String,
}

#[derive(Deserialize)]
struct TokenizerJson {
    model: TokenizerModel,
}

#[derive(Deserialize)]
struct TokenizerModel {
    vocab: HashMap<String, i64>,
}

fn kokoro_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))?;
    Ok(base.join("kokoro"))
}

fn validate_voice_id(voice: &str) -> Result<String, String> {
    let trimmed = voice.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err("Invalid Kokoro voice identifier.".to_string());
    }
    Ok(trimmed.to_string())
}

fn list_downloaded_voices(dir: &Path) -> Vec<String> {
    let voices_dir = dir.join("voices");
    let Ok(entries) = fs::read_dir(voices_dir) else {
        return Vec::new();
    };
    let mut voices = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("bin") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                voices.push(stem.to_string());
            }
        }
    }
    voices.sort();
    voices
}

fn dir_size_bytes(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            total = total.saturating_add(dir_size_bytes(&p));
        } else if let Ok(meta) = p.metadata() {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

#[tauri::command]
pub async fn kokoro_model_status(app: AppHandle) -> Result<KokoroStatus, String> {
    let dir = kokoro_dir(&app)?;
    let model_ready = dir.join("model_quantized.onnx").is_file()
        && dir.join("tokenizer.json").is_file()
        && dir.join("cmudict.dict").is_file();
    let downloaded_voices = list_downloaded_voices(&dir);
    let model_size_bytes = dir_size_bytes(&dir);

    Ok(KokoroStatus {
        model_ready,
        downloaded_voices,
        model_size_bytes,
        data_dir: dir.to_string_lossy().into_owned(),
    })
}

async fn download_file_with_progress(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
    stage: &str,
    voice: &str,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed ({stage}): {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed ({stage}) with HTTP {}",
            response.status()
        ));
    }

    let total_bytes = response.content_length();
    let tmp_path = dest.with_extension("tmp");
    let mut file =
        fs::File::create(&tmp_path).map_err(|e| format!("Could not create temp file: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 255;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error ({stage}): {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Could not write downloaded file: {e}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);

        let percent = match total_bytes {
            Some(total) if total > 0 => ((downloaded.saturating_mul(100)) / total).min(100) as u8,
            _ => 0,
        };
        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "kokoro://download-progress",
                DownloadProgressPayload {
                    stage: stage.to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent,
                    voice: voice.to_string(),
                },
            );
        }
    }

    file.flush()
        .map_err(|e| format!("Could not flush downloaded file: {e}"))?;
    drop(file);

    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    fs::rename(&tmp_path, dest).map_err(|e| format!("Could not finalize downloaded file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn kokoro_download_model(app: AppHandle, voice: String) -> Result<KokoroStatus, String> {
    let voice_id = validate_voice_id(&voice)?;
    let dir = kokoro_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create kokoro directory: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let tokenizer_path = dir.join("tokenizer.json");
    if !tokenizer_path.is_file() {
        download_file_with_progress(
            &client,
            TOKENIZER_URL,
            &tokenizer_path,
            &app,
            "tokenizer",
            &voice_id,
        )
        .await?;
    }

    let cmudict_path = dir.join("cmudict.dict");
    if !cmudict_path.is_file() {
        download_file_with_progress(
            &client,
            CMUDICT_URL,
            &cmudict_path,
            &app,
            "dictionary",
            &voice_id,
        )
        .await?;
    }

    let voice_path = dir.join("voices").join(format!("{voice_id}.bin"));
    if !voice_path.is_file() {
        let voice_url = format!("{VOICE_BASE_URL}/{voice_id}.bin");
        download_file_with_progress(&client, &voice_url, &voice_path, &app, "voice", &voice_id)
            .await?;
    }

    let model_path = dir.join("model_quantized.onnx");
    if !model_path.is_file() {
        download_file_with_progress(&client, MODEL_URL, &model_path, &app, "model", &voice_id)
            .await?;
    }

    // Reset cached engine so newly downloaded files are picked up cleanly.
    if let Some(cache) = ENGINE_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            *guard = None;
        }
    }

    kokoro_model_status(app).await
}

#[tauri::command]
pub async fn kokoro_delete_models(app: AppHandle) -> Result<(), String> {
    PLAYBACK_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(cache) = ENGINE_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            *guard = None;
        }
    }
    if let Some(cache) = CMUDICT_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            *guard = None;
        }
    }

    let dir = kokoro_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Could not remove Kokoro files: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn kokoro_stop() {
    PLAYBACK_GEN.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub async fn kokoro_warmup(app: AppHandle, voice: Option<String>) -> Result<(), String> {
    let dir = kokoro_dir(&app)?;
    let model_path = dir.join("model_quantized.onnx");
    let tokenizer_path = dir.join("tokenizer.json");
    let cmudict_path = dir.join("cmudict.dict");
    if !model_path.is_file() || !tokenizer_path.is_file() || !cmudict_path.is_file() {
        return Ok(());
    }
    let voice_path = voice
        .as_deref()
        .and_then(|v| validate_voice_id(v).ok())
        .map(|v| dir.join("voices").join(format!("{v}.bin")))
        .filter(|p| p.is_file());

    tokio::task::spawn_blocking(move || {
        ensure_engine_loaded(&model_path, &tokenizer_path)?;
        let _ = load_cmudict_cached(&cmudict_path)?;
        if let Some(vp) = voice_path {
            let _ = load_voice_bytes(&vp)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Kokoro warmup task failed: {e}"))?
}

#[tauri::command]
pub async fn kokoro_speak(
    app: AppHandle,
    text: String,
    voice: String,
    speed: f32,
) -> Result<(), String> {
    let voice_id = validate_voice_id(&voice)?;
    let clamped_speed = speed.clamp(0.5, 2.0);
    let cleaned = text.trim().to_string();
    if cleaned.is_empty() {
        return Ok(());
    }

    let dir = kokoro_dir(&app)?;
    let model_path = dir.join("model_quantized.onnx");
    let tokenizer_path = dir.join("tokenizer.json");
    let cmudict_path = dir.join("cmudict.dict");
    let voice_path = dir.join("voices").join(format!("{voice_id}.bin"));

    if !model_path.is_file() || !tokenizer_path.is_file() || !cmudict_path.is_file() {
        return Err("Kokoro model is not downloaded yet.".to_string());
    }
    if !voice_path.is_file() {
        return Err(format!("Kokoro voice '{voice_id}' is not downloaded yet."));
    }

    let generation = PLAYBACK_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        synthesize_and_play(
            &app_handle,
            &model_path,
            &tokenizer_path,
            &cmudict_path,
            &voice_path,
            &cleaned,
            clamped_speed,
            generation,
        )
    })
    .await
    .map_err(|e| format!("Kokoro playback task failed: {e}"))?
}

fn load_cmudict_cached(path: &Path) -> Result<Arc<HashMap<String, String>>, String> {
    let lock = CMUDICT_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = lock
        .lock()
        .map_err(|_| "CMUdict cache lock poisoned".to_string())?;
    if let Some(map) = guard.as_ref() {
        return Ok(Arc::clone(map));
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Could not read pronunciation dictionary: {e}"))?;
    let mut map = HashMap::with_capacity(135_000);
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(";;;") {
            continue;
        }
        let Some((raw_word, raw_phones)) = trimmed.split_once(' ') else {
            continue;
        };
        // Skip alternate pronunciations like WORD(2)
        if raw_word.contains('(') {
            continue;
        }
        let phones = raw_phones.split('#').next().unwrap_or(raw_phones).trim();
        if !phones.is_empty() {
            map.insert(raw_word.to_ascii_lowercase(), phones.to_string());
        }
    }

    let shared = Arc::new(map);
    *guard = Some(Arc::clone(&shared));
    Ok(shared)
}

fn get_ort_env() -> Result<&'static Environment, String> {
    let res = ORT_ENV.get_or_init(|| {
        ort::init()
            .with_name("noesis-kokoro")
            .build()
            .map_err(|e| format!("Could not initialize ONNX environment: {e}"))
    });
    match res {
        Ok(env) => Ok(env),
        Err(err) => Err(err.clone()),
    }
}

fn ensure_engine_loaded(model_path: &Path, tokenizer_path: &Path) -> Result<(), String> {
    let lock = ENGINE_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = lock
        .lock()
        .map_err(|_| "Kokoro engine lock poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let tokenizer_raw = fs::read_to_string(tokenizer_path)
        .map_err(|e| format!("Could not read Kokoro tokenizer: {e}"))?;
    let tokenizer: TokenizerJson = serde_json::from_str(&tokenizer_raw)
        .map_err(|e| format!("Could not parse Kokoro tokenizer: {e}"))?;

    let env = get_ort_env()?;
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 6))
        .unwrap_or(4);

    let session = Session::builder(env)
        .map_err(|e| format!("Could not create ONNX session builder: {e}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| format!("Could not set ONNX optimization level: {e}"))?
        .with_intra_threads(threads)
        .map_err(|e| format!("Could not configure ONNX threads: {e}"))?
        .with_inter_threads(2)
        .map_err(|e| format!("Could not configure ONNX inter-op threads: {e}"))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Could not load Kokoro ONNX model: {e}"))?;

    let input_ids_name = if session.inputs().iter().any(|i| i.name() == "input_ids") {
        "input_ids".to_string()
    } else {
        "tokens".to_string()
    };

    let uses_int32_speed = session
        .inputs()
        .iter()
        .find(|i| i.name() == "speed")
        .map(|i| format!("{:?}", i.dtype()).contains("Int32"))
        .unwrap_or(false);

    *guard = Some(KokoroEngine {
        session,
        vocab: tokenizer.model.vocab,
        input_ids_name,
        uses_int32_speed,
    });
    Ok(())
}

fn load_voice_bytes(voice_path: &Path) -> Result<Arc<Vec<f32>>, String> {
    let key = voice_path.to_string_lossy().into_owned();
    let lock = VOICE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = lock.lock() {
        if let Some(cached) = guard.get(&key) {
            return Ok(Arc::clone(cached));
        }
    }

    let bytes =
        fs::read(voice_path).map_err(|e| format!("Could not read Kokoro voice file: {e}"))?;
    if bytes.len() < STYLE_DIM * 4 || bytes.len() % 4 != 0 {
        return Err("Kokoro voice file is corrupted.".to_string());
    }
    let mut floats = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        floats.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }

    let shared = Arc::new(floats);
    if let Ok(mut guard) = lock.lock() {
        guard.insert(key, Arc::clone(&shared));
    }
    Ok(shared)
}

fn trim_chunk_silence(samples: Vec<f32>) -> Vec<f32> {
    const THRESHOLD: f32 = 0.012;
    const PAD_SAMPLES: usize = (SAMPLE_RATE as usize * 35) / 1000; // 35ms natural pad
    let Some(first_active) = samples.iter().position(|&s| s.abs() > THRESHOLD) else {
        return samples;
    };
    let Some(last_active) = samples.iter().rposition(|&s| s.abs() > THRESHOLD) else {
        return samples;
    };
    let start = first_active.saturating_sub(PAD_SAMPLES);
    let end = (last_active + 1 + PAD_SAMPLES).min(samples.len());
    samples[start..end].to_vec()
}

fn build_chunk_word_timings(
    chunk: &str,
    base_char_offset: usize,
    chunk_start_ms: u64,
    chunk_duration_ms: u64,
) -> Vec<WordTiming> {
    let mut words: Vec<(usize, usize, String, usize)> = Vec::new();
    let mut idx = 0usize;
    let bytes = chunk.as_bytes();
    while idx < bytes.len() {
        while idx < bytes.len() && !bytes[idx].is_ascii_alphanumeric() {
            idx += 1;
        }
        if idx >= bytes.len() {
            break;
        }
        let start = idx;
        while idx < bytes.len()
            && (bytes[idx].is_ascii_alphanumeric() || bytes[idx] == b'\'' || bytes[idx] == b'-')
        {
            idx += 1;
        }
        let word = chunk[start..idx].to_string();
        let pause_bonus =
            if idx < bytes.len() && matches!(bytes[idx], b'.' | b'!' | b'?' | b',' | b';') {
                3
            } else {
                0
            };
        let weight = word.len().max(2) + pause_bonus;
        words.push((base_char_offset + start, word.len(), word, weight));
    }

    let total_weight: usize = words.iter().map(|w| w.3).sum();
    if total_weight == 0 {
        return Vec::new();
    }

    // Account for the 35ms leading/trailing pad inside the trimmed audio chunk.
    let pad_ms = 35u64.min(chunk_duration_ms / 4);
    let active_ms = chunk_duration_ms.saturating_sub(pad_ms * 2).max(1);

    let mut timings = Vec::with_capacity(words.len());
    let mut acc_weight = 0usize;
    for (char_index, char_length, word, weight) in words {
        let start_ms = chunk_start_ms
            + pad_ms
            + (active_ms.saturating_mul(acc_weight as u64)) / (total_weight as u64);
        timings.push(WordTiming {
            start_ms,
            char_index,
            char_length,
            word,
        });
        acc_weight += weight;
    }
    timings
}

fn emit_due_word_timings(
    app: &AppHandle,
    timings: &[WordTiming],
    next_idx: &mut usize,
    elapsed_ms: u64,
    total_chars: usize,
) {
    while *next_idx < timings.len() && timings[*next_idx].start_ms <= elapsed_ms {
        let item = &timings[*next_idx];
        let _ = app.emit(
            "kokoro://word-progress",
            WordProgressPayload {
                char_index: item.char_index,
                char_length: item.char_length,
                word: item.word.clone(),
                total_chars,
            },
        );
        *next_idx += 1;
    }
}

struct SynthesizedChunk {
    chunk_text: String,
    base_char_offset: usize,
    samples: Vec<f32>,
}

fn synthesize_and_play(
    app: &AppHandle,
    model_path: &Path,
    tokenizer_path: &Path,
    cmudict_path: &Path,
    voice_path: &Path,
    text: &str,
    speed: f32,
    generation: u64,
) -> Result<(), String> {
    ensure_engine_loaded(model_path, tokenizer_path)?;
    let cmudict = load_cmudict_cached(cmudict_path)?;
    let voice_floats = load_voice_bytes(voice_path)?;
    let max_style_rows = voice_floats.len() / STYLE_DIM;

    let (_stream, stream_handle) = OutputStream::try_default()
        .map_err(|e| format!("Could not open audio output device: {e}"))?;
    let sink =
        Sink::try_new(&stream_handle).map_err(|e| format!("Could not create audio sink: {e}"))?;

    let (tx, rx) = mpsc::channel::<Result<SynthesizedChunk, String>>();
    let text_owned = text.to_string();
    let tokenizer_owned = tokenizer_path.to_path_buf();

    // Producer thread: runs ONNX inference so the playback/timing thread never blocks.
    let producer = std::thread::spawn(move || {
        let mut search_from: usize = 0;
        let chunks = split_text_for_kokoro(&text_owned);
        for chunk in chunks {
            if PLAYBACK_GEN.load(Ordering::SeqCst) != generation {
                return;
            }

            let base_char_offset = text_owned[search_from..]
                .find(&chunk)
                .map(|rel| search_from + rel)
                .unwrap_or(search_from);
            search_from = (base_char_offset + chunk.len()).min(text_owned.len());

            let phonemes = text_to_ipa(&chunk, &cmudict);
            if phonemes.is_empty() {
                continue;
            }

            let token_chunks = match tokenize_phonemes(&phonemes, &tokenizer_owned) {
                Ok(t) => t,
                Err(err) => {
                    let _ = tx.send(Err(err));
                    return;
                }
            };

            let mut chunk_samples: Vec<f32> = Vec::new();
            for token_ids in token_chunks {
                if PLAYBACK_GEN.load(Ordering::SeqCst) != generation {
                    return;
                }
                let phoneme_len = token_ids.len().saturating_sub(2);
                let style_row = phoneme_len.min(max_style_rows.saturating_sub(1));
                let style_offset = style_row * STYLE_DIM;
                let style_slice = voice_floats[style_offset..style_offset + STYLE_DIM].to_vec();

                match run_kokoro_inference(token_ids, style_slice, speed) {
                    Ok(samples) => chunk_samples.extend_from_slice(&samples),
                    Err(err) => {
                        let _ = tx.send(Err(err));
                        return;
                    }
                }
            }

            if !chunk_samples.is_empty() {
                let trimmed_samples = trim_chunk_silence(chunk_samples);
                if tx
                    .send(Ok(SynthesizedChunk {
                        chunk_text: chunk,
                        base_char_offset,
                        samples: trimmed_samples,
                    }))
                    .is_err()
                {
                    return;
                }
            }
        }
    });

    let total_chars = text.len();
    let mut queued_duration_ms: u64 = 0;
    let mut word_timings: Vec<WordTiming> = Vec::new();
    let mut next_word_idx: usize = 0;
    let mut producer_done = false;
    let mut active_played_ms: u64 = 0;
    let mut last_tick = std::time::Instant::now();

    loop {
        if PLAYBACK_GEN.load(Ordering::SeqCst) != generation {
            sink.stop();
            return Ok(());
        }

        while !producer_done {
            match rx.try_recv() {
                Ok(Ok(chunk)) => {
                    let chunk_duration_ms =
                        ((chunk.samples.len() as u64) * 1000) / (SAMPLE_RATE as u64);
                    let mut timings = build_chunk_word_timings(
                        &chunk.chunk_text,
                        chunk.base_char_offset,
                        queued_duration_ms,
                        chunk_duration_ms,
                    );
                    word_timings.append(&mut timings);
                    queued_duration_ms = queued_duration_ms.saturating_add(chunk_duration_ms);
                    if sink.empty() {
                        last_tick = std::time::Instant::now();
                    }
                    sink.append(SamplesBuffer::new(1, SAMPLE_RATE, chunk.samples));
                }
                Ok(Err(err)) => {
                    sink.stop();
                    return Err(err);
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    producer_done = true;
                    break;
                }
            }
        }

        let now = std::time::Instant::now();
        let dt_ms = now.duration_since(last_tick).as_millis() as u64;
        last_tick = now;
        if !sink.empty() {
            active_played_ms = active_played_ms
                .saturating_add(dt_ms)
                .min(queued_duration_ms);
        }

        emit_due_word_timings(
            app,
            &word_timings,
            &mut next_word_idx,
            active_played_ms,
            total_chars,
        );

        if producer_done && sink.empty() {
            break;
        }

        std::thread::sleep(Duration::from_millis(16));
    }

    let _ = producer.join();
    Ok(())
}

fn tokenize_phonemes(phonemes: &str, _tokenizer_path: &Path) -> Result<Vec<Vec<i64>>, String> {
    let lock = ENGINE_CACHE.get_or_init(|| Mutex::new(None));
    let guard = lock
        .lock()
        .map_err(|_| "Kokoro engine lock poisoned".to_string())?;
    let engine = guard
        .as_ref()
        .ok_or_else(|| "Kokoro engine is not initialized.".to_string())?;

    let mut raw_ids = Vec::new();
    for ch in phonemes.chars() {
        let mut buf = [0u8; 4];
        let key = ch.encode_utf8(&mut buf);
        if let Some(&id) = engine.vocab.get(key) {
            raw_ids.push(id);
        }
    }

    if raw_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut batches = Vec::new();
    for slice in raw_ids.chunks(MAX_PHONEME_TOKENS) {
        let mut padded = Vec::with_capacity(slice.len() + 2);
        padded.push(0);
        padded.extend_from_slice(slice);
        padded.push(0);
        batches.push(padded);
    }
    Ok(batches)
}

fn run_kokoro_inference(tokens: Vec<i64>, style: Vec<f32>, speed: f32) -> Result<Vec<f32>, String> {
    let lock = ENGINE_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = lock
        .lock()
        .map_err(|_| "Kokoro engine lock poisoned".to_string())?;
    let engine = guard
        .as_mut()
        .ok_or_else(|| "Kokoro engine is not initialized.".to_string())?;

    let token_len = tokens.len();
    let tokens_tensor = Tensor::from_array(([1usize, token_len], tokens))
        .map_err(|e| format!("Could not build token tensor: {e}"))?;
    let style_tensor = Tensor::from_array(([1usize, STYLE_DIM], style))
        .map_err(|e| format!("Could not build style tensor: {e}"))?;

    let outputs = if engine.uses_int32_speed {
        let speed_tensor = Tensor::from_array(([1usize], vec![speed.round() as i32]))
            .map_err(|e| format!("Could not build speed tensor: {e}"))?;
        let inputs = ort::inputs![
            engine.input_ids_name.as_str() => tokens_tensor,
            "style" => style_tensor,
            "speed" => speed_tensor,
        ];
        engine
            .session
            .run(inputs)
            .map_err(|e| format!("Kokoro inference failed: {e}"))?
    } else {
        let speed_tensor = Tensor::from_array(([1usize], vec![speed]))
            .map_err(|e| format!("Could not build speed tensor: {e}"))?;
        let inputs = ort::inputs![
            engine.input_ids_name.as_str() => tokens_tensor,
            "style" => style_tensor,
            "speed" => speed_tensor,
        ];
        engine
            .session
            .run(inputs)
            .map_err(|e| format!("Kokoro inference failed: {e}"))?
    };

    let (_shape, audio_slice) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Could not extract Kokoro audio tensor: {e}"))?;

    Ok(audio_slice.to_vec())
}

fn split_text_for_kokoro(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut max_len = 60;

    for sentence in text.split_inclusive(['.', '!', '?', '\n', ';', ',']) {
        for word in sentence.split_whitespace() {
            if !current.is_empty() && current.len() + word.len() + 1 > max_len {
                chunks.push(std::mem::take(&mut current));
                max_len = 240;
            }

            let mut remaining = word;
            while remaining.len() > max_len {
                let mut split_at = 0;
                for (index, character) in remaining.char_indices() {
                    let next = index + character.len_utf8();
                    if next > max_len {
                        break;
                    }
                    split_at = next;
                }
                if split_at == 0 {
                    break;
                }
                chunks.push(remaining[..split_at].to_string());
                remaining = &remaining[split_at..];
                max_len = 240;
            }

            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(remaining);
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::split_text_for_kokoro;

    #[test]
    fn long_first_sentence_is_split_for_fast_playback_start() {
        let text = (0..100)
            .map(|index| format!("word{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let chunks = split_text_for_kokoro(&text);

        assert!(chunks.len() > 2);
        assert!(chunks[0].len() <= 60);
        assert!(chunks.iter().all(|chunk| chunk.len() <= 240));
        assert_eq!(chunks.join(" "), text);
    }
}

fn text_to_ipa(text: &str, cmudict: &HashMap<String, String>) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_alphabetic() || ch == '\'' {
            let mut word = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_alphabetic() || c == '\'' {
                    word.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            let ipa = word_to_ipa(&word, cmudict);
            if !ipa.is_empty() {
                if !out.is_empty() && !out.ends_with(' ') {
                    out.push(' ');
                }
                out.push_str(&ipa);
            }
        } else if ch.is_ascii_digit() {
            let mut digits = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_digit() {
                    digits.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            let spoken = number_to_words(&digits);
            let ipa = text_to_ipa(&spoken, cmudict);
            if !ipa.is_empty() {
                if !out.is_empty() && !out.ends_with(' ') {
                    out.push(' ');
                }
                out.push_str(&ipa);
            }
        } else if matches!(ch, '.' | ',' | '!' | '?' | ';' | ':' | '—' | '-') {
            chars.next();
            let punct = if ch == '-' || ch == '—' { ',' } else { ch };
            out.push(punct);
        } else {
            chars.next();
            if ch.is_whitespace() && !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
        }
    }

    out.trim().to_string()
}

fn word_to_ipa(word: &str, cmudict: &HashMap<String, String>) -> String {
    let lower = word.to_ascii_lowercase();
    let trimmed = lower.trim_matches('\'');
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(arpabet) = cmudict.get(trimmed) {
        return arpabet_to_ipa(arpabet);
    }

    if let Some(stem) = trimmed.strip_suffix("'s") {
        if let Some(arpabet) = cmudict.get(stem) {
            return format!("{}z", arpabet_to_ipa(arpabet));
        }
    }

    fallback_g2p_ipa(trimmed)
}

fn arpabet_to_ipa(arpabet: &str) -> String {
    let mut out = String::new();
    for token in arpabet.split_whitespace() {
        let stress = token.chars().last().filter(|c| c.is_ascii_digit());
        let base = if stress.is_some() {
            &token[..token.len() - 1]
        } else {
            token
        };

        if let Some(s) = stress {
            if s == '1' {
                out.push('ˈ');
            } else if s == '2' {
                out.push('ˌ');
            }
        }

        let ipa = match (base, stress) {
            ("AA", _) => "ɑ",
            ("AE", _) => "æ",
            ("AH", Some('0')) => "ə",
            ("AH", _) => "ʌ",
            ("AO", _) => "ɔ",
            ("AW", _) => "aʊ",
            ("AY", _) => "aɪ",
            ("B", _) => "b",
            ("CH", _) => "tʃ",
            ("D", _) => "d",
            ("DH", _) => "ð",
            ("EH", _) => "ɛ",
            ("ER", Some('0')) => "ɚ",
            ("ER", _) => "ɝ",
            ("EY", _) => "eɪ",
            ("F", _) => "f",
            ("G", _) => "ɡ",
            ("HH", _) => "h",
            ("IH", _) => "ɪ",
            ("IY", _) => "i",
            ("JH", _) => "dʒ",
            ("K", _) => "k",
            ("L", _) => "l",
            ("M", _) => "m",
            ("N", _) => "n",
            ("NG", _) => "ŋ",
            ("OW", _) => "oʊ",
            ("OY", _) => "ɔɪ",
            ("P", _) => "p",
            ("R", _) => "ɹ",
            ("S", _) => "s",
            ("SH", _) => "ʃ",
            ("T", _) => "t",
            ("TH", _) => "θ",
            ("UH", _) => "ʊ",
            ("UW", _) => "u",
            ("V", _) => "v",
            ("W", _) => "w",
            ("Y", _) => "j",
            ("Z", _) => "z",
            ("ZH", _) => "ʒ",
            _ => "",
        };
        out.push_str(ipa);
    }
    out
}

fn fallback_g2p_ipa(word: &str) -> String {
    let bytes = word.as_bytes();
    let mut i = 0;
    let mut out = String::new();

    while i < bytes.len() {
        let rest = &word[i..];
        if rest.starts_with("tion") {
            out.push_str("ʃən");
            i += 4;
        } else if rest.starts_with("sion") {
            out.push_str("ʒən");
            i += 4;
        } else if rest.starts_with("th") {
            out.push('θ');
            i += 2;
        } else if rest.starts_with("sh") {
            out.push('ʃ');
            i += 2;
        } else if rest.starts_with("ch") {
            out.push_str("tʃ");
            i += 2;
        } else if rest.starts_with("ph") {
            out.push('f');
            i += 2;
        } else if rest.starts_with("ng") {
            out.push('ŋ');
            i += 2;
        } else if rest.starts_with("qu") {
            out.push_str("kw");
            i += 2;
        } else if rest.starts_with("ee") || rest.starts_with("ea") {
            out.push('i');
            i += 2;
        } else if rest.starts_with("oo") {
            out.push('u');
            i += 2;
        } else if rest.starts_with("ai") || rest.starts_with("ay") {
            out.push_str("eɪ");
            i += 2;
        } else if rest.starts_with("oa") || rest.starts_with("ow") {
            out.push_str("oʊ");
            i += 2;
        } else if rest.starts_with("ou") {
            out.push_str("aʊ");
            i += 2;
        } else {
            let ch = bytes[i] as char;
            let mapped = match ch {
                'a' => "æ",
                'b' => "b",
                'c' => "k",
                'd' => "d",
                'e' => {
                    if i + 1 == bytes.len() && bytes.len() > 2 {
                        ""
                    } else {
                        "ɛ"
                    }
                }
                'f' => "f",
                'g' => "ɡ",
                'h' => "h",
                'i' => "ɪ",
                'j' => "dʒ",
                'k' => "k",
                'l' => "l",
                'm' => "m",
                'n' => "n",
                'o' => "ɑ",
                'p' => "p",
                'q' => "k",
                'r' => "ɹ",
                's' => "s",
                't' => "t",
                'u' => "ʌ",
                'v' => "v",
                'w' => "w",
                'x' => "ks",
                'y' => "j",
                'z' => "z",
                _ => "",
            };
            out.push_str(mapped);
            i += 1;
        }
    }

    out
}

fn number_to_words(digits: &str) -> String {
    let Ok(n) = digits.parse::<u64>() else {
        return digits
            .chars()
            .map(|c| digit_word(c))
            .collect::<Vec<_>>()
            .join(" ");
    };
    if n > 999_999 {
        return digits
            .chars()
            .map(|c| digit_word(c))
            .collect::<Vec<_>>()
            .join(" ");
    }
    int_to_words(n)
}

fn digit_word(c: char) -> &'static str {
    match c {
        '0' => "zero",
        '1' => "one",
        '2' => "two",
        '3' => "three",
        '4' => "four",
        '5' => "five",
        '6' => "six",
        '7' => "seven",
        '8' => "eight",
        '9' => "nine",
        _ => "",
    }
}

fn int_to_words(n: u64) -> String {
    const ONES: [&str; 20] = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ];
    const TENS: [&str; 10] = [
        "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    ];

    if n < 20 {
        return ONES[n as usize].to_string();
    }
    if n < 100 {
        let t = TENS[(n / 10) as usize];
        let r = n % 10;
        return if r == 0 {
            t.to_string()
        } else {
            format!("{t} {}", ONES[r as usize])
        };
    }
    if n < 1000 {
        let h = ONES[(n / 100) as usize];
        let r = n % 100;
        return if r == 0 {
            format!("{h} hundred")
        } else {
            format!("{h} hundred {}", int_to_words(r))
        };
    }
    let th = int_to_words(n / 1000);
    let r = n % 1000;
    if r == 0 {
        format!("{th} thousand")
    } else {
        format!("{th} thousand {}", int_to_words(r))
    }
}
