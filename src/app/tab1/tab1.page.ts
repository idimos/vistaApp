import { Component, OnDestroy } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Motion } from '@capacitor/motion';
import { CapacitorNfc, NfcEvent } from '@capgo/capacitor-nfc';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
} from '@ionic/angular/standalone';

// Shake detection constants
const SHAKE_THRESHOLD = 15;       // m/s² net acceleration required to count as a shake
const SHAKE_COOLDOWN_MS = 1500;   // minimum ms between shake events

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton],
})
export class Tab1Page implements OnDestroy {
  statusMessage = 'Initializing...';
  nfcEnabled = false;
  lastNarration = 'No narration played yet';

  private nfcEventListener?: PluginListenerHandle;
  private motionListener?: PluginListenerHandle;
  private audioPlayer = new Audio();
  private scanningStarted = false;
  private lastShakeTime = 0;

  async ionViewDidEnter(): Promise<void> {
    await this.initializeNfc();
    await this.initializeShakeDetection();
  }

  async ionViewWillLeave(): Promise<void> {
    await this.cleanup();
  }

  async ngOnDestroy(): Promise<void> {
    await this.cleanup();
  }

  async openNfcSettings(): Promise<void> {
    try {
      await CapacitorNfc.showSettings();
    } catch {
      this.statusMessage = 'Unable to open NFC settings automatically.';
    }
  }

  private async initializeShakeDetection(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      return; // accelerometer not available on web
    }

    try {
      this.motionListener = await Motion.addListener('accel', (event) => {
        const { x, y, z } = event.accelerationIncludingGravity;
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        // Subtract ~9.8 m/s² gravity to isolate user-induced acceleration
        const netAcceleration = Math.abs(magnitude - 9.81);

        const now = Date.now();
        if (
          !this.audioPlayer.paused &&
          netAcceleration > SHAKE_THRESHOLD &&
          now - this.lastShakeTime > SHAKE_COOLDOWN_MS
        ) {
          this.lastShakeTime = now;
          this.stopNarration();
        }
      });
    } catch {
      // Accelerometer unavailable — silently skip shake detection
    }
  }

  stopNarration(): void {
    this.audioPlayer.pause();
    this.audioPlayer.currentTime = 0;
    this.statusMessage = 'Narration stopped. Hold an NFC card to play again.';
  }

  private async initializeNfc(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      this.statusMessage = 'NFC scanning is available on Android device builds.';
      return;
    }

    try {
      const { supported } = await CapacitorNfc.isSupported();
      if (!supported) {
        this.statusMessage = 'This device does not support NFC.';
        return;
      }

      const { status } = await CapacitorNfc.getStatus();
      this.nfcEnabled = status === 'NFC_OK';

      if (!this.nfcEnabled) {
        this.statusMessage = 'NFC is disabled. Enable it in Android settings.';
        return;
      }

      this.nfcEventListener = await CapacitorNfc.addListener('nfcEvent', async (event: NfcEvent) => {
        await this.handleNfcEvent(event);
      });

      await CapacitorNfc.startScanning({
        iosSessionType: 'tag',
        invalidateAfterFirstRead: false,
        alertMessage: 'Hold the NFC card near the device.',
      });

      this.scanningStarted = true;
      this.statusMessage = 'Ready — hold an NFC card near the device.';
    } catch {
      this.statusMessage = 'NFC initialization failed.';
    }
  }

  private async handleNfcEvent(event: NfcEvent): Promise<void> {
    const filename = this.extractNdefText(event);

    if (!filename) {
      this.statusMessage = 'Tag scanned but no text record found.';
      return;
    }

    this.lastNarration = filename;
    this.statusMessage = `Tag detected. Playing: ${filename}`;

    const audioPath = `assets/audio/${filename}`;

    try {
      this.audioPlayer.pause();
      this.audioPlayer.src = audioPath;
      this.audioPlayer.currentTime = 0;
      await this.audioPlayer.play();
      this.statusMessage = `Playing: ${filename}`;
    } catch {
      this.statusMessage = `Failed to play "${filename}". Check that the file exists.`;
    }
  }

  private extractNdefText(event: NfcEvent): string {
    const records = event.tag?.ndefMessage;
    if (!records || records.length === 0) return '';

    for (const record of records) {
      const payload = record.payload;
      if (!payload || payload.length === 0) continue;

      // NDEF Text record: first byte = status (lang code length in bits 0-5)
      const statusByte = payload[0];
      const langCodeLength = statusByte & 0x3f;
      const textBytes = payload.slice(1 + langCodeLength);
      const text = new TextDecoder('utf-8').decode(new Uint8Array(textBytes)).trim();

      if (text.length > 0) return text;
    }
    return '';
  }

  private async cleanup(): Promise<void> {
    await this.nfcEventListener?.remove();
    this.nfcEventListener = undefined;

    await this.motionListener?.remove();
    this.motionListener = undefined;

    this.audioPlayer.pause();

    try {
      await CapacitorNfc.stopScanning();
    } catch {
      // ignore
    }

    this.scanningStarted = false;
  }
}
