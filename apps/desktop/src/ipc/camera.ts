import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface CaptureRequest {
  request_id: string;
}

/**
 * Subscribe to `atlas:vision:capture_camera` requests from Rust. On each
 * event, open the user's webcam via `getUserMedia`, snap one frame to a
 * canvas, encode as base64 PNG, and call the `vision_camera_deliver`
 * Tauri command to resolve Rust's pending oneshot.
 *
 * macOS prompts for camera permission on first invocation; once granted,
 * subsequent captures take ~300ms (stream warm-up dominates).
 */
export async function subscribeToCameraCaptures(): Promise<UnlistenFn> {
  return listen<CaptureRequest>('atlas:vision:capture_camera', async (event) => {
    const requestId = event.payload.request_id;
    try {
      const base64 = await captureOneFrame();
      await invoke<void>('vision_camera_deliver', {
        requestId,
        base64Png: base64,
      });
    } catch (err) {
      console.warn('[camera] capture failed:', err);
      // Best-effort: deliver an empty payload so Rust unblocks faster
      // than the 8s timeout.
      try {
        await invoke<void>('vision_camera_deliver', {
          requestId,
          base64Png: '',
        });
      } catch {
        /* ignore */
      }
    }
  });
}

async function captureOneFrame(): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // One animation frame + ~200ms for the sensor to settle — without
    // this the first frame is often blank/grey on macOS.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 200));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUri = canvas.toDataURL('image/png');
    return dataUri.replace(/^data:image\/png;base64,/, '');
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}
