// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod stream;

use tauri::{LogicalSize, Manager};
use tauri_plugin_window_state::StateFlags;

const MIN_WINDOW_WIDTH: f64 = 350.0;
const MIN_WINDOW_HEIGHT: f64 = 370.0;

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      if let Some(window) = app.get_window("main") {
        window.set_min_size(Some(LogicalSize::new(
          MIN_WINDOW_WIDTH,
          MIN_WINDOW_HEIGHT,
        )))?;
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![stream::stream_fetch])
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(
          StateFlags::POSITION
            | StateFlags::MAXIMIZED
            | StateFlags::VISIBLE
            | StateFlags::DECORATIONS
            | StateFlags::FULLSCREEN,
        )
        .build(),
    )
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
